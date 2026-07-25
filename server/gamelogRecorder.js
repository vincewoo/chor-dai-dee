// server/gamelogRecorder.js
//
// Glue between live gameplay and the game log.
//
// Exists so index.js gains one-line calls rather than persistence logic, and so
// RoomManager stays free of database access (index.js owns every DB call in
// this codebase; RoomManager only maintains an in-memory tape).
//
// Every function here is safe to call unconditionally. They no-op when logging
// is disabled, when the room opted out, or when there is nothing buffered --
// so call sites do not need guards, and a missed edge case degrades to "not
// logged" rather than to a crash mid-game.

const gamelog = require('./gamelog');
const { getUserPreferences, getUserByUsername } = require('./db');

/**
 * Whether this room's games may be recorded.
 *
 * If any seated human has opted out, the whole game is skipped. Partial
 * logging is not offered: a deal with one hand redacted is useless for the
 * perfect-information training this store exists to enable, so it would cost
 * the privacy without buying the data.
 *
 * Cached per room per game, because this runs on the start_game path and would
 * otherwise issue a preferences lookup per human on every game.
 */
async function isLoggingAllowed(room) {
    if (!gamelog.enabled) return false;
    if (room._logAllowedFor === room.gameId) return room._logAllowed;

    let allowed = true;
    try {
        for (const player of room.players) {
            if (player.isBot || player.isGuest) continue;
            const user = await getUserByUsername(player.name);
            if (!user) continue;
            const prefs = await getUserPreferences(user.id);
            if (prefs && prefs.ml_logging_opt_out) {
                allowed = false;
                break;
            }
            // Cache the id so describeSeats can attribute rows without a
            // second lookup at round end.
            player.userId = user.id;
        }
    } catch (err) {
        // Fail closed. If we cannot establish consent, we do not record.
        console.error('[gamelog] consent check failed, not recording:', err.message);
        allowed = false;
    }

    room._logAllowedFor = room.gameId;
    room._logAllowed = allowed;
    return allowed;
}

/** Opens a game and its seat segments. Idempotent per gameId. */
async function recordGameStart(room) {
    if (!(await isLoggingAllowed(room))) return null;

    room.gameKey = await gamelog.openGame({
        gameId: room.gameId,
        roomId: room.id,
        gameMode: room.gameMode,
        pointThreshold: room.pointThreshold,
        advancedBots: room.settings.useAdvancedBots,
        startedAt: Date.now(),
        previousGameId: room.previousGameId,
        chainKind: room.chainKind
    }, room.describeSeats(room.roundNumber || 1));

    return room.gameKey;
}

/**
 * Flushes whatever round is buffered.
 *
 * Safe to call more than once for the same round: GameTape.take() clears the
 * buffer, so whoever gets there first writes it and later callers see nothing.
 * Both round-end and room cleanup can fire for one round.
 */
async function recordRoundEnd(room, outcome = {}) {
    if (!room.gameKey || !room.tape.isRecording) return;

    room.tape.endRound({
        endReason: outcome.endReason || 'normal',
        winnerSeat: outcome.winnerSeat,
        cardsLeft: outcome.cardsLeft,
        roundPoints: outcome.roundPoints,
        scoreAfter: outcome.scoreAfter
    });

    const payload = room.tape.take();
    if (payload) await gamelog.writeRound(room.gameKey, payload.round, payload.plies);
}

/** Closes a game that reached its natural end. */
async function recordGameEnd(room, { endReason, winnerSeat }) {
    if (!room.gameKey) return;
    await gamelog.closeGame(room.gameKey, {
        endedAt: Date.now(),
        endReason,
        totalRounds: room.roundNumber,
        winnerSeat: winnerSeat ?? null
    });
}

/**
 * Flushes a room reaped by cleanup: the in-flight round as 'partial', then the
 * game as abandoned with the reason the cleanup rule fired.
 */
async function recordAbandon(room, abandonReason) {
    if (!room.gameKey) return;

    if (room.tape.isRecording) {
        room.tape.endRound({ endReason: 'partial' });
        const payload = room.tape.take();
        if (payload) await gamelog.writeRound(room.gameKey, payload.round, payload.plies);
    }

    await gamelog.closeGame(room.gameKey, {
        endedAt: Date.now(),
        endReason: 'abandoned',
        abandonReason,
        totalRounds: room.roundNumber,
        winnerSeat: null
    });
}

/**
 * Records a change of occupant at a seat.
 *
 * This is what stops a mid-game bot/human swap from corrupting attribution.
 * The seat is stable; who sits in it is not, and both facts are recorded so a
 * trajectory can be attributed to whoever actually produced it.
 */
async function recordSeatChange(room, seat) {
    if (!room.gameKey || seat < 0) return;
    const occupant = room.describeSeats(room.roundNumber)[seat];
    if (!occupant) return;
    await gamelog.changeSeat(room.gameKey, seat, room.roundNumber, occupant);
}

module.exports = {
    isLoggingAllowed,
    recordGameStart,
    recordRoundEnd,
    recordGameEnd,
    recordAbandon,
    recordSeatChange
};
