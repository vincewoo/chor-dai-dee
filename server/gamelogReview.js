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
const { reviewGame } = require('./game/MoveReview');

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

    const { highlights, summary } = reviewGame({
        rounds, actionsByRound, seatForRound, limit
    });

    return remember(key, {
        gameId,
        gameMode: game.game_mode,
        totalRounds: game.total_rounds,
        endedAt: game.ended_at,
        highlights,
        summary
    });
}

/** Drops any cached review for a game. For tests and for a re-recorded game. */
function forget(gameId) {
    for (const key of [...cache.keys()]) {
        if (key.startsWith(`${gameId}:`)) cache.delete(key);
    }
}

module.exports = { reviewForUser, forget, ReviewUnavailable, seatResolver };
