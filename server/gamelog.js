// server/gamelog.js
//
// Append-only store of complete game histories, for offline machine learning.
//
// Deliberately a separate database from database.sqlite:
//
//   - Opposite write profile. The app database serves interactive reads (stats,
//     leaderboard, activity feed); this one is write-only during play and read
//     only by offline tooling, and grows ~100x faster. Sharing a connection and
//     a WAL would put log flushes in contention with the round-end stats path.
//   - Different lifecycle. The corpus gets copied off the volume, truncated,
//     and rebuilt as the schema evolves. Doing that to a file holding user
//     accounts is needlessly risky.
//   - Different retention. Accounts are permanent; raw hand histories are not.
//
// Everything here is an observer of gameplay. No failure in this module may
// ever surface to a player or abort a round transition -- see `guard`.

const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { RULES_VERSION } = require('./game/Big2Rules');
const { encodeDeal } = require('./game/TapeCodec');

/**
 * Bump when the physical layout or the meaning of any stored value changes.
 *
 * Includes lossy transforms: THINK_MS_CEILING is pinned to this, because
 * changing the ceiling makes old and new rows incomparable. Also includes the
 * HAND_TYPE_ORDINALS mapping and the ACTION/SOURCE/FLAG codes -- reordering any
 * of them would silently rewrite the meaning of every logged row.
 *
 * Changelog:
 *   1 - initial schema.
 */
const SCHEMA_VERSION = 1;

const isProduction = process.env.NODE_ENV === 'production';
const dbPath = process.env.GAMELOG_PATH || (isProduction
    ? '/data/gamelog.sqlite'
    : path.join(__dirname, 'gamelog.sqlite'));

// Logging is opt-in via env so that turning it off is a config change rather
// than a deploy, and so tests and local dev do not accumulate a corpus by
// accident.
const enabled = process.env.GAMELOG_ENABLED === '1';

// Identifies the exact source that produced a game. rules_version and
// BOT_LOGIC_VERSION are hand-maintained and can be forgotten; this cannot be
// wrong. When they disagree, this wins.
const serverBuild = process.env.GIT_SHA
    || process.env.FLY_MACHINE_VERSION
    || null;

// HMAC key for pseudonymizing user ids at export. Never leaves the server, and
// is not needed for writing -- raw user_id is stored locally and hashed only on
// the way out.
const exportSecret = process.env.GAMELOG_EXPORT_SECRET || null;

let db = null;
let ready = null;

/**
 * Wraps every write so a store failure can never reach a player.
 *
 * A malformed row, a full disk, or a locked database must not abort a round
 * transition or surface as an error mid-game. This is the one hard rule in the
 * write path, and gamelog.test.js asserts it by injecting a throwing driver.
 */
function guard(label, fn) {
    return async (...args) => {
        if (!enabled) return null;
        try {
            await open();
            return await fn(...args);
        } catch (err) {
            console.error(`[gamelog] ${label} failed:`, err.message);
            return null;
        }
    };
}

function open() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) return reject(err);
            db.serialize(() => {
                // Same tuning as db.js. WAL keeps durability across process
                // crashes at a fraction of the fsync cost, which matters more
                // here than there -- this is the higher-volume writer.
                db.run('PRAGMA journal_mode = WAL');
                db.run('PRAGMA synchronous = NORMAL');
                db.run('PRAGMA busy_timeout = 5000');
                createSchema(err2 => err2 ? reject(err2) : resolve(db));
            });
        });
    });
    return ready;
}

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS mlog_game (
        game_key          INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id           TEXT    NOT NULL UNIQUE,
        room_id           TEXT    NOT NULL,
        game_mode         TEXT    NOT NULL,
        point_threshold   INTEGER NOT NULL,
        advanced_bots     INTEGER NOT NULL DEFAULT 0,
        schema_version    INTEGER NOT NULL,
        rules_version     INTEGER NOT NULL,
        server_build      TEXT,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER,
        end_reason        TEXT CHECK(end_reason IN ('threshold','dragon','abandoned')),
        abandon_reason    TEXT CHECK(abandon_reason IN
                             ('all_bots','single_player_timeout',
                              'multiplayer_timeout','orphaned_restart')),
        total_rounds      INTEGER NOT NULL DEFAULT 0,
        winner_seat       INTEGER,
        previous_game_key INTEGER,
        chain_kind        TEXT CHECK(chain_kind IN ('rematch','lobby_restart'))
    )`,

    `CREATE TABLE IF NOT EXISTS mlog_seat (
        game_key        INTEGER NOT NULL,
        seat            INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
        segment         INTEGER NOT NULL DEFAULT 0,
        from_round      INTEGER NOT NULL,
        to_round        INTEGER,
        occupant        TEXT    NOT NULL CHECK(occupant IN
                           ('human','guest','bot_heuristic','bot_ppo')),
        subject_key     TEXT,
        policy_gen      INTEGER,
        policy_ref      TEXT,
        user_id         INTEGER,
        rating_mu       REAL,
        rating_sigma    REAL,
        joined_mid_game INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_key, seat, segment)
    )`,

    `CREATE TABLE IF NOT EXISTS mlog_round (
        game_key     INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        deal         BLOB    NOT NULL,
        start_seat   INTEGER NOT NULL,
        end_reason   TEXT    NOT NULL CHECK(end_reason IN ('normal','dragon','partial')),
        winner_seat  INTEGER,
        ply_count    INTEGER NOT NULL DEFAULT 0,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        cards_left   TEXT,
        round_points TEXT,
        score_after  TEXT,
        PRIMARY KEY (game_key, round_number)
    )`,

    `CREATE TABLE IF NOT EXISTS mlog_action (
        game_key     INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        ply          INTEGER NOT NULL,
        seat         INTEGER NOT NULL,
        action       INTEGER NOT NULL,
        cards_mask   INTEGER NOT NULL DEFAULT 0,
        hand_type    INTEGER,
        hand_value   INTEGER,
        think_ms     INTEGER,
        source       INTEGER NOT NULL,
        flags        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_key, round_number, ply)
    ) WITHOUT ROWID`,

    `CREATE INDEX IF NOT EXISTS idx_mlog_game_started ON mlog_game(started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mlog_game_reason  ON mlog_game(end_reason, started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mlog_seat_user    ON mlog_seat(user_id)
        WHERE user_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_mlog_seat_occupant ON mlog_seat(occupant)`,
    `CREATE INDEX IF NOT EXISTS idx_mlog_game_prev    ON mlog_game(previous_game_key)
        WHERE previous_game_key IS NOT NULL`
];

function createSchema(done) {
    db.serialize(() => {
        let pending = SCHEMA.length;
        let failed = null;
        for (const stmt of SCHEMA) {
            db.run(stmt, (err) => {
                if (err && !failed) failed = err;
                if (--pending === 0) done(failed);
            });
        }
    });
}

// --- promise wrappers -------------------------------------------------------

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err); else resolve(this);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// Transactions are serialized through a promise chain: node-sqlite3 uses one
// connection, so overlapping BEGINs would fail outright. Two games ending at
// once queue rather than error. Same approach as db.js.
let transactionQueue = Promise.resolve();

function withTransaction(fn) {
    const result = transactionQueue.then(async () => {
        await run('BEGIN IMMEDIATE');
        try {
            const value = await fn();
            await run('COMMIT');
            return value;
        } catch (err) {
            try { await run('ROLLBACK'); } catch (e) {
                console.error('[gamelog] rollback failed:', e.message);
            }
            throw err;
        }
    });
    transactionQueue = result.then(() => {}, () => {});
    return result;
}

// --- writes -----------------------------------------------------------------

/**
 * Opens a game and its initial seat segments.
 *
 * previousGameId is resolved to a surrogate key here. If the predecessor was
 * never logged -- opted out, or a failed write -- the lookup yields NULL and
 * the chain simply breaks rather than pointing at the wrong game.
 */
const openGame = guard('openGame', async (game, seats) => {
    return withTransaction(async () => {
        let previousKey = null;
        if (game.previousGameId) {
            const row = await get(
                'SELECT game_key FROM mlog_game WHERE game_id = ?', [game.previousGameId]
            );
            previousKey = row ? row.game_key : null;
        }

        const res = await run(
            `INSERT INTO mlog_game
                (game_id, room_id, game_mode, point_threshold, advanced_bots,
                 schema_version, rules_version, server_build, started_at,
                 previous_game_key, chain_kind)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(game_id) DO NOTHING`,
            [
                game.gameId, game.roomId, game.gameMode, game.pointThreshold,
                game.advancedBots ? 1 : 0, SCHEMA_VERSION, RULES_VERSION,
                serverBuild, game.startedAt,
                previousKey, previousKey === null ? null : (game.chainKind || null)
            ]
        );

        // Branch on `changes`, not `lastID`. On an ON CONFLICT DO NOTHING no-op
        // node-sqlite3 leaves lastID holding a *stale* rowid from an earlier
        // insert rather than zeroing it, so `lastID || lookup` silently returns
        // some other game's key. changes === 0 is the only reliable signal that
        // the row already existed.
        const gameKey = res.changes > 0
            ? res.lastID
            : (await get(
                'SELECT game_key FROM mlog_game WHERE game_id = ?', [game.gameId]
            )).game_key;

        for (const seat of seats) {
            await insertSeat(gameKey, seat);
        }
        return gameKey;
    });
});

function insertSeat(gameKey, seat) {
    return run(
        `INSERT INTO mlog_seat
            (game_key, seat, segment, from_round, to_round, occupant, subject_key,
             policy_gen, policy_ref, user_id, rating_mu, rating_sigma, joined_mid_game)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(game_key, seat, segment) DO NOTHING`,
        [
            gameKey, seat.seat, seat.segment || 0, seat.fromRound, seat.toRound ?? null,
            seat.occupant, seat.subjectKey ?? null, seat.policyGen ?? null,
            seat.policyRef ?? null, seat.userId ?? null,
            seat.ratingMu ?? null, seat.ratingSigma ?? null,
            seat.joinedMidGame ? 1 : 0
        ]
    );
}

/**
 * Closes the current occupancy segment for a seat and opens the next.
 *
 * This is what keeps a mid-game bot/human swap from corrupting attribution:
 * the seat is stable, the occupant is not, and both facts are recorded.
 */
const changeSeat = guard('changeSeat', async (gameKey, seat, atRound, next) => {
    return withTransaction(async () => {
        const current = await get(
            `SELECT MAX(segment) AS segment FROM mlog_seat
             WHERE game_key = ? AND seat = ?`, [gameKey, seat]
        );
        const segment = (current && current.segment !== null) ? current.segment : 0;

        await run(
            `UPDATE mlog_seat SET to_round = ?
             WHERE game_key = ? AND seat = ? AND segment = ?`,
            [atRound, gameKey, seat, segment]
        );
        await insertSeat(gameKey, { ...next, seat, segment: segment + 1, fromRound: atRound });
    });
});

/**
 * Persists a completed round: the round row plus its whole tape, in one
 * transaction.
 *
 * Plies are buffered in memory during play and written once here rather than
 * per turn. A per-turn write would put disk I/O in the path of every card
 * played, for a consumer that reads the data offline weeks later in bulk.
 */
const writeRound = guard('writeRound', async (gameKey, round, plies) => {
    return withTransaction(async () => {
        await run(
            `INSERT INTO mlog_round
                (game_key, round_number, deal, start_seat, end_reason, winner_seat,
                 ply_count, started_at, ended_at, cards_left, round_points, score_after)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(game_key, round_number) DO UPDATE SET
                end_reason = excluded.end_reason,
                winner_seat = excluded.winner_seat,
                ply_count = excluded.ply_count,
                ended_at = excluded.ended_at,
                cards_left = excluded.cards_left,
                round_points = excluded.round_points,
                score_after = excluded.score_after`,
            [
                gameKey, round.roundNumber, round.deal, round.startSeat,
                round.endReason, round.winnerSeat ?? null, plies.length,
                round.startedAt, round.endedAt ?? null,
                json(round.cardsLeft), json(round.roundPoints), json(round.scoreAfter)
            ]
        );

        for (const ply of plies) {
            await run(
                `INSERT INTO mlog_action
                    (game_key, round_number, ply, seat, action, cards_mask,
                     hand_type, hand_value, think_ms, source, flags)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(game_key, round_number, ply) DO NOTHING`,
                [
                    gameKey, round.roundNumber, ply.ply, ply.seat, ply.action,
                    ply.cardsMask, ply.handType ?? null, ply.handValue ?? null,
                    ply.thinkMs ?? null, ply.source, ply.flags || 0
                ]
            );
        }
    });
});

const closeGame = guard('closeGame', async (gameKey, close) => {
    return run(
        `UPDATE mlog_game
            SET ended_at = ?, end_reason = ?, abandon_reason = ?,
                total_rounds = ?, winner_seat = ?
          WHERE game_key = ?`,
        [
            close.endedAt, close.endReason, close.abandonReason ?? null,
            close.totalRounds, close.winnerSeat ?? null, gameKey
        ]
    );
});

/**
 * Marks games left open by a process death.
 *
 * Without this they stay indistinguishable from live games forever -- which is
 * exactly the state game_history is in today, where nothing ever writes
 * 'abandoned' and every abandoned game since launch still reads 'in_progress'.
 *
 * Runs at boot, before connections are accepted: at that moment no game in this
 * database can legitimately be in progress.
 */
const sweepOrphans = guard('sweepOrphans', async () => {
    const res = await run(
        `UPDATE mlog_game
            SET ended_at = ?, end_reason = 'abandoned', abandon_reason = 'orphaned_restart'
          WHERE ended_at IS NULL`,
        [Date.now()]
    );
    if (res.changes > 0) {
        console.log(`[gamelog] closed ${res.changes} game(s) orphaned by restart`);
    }
    return res.changes;
});

// --- reads (offline tooling) ------------------------------------------------

async function openForRead() {
    await open();
    return { run, get, all, withTransaction };
}

/** Stable, non-reversible per-player id for exports. */
function subjectKeyFor(userId) {
    if (userId === null || userId === undefined) return null;
    if (!exportSecret) {
        throw new Error('GAMELOG_EXPORT_SECRET must be set to export pseudonymized data');
    }
    return 'h:' + crypto.createHmac('sha256', exportSecret)
        .update(String(userId)).digest('hex').slice(0, 16);
}

const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

module.exports = {
    SCHEMA_VERSION,
    dbPath,
    enabled,
    openGame,
    changeSeat,
    writeRound,
    closeGame,
    sweepOrphans,
    openForRead,
    subjectKeyFor,
    encodeDeal,
    // Test seams.
    _internal: { open, withTransaction, run, get, all }
};
