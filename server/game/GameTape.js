// server/game/GameTape.js
//
// In-memory buffer for one round's game-log tape.
//
// Kept separate from both RoomManager and gamelog.js on purpose: RoomManager
// stays free of persistence (index.js owns every database call in this
// codebase), and the store stays free of game state. This is the seam - pure
// data, no I/O, no knowledge of SQLite.
//
// Plies accumulate here during play and are written once at round end. A
// per-turn write would put disk I/O in the path of every card played, for a
// consumer that reads the corpus offline, in bulk, weeks later.

const { encodeDeal, encodeCards, ACTION, SOURCE, FLAG, clampThinkMs } = require('./TapeCodec');
const { HAND_TYPE_ORDINALS } = require('./Big2Rules');

class GameTape {
    constructor() {
        this.round = null;
        this.plies = [];
    }

    get isRecording() {
        return this.round !== null;
    }

    /**
     * Starts recording a round. Called right after the deal, before any play,
     * so the deal is captured even for rounds that end immediately (a dragon).
     */
    beginRound({ roundNumber, hands, startSeat, at = Date.now() }) {
        this.round = {
            roundNumber,
            deal: encodeDeal(hands),
            startSeat,
            endReason: 'partial',   // upgraded at endRound; stays 'partial' if the game dies here
            winnerSeat: null,
            startedAt: at,
            endedAt: null,
            cardsLeft: null,
            roundPoints: null,
            scoreAfter: null
        };
        this.plies = [];
    }

    recordPlay({ seat, validated, thinkMs, source, flags = 0 }) {
        if (!this.round) return;
        this.plies.push({
            ply: this.plies.length,
            seat,
            action: ACTION.PLAY,
            cardsMask: encodeCards(validated.cards),
            // Denormalized for query convenience. Replay is the authority and
            // verifies these; a mismatch means this writer is wrong.
            handType: HAND_TYPE_ORDINALS[validated.type],
            handValue: validated.value,
            ...this.timing(thinkMs, flags),
            source
        });
    }

    recordPass({ seat, thinkMs, source, flags = 0, auto = false }) {
        if (!this.round) return;
        this.plies.push({
            ply: this.plies.length,
            seat,
            action: auto ? ACTION.AUTO_PASS : ACTION.PASS,
            cardsMask: 0,
            handType: null,
            handValue: null,
            ...this.timing(auto ? null : thinkMs, flags),
            source
        });
    }

    timing(rawThinkMs, flags) {
        const { thinkMs, clamped } = clampThinkMs(rawThinkMs);
        return { thinkMs, flags: clamped ? (flags | FLAG.THINK_CLAMPED) : flags };
    }

    endRound({ endReason, winnerSeat, cardsLeft, roundPoints, scoreAfter, at = Date.now() }) {
        if (!this.round) return;
        Object.assign(this.round, {
            endReason,
            winnerSeat: winnerSeat ?? null,
            cardsLeft: cardsLeft ?? null,
            roundPoints: roundPoints ?? null,
            scoreAfter: scoreAfter ?? null,
            endedAt: at
        });
    }

    /**
     * Hands off the buffered round and clears it.
     *
     * Clearing on take is what makes a double flush harmless: whoever gets
     * there first writes the round, and the second caller sees nothing to do.
     * Both round-end and room cleanup can fire for the same round.
     */
    take() {
        if (!this.round) return null;
        const payload = { round: this.round, plies: this.plies };
        this.round = null;
        this.plies = [];
        return payload;
    }
}

module.exports = { GameTape, ACTION, SOURCE, FLAG };
