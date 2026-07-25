// server/game/BotContext.js

/**
 * Builds the observation a bot reasons over.
 *
 * This is the bot's feature set, not room bookkeeping, so it lives with the
 * policy rather than inside RoomManager. Three callers need it to agree
 * exactly:
 *
 *   - RoomManager.checkBotTurn, which drives live play;
 *   - test/botHarness.js, which drives self-play benchmarks;
 *   - Replayer, which reconstructs observations from logged games so a policy
 *     trained on exported data sees what the live bot sees.
 *
 * Each of those previously built the object by hand. A divergence between the
 * first two would silently mean the benchmark measures a bot that does not
 * exist in production; a divergence involving the third would mean training
 * data describes a different game than the one being played.
 *
 * State is passed in seat-indexed and plain. It deliberately does not accept a
 * Room: the replayer reconstructs state from a tape and never builds Room
 * instances, and socket ids are not stable within a game anyway.
 */

/**
 * @param {object[]} hands       Four hands, indexed by seat. Only lengths are read.
 * @param {number}   seat        Seat about to act, 0-3.
 * @param {Set<number>|number[]} passedSeats  Seats that have passed this trick.
 * @param {number}   passCount   Consecutive passes.
 * @param {object[]} playedCards Every card played this round.
 * @param {object[]} trickHistory Ordered {seat, action, hand} for the round.
 *                                Survives trick boundaries, unlike passedSeats.
 * @param {object}   lastPlayedHand The pile to beat, or null when leading.
 * @param {number}   lastPlayedSeat Seat that played it. Defaults to
 *                                  lastPlayedHand.seat when present.
 * @param {object}   profile     Per-bot temperament from BotLogic.getBotProfile.
 * @param {function} rng         Optional deterministic RNG. Production omits
 *                               this and BotLogic falls back to Math.random;
 *                               the benchmark injects a seeded one.
 */
function buildGameContext({
    hands,
    seat,
    passedSeats,
    passCount = 0,
    playedCards = [],
    trickHistory = [],
    lastPlayedHand = null,
    lastPlayedSeat = undefined,
    profile = null,
    rng = undefined
}) {
    const passed = passedSeats instanceof Set ? passedSeats : new Set(passedSeats || []);

    const context = {
        playerCardCounts: [],
        lastPlayedByRelative: null,
        passedPlayers: [],
        passCount,
        playedCards: [...playedCards],
        // Re-indexed relative to `seat`: 1=next, 2=across, 3=previous. Entries
        // for the acting seat itself are dropped - a bot modelling opponents
        // has no use for its own plays.
        playHistory: [],
        profile
    };

    // Only set when provided. BotLogic does `ctx.rng || Math.random`, so an
    // explicit undefined would work too, but omitting the key keeps the
    // production context shape identical to what it was before extraction.
    if (rng !== undefined) context.rng = rng;

    // Card counts in turn order starting from the next seat.
    for (let i = 1; i <= 3; i++) {
        const idx = (seat + i) % 4;
        const hand = hands[idx];
        context.playerCardCounts.push(hand ? hand.length : 0);
        if (passed.has(idx)) {
            context.passedPlayers.push(i - 1); // 0=next, 1=across, 2=previous
        }
    }

    for (const entry of trickHistory) {
        if (entry.seat === seat || !entry.hand) continue;
        context.playHistory.push({
            relative: (entry.seat - seat + 4) % 4,
            action: entry.action,
            hand: entry.hand
        });
    }

    const pileSeat = lastPlayedSeat !== undefined
        ? lastPlayedSeat
        : (lastPlayedHand ? lastPlayedHand.seat : undefined);

    if (lastPlayedHand && pileSeat !== undefined && pileSeat !== null) {
        let relative = (pileSeat - seat + 4) % 4;
        // The pile can only belong to the acting seat if everyone else passed,
        // in which case the trick is already won and this context is not built.
        if (relative === 0) relative = 4;
        context.lastPlayedByRelative = relative;
    }

    return context;
}

module.exports = { buildGameContext };
