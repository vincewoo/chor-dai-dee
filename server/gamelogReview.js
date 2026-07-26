// server/gamelogReview.js
//
// Read-side glue between the game log and MoveReview, mirroring what
// gamelogRecorder does for writes: index.js gains one call rather than a
// replay pipeline, and the game modules stay free of database access.
//
// The two databases are separate but joinable. `database.sqlite` holds
// game_history and the accounts; `gamelog.sqlite` holds the tape. Both key on
// the same room.gameId, which is what makes "review the game I just finished"
// a lookup rather than a migration.
//
// Nothing here is stored. A review is derived from the tape on request and
// cached in memory, because a finished game's tape never changes and so its
// review never does either.

const gamelog = require('./gamelog');
const { seatsFor, occupantAtRound } = require('./scripts/gamelogQuery');
const { reviewGame, byImportance, TOPICS } = require('./game/MoveReview');

// How many recent games an examples lookup will replay.
//
// Each game costs ~30ms of replay and grading, so this is the knob that decides
// whether "show me examples" is instant or a spinner. Eight is enough to find
// worked examples of anything a player does regularly, and the per-game reviews
// are cached, so the second topic a player opens is nearly free.
const EXAMPLE_GAME_LIMIT = 8;

// Reviews are small (a handful of highlights) and expensive relative to their
// size (~35-70ms of replay and grading). Immutable once the game ends, so the
// only reason to bound this is memory, not staleness.
const CACHE_LIMIT = 200;
const cache = new Map();

const cacheKey = (gameId, userId) => `${gameId}:${userId}`;

function remember(key, value) {
    // Insertion-ordered eviction. A Map iterates in insertion order, so the
    // first key is the oldest.
    if (cache.size >= CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
    return value;
}

/** Thrown for every "cannot review this" case, carrying the HTTP shape. */
class ReviewUnavailable extends Error {
    constructor(status, reason, message) {
        super(message);
        this.name = 'ReviewUnavailable';
        this.status = status;
        this.reason = reason;
    }
}

/**
 * Which seat did this account hold, round by round?
 *
 * Occupancy is a property of the round, not of the game: seats change hands on
 * reconnect and when a bot takes over. occupantAtRound is the same resolver the
 * export pipeline uses, reused rather than reimplemented so a review and a
 * training shard cannot disagree about whose decisions these were.
 *
 * Returns a function, and null when the account never held a seat.
 */
function seatResolver(seatSegments, userId) {
    const held = new Set();
    for (let seat = 0; seat < 4; seat++) {
        if (seatSegments[seat].some(seg => seg.user_id === userId)) held.add(seat);
    }
    if (held.size === 0) return null;

    return (roundNumber) => {
        for (const seat of held) {
            const segment = occupantAtRound(seatSegments[seat], roundNumber);
            if (segment && segment.user_id === userId) return seat;
        }
        // The account held a seat at some point in this game, but not this
        // round. Those decisions belong to whoever was sitting there.
        return null;
    };
}

/**
 * Build (or serve from cache) the review of one finished game for one account.
 *
 * @param {string} gameId  The shared game id, as it appears in game_history.
 * @param {number} userId  The account whose decisions are being reviewed.
 * @param {object} options { limit }
 * @throws {ReviewUnavailable}
 */
async function reviewForUser(gameId, userId, { limit } = {}) {
    if (!gamelog.enabled) {
        throw new ReviewUnavailable(
            503, 'logging_disabled',
            'Game logging is off, so there is no tape to review.'
        );
    }

    const key = cacheKey(gameId, userId);
    if (cache.has(key)) return cache.get(key);

    const { get, all } = await gamelog.openForRead();

    const game = await get('SELECT * FROM mlog_game WHERE game_id = ?', [gameId]);
    if (!game) {
        // Either the game predates logging or its tape aged out of the
        // retention window. Both are "gone", and neither is an error.
        throw new ReviewUnavailable(
            404, 'no_tape',
            'No recorded history for this game.'
        );
    }

    // A review replays the deal, which means it knows every hand. That is the
    // point of it - seeing what you were up against is the half a live hint
    // could never give - but it is only safe once the game is over. Refusing
    // here is what stops the endpoint being a way to read the table mid-game.
    if (!game.ended_at) {
        throw new ReviewUnavailable(
            409, 'game_in_progress',
            'This game is still in progress.'
        );
    }

    const seatSegments = await seatsFor({ all }, game.game_key);
    const seatForRound = seatResolver(seatSegments, userId);
    if (!seatForRound) {
        throw new ReviewUnavailable(
            403, 'not_a_participant',
            'You did not play in this game.'
        );
    }

    const rounds = await all(
        'SELECT * FROM mlog_round WHERE game_key = ? ORDER BY round_number',
        [game.game_key]
    );
    const actions = await all(
        `SELECT * FROM mlog_action WHERE game_key = ?
          ORDER BY round_number, ply`,
        [game.game_key]
    );

    const actionsByRound = {};
    for (const action of actions) {
        (actionsByRound[action.round_number] ||= []).push(action);
    }

    // Cached unabridged, then sliced on the way out. The examples lookup ranks
    // highlights across games, so it needs the whole set - caching a truncated
    // one would make the cache depend on the limit it was first asked for.
    const { highlights, summary } = reviewGame({
        rounds, actionsByRound, seatForRound, limit: Infinity
    });

    const full = remember(key, {
        gameId,
        gameMode: game.game_mode,
        totalRounds: game.total_rounds,
        endedAt: game.ended_at,
        highlights,
        summary
    });

    return capped(full, limit);
}

/** A review with its highlight list trimmed, leaving the cached copy whole. */
function capped(review, limit) {
    if (!Number.isFinite(limit) || review.highlights.length <= limit) return review;

    let chosen = review.highlights.slice(0, limit);
    // Same reservation reviewGame makes: keep one slot for something that went
    // right rather than handing back a page of nothing but mistakes.
    if (chosen.every(h => h.tone === 'bad')) {
        const bestGood = review.highlights.find(h => h.tone === 'good');
        if (bestGood) chosen = [...chosen.slice(0, limit - 1), bestGood];
    }
    return { ...review, highlights: chosen };
}

/**
 * Worked examples of one kind of decision, drawn from a player's recent games.
 *
 * The single-game review answers "how did that game go". This answers "show me
 * what this number is talking about", which is the question a statistic
 * provokes and could not previously answer.
 *
 * @param {number} userId
 * @param {object} options { topic, mode, limit }
 */
async function examplesForUser(userId, { topic = 'mistakes', mode = null, limit = 8 } = {}) {
    if (!gamelog.enabled) {
        throw new ReviewUnavailable(
            503, 'logging_disabled',
            'Game logging is off, so there is no tape to review.'
        );
    }

    const kinds = TOPICS[topic];
    if (!kinds) {
        throw new ReviewUnavailable(400, 'unknown_topic', `Unknown topic "${topic}".`);
    }

    const { all } = await gamelog.openForRead();

    // Most recent finished games this account sat in. DISTINCT because a player
    // who reconnected holds more than one seat segment in the same game.
    const params = [userId];
    let modeClause = '';
    if (mode) {
        modeClause = 'AND g.game_mode = ?';
        params.push(mode);
    }
    params.push(EXAMPLE_GAME_LIMIT);

    const games = await all(
        `SELECT DISTINCT g.game_id, g.started_at
           FROM mlog_game g
           JOIN mlog_seat s ON s.game_key = g.game_key
          WHERE s.user_id = ? AND g.ended_at IS NOT NULL ${modeClause}
          ORDER BY g.started_at DESC
          LIMIT ?`,
        params
    );

    const found = [];
    for (const game of games) {
        try {
            const review = await reviewForUser(game.game_id, userId, { limit: Infinity });
            for (const h of review.highlights) {
                if (kinds.includes(h.kind)) {
                    // Carried so a training card can say which game it came
                    // from and link back to that game's full review.
                    found.push({ ...h, gameId: game.game_id, playedAt: game.started_at });
                }
            }
        } catch (err) {
            // One unreadable game must not empty the whole list.
            if (!(err instanceof ReviewUnavailable)) throw err;
        }
    }

    return {
        topic,
        examples: found.sort(byImportance).slice(0, limit),
        gamesSearched: games.length,
        totalFound: found.length
    };
}

/** Drops any cached review for a game. For tests and for a re-recorded game. */
function forget(gameId) {
    for (const key of [...cache.keys()]) {
        if (key.startsWith(`${gameId}:`)) cache.delete(key);
    }
}

module.exports = {
    reviewForUser, examplesForUser, forget, ReviewUnavailable, seatResolver,
    EXAMPLE_GAME_LIMIT
};
