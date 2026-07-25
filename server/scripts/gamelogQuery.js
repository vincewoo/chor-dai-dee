// server/scripts/gamelogQuery.js
//
// Shared read helpers for the offline tools (export, sweep, archive). Kept in
// one place so all three agree about what a "game" is -- particularly which
// games are eligible, which is the difference between a clean corpus and a
// biased one.

const gamelog = require('../gamelog');

/** Games in a key range, oldest first. */
async function listGames(db, { since = null, until = null, limit = null } = {}) {
    const where = [];
    const params = [];
    if (since !== null) { where.push('game_key >= ?'); params.push(since); }
    if (until !== null) { where.push('game_key <= ?'); params.push(until); }
    const sql = `SELECT * FROM mlog_game
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY game_key
                 ${limit ? 'LIMIT ' + Number(limit) : ''}`;
    return db.all(sql, params);
}

/** Seat segments for a game, keyed by seat, each ordered by segment. */
async function seatsFor(db, gameKey) {
    const rows = await db.all(
        'SELECT * FROM mlog_seat WHERE game_key = ? ORDER BY seat, segment', [gameKey]
    );
    const bySeat = [[], [], [], []];
    for (const row of rows) bySeat[row.seat].push(row);
    return bySeat;
}

/**
 * The seat segment in force during a given round.
 *
 * Occupancy changes mid-game, so "who played this trajectory" is a function of
 * the round, not of the game. Attributing a whole game to whoever happened to
 * finish in a seat is how a bot's plays get labelled as a human's.
 */
function occupantAtRound(segments, roundNumber) {
    let found = null;
    for (const seg of segments) {
        if (seg.from_round > roundNumber) continue;
        if (seg.to_round !== null && roundNumber >= seg.to_round) continue;
        found = seg;
    }
    return found || segments[segments.length - 1] || null;
}

async function roundsFor(db, gameKey) {
    return db.all(
        'SELECT * FROM mlog_round WHERE game_key = ? ORDER BY round_number', [gameKey]
    );
}

async function actionsFor(db, gameKey, roundNumber) {
    return db.all(
        `SELECT * FROM mlog_action
          WHERE game_key = ? AND round_number = ?
          ORDER BY ply`,
        [gameKey, roundNumber]
    );
}

/** Opens the log read-only-ish and hands back the query helpers. */
async function connect() {
    const db = await gamelog.openForRead();
    return db;
}

module.exports = {
    connect, listGames, seatsFor, roundsFor, actionsFor, occupantAtRound
};
