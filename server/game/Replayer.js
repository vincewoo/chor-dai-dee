// server/game/Replayer.js
//
// Reconstructs full game state from a logged tape.
//
// The store records only the deal, the seating, and the ordered actions. Every
// intermediate state -- hands, pile, passed set, turn, legal moves -- is a pure
// function of those, so it is re-derived here rather than stored. That keeps
// the corpus ~50-100x smaller, but the real reason is that it prevents rule
// drift: this module imports the same Big2Rules the server plays with, so a
// training pipeline built on replay cannot disagree with the live game about
// what beats what.
//
// It also means the features available for training are not frozen at write
// time. Wanting a new feature in six months costs a re-export, not a corpus.

const { Big2Rules, HAND_TYPE_ORDINALS } = require('./Big2Rules');
const { BotLogic } = require('./BotLogic');
const { buildGameContext } = require('./BotContext');
const { decodeDeal, decodeCards, ACTION } = require('./TapeCodec');

class ReplayError extends Error {
    constructor(message, context) {
        super(message);
        this.name = 'ReplayError';
        Object.assign(this, context);
    }
}

/**
 * A trick is won when every seat other than the pile owner has passed.
 *
 * The subtlety is that "every other seat" shrinks as the round goes on: a seat
 * that has emptied its hand is out and never passes again. RoomManager gets
 * this from live player state; replay reconstructs it from hand sizes.
 */
function othersAllPassed(hands, passedSeats, pileSeat) {
    for (let seat = 0; seat < 4; seat++) {
        if (seat === pileSeat) continue;
        if (hands[seat].length === 0) continue;  // finished, not required to pass
        if (!passedSeats.has(seat)) return false;
    }
    return true;
}

/** Every legal move for a hand against a pile, plus whether passing is legal. */
function enumerateLegalMoves(hand, pile) {
    const all = BotLogic.getAllValidMoves(hand).filter(Boolean);
    const legal = pile ? all.filter(move => Big2Rules.canBeat(move, pile)) : all;
    return {
        plays: legal.map(move => ({
            type: move.type,
            typeOrdinal: HAND_TYPE_ORDINALS[move.type],
            value: move.value,
            cards: move.cards.map(c => c.value)
        })),
        // Passing is illegal on a free lead; RoomManager rejects it outright.
        canPass: Boolean(pile)
    };
}

/**
 * Replays one round.
 *
 * @param {object}   round     { deal: Buffer(52), start_seat, round_number }
 * @param {object[]} actions   Ordered plies from mlog_action.
 * @param {object}   options
 * @param {boolean}  options.legalMoves  Enumerate legal moves per snapshot. Off
 *                                       by default -- it is the expensive part
 *                                       and only the exporter needs it.
 * @param {boolean}  options.strict      Throw on a rule violation (default), or
 *                                       stop and report. The completeness sweep
 *                                       wants the report, not an exception.
 * @returns {{ snapshots, hands, cardsLeft, winnerSeat, complete, error }}
 */
function replayRound(round, actions, options = {}) {
    const { legalMoves = false, strict = true } = options;

    const hands = decodeDeal(round.deal).map(hand => [...hand]);
    const snapshots = [];

    // Mirrors RoomManager's live state. Anything reset there must reset here at
    // the same point, or replay silently diverges after the first trick.
    let pile = null;               // the validated hand currently to beat
    let pileSeat = null;
    let passedSeats = new Set();
    let passCount = 0;
    const playedCards = [];
    const trickHistory = [];       // survives trick boundaries, unlike passedSeats

    let winnerSeat = null;
    let error = null;

    const ordered = [...actions].sort((a, b) => a.ply - b.ply);

    try {
        for (const entry of ordered) {
            const { seat, action, ply } = entry;

            if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
                throw new ReplayError(`ply ${ply}: seat ${seat} out of range`, { ply });
            }
            if (hands[seat].length === 0) {
                throw new ReplayError(`ply ${ply}: seat ${seat} acted with an empty hand`, { ply });
            }

            // Snapshot what the actor saw, before their action is applied.
            const snapshot = {
                roundNumber: round.round_number,
                ply,
                seat,
                // Perfect information in absolute seat order, for a centralized
                // critic. Deliberately separate from `obs` so that leaking
                // hidden state into a policy takes explicit effort.
                hands: hands.map(hand => [...hand]),
                pile,
                pileSeat,
                passedSeats: new Set(passedSeats),
                playedCards: [...playedCards],
                trickHistory: trickHistory.map(e => ({ ...e })),
                // The acting seat's view, re-indexed relative to it, from the
                // same builder the live bot uses.
                obs: buildGameContext({
                    hands,
                    seat,
                    passedSeats,
                    passCount,
                    playedCards,
                    trickHistory,
                    lastPlayedHand: pile,
                    lastPlayedSeat: pileSeat === null ? undefined : pileSeat,
                    profile: null
                }),
                action: entry
            };
            if (legalMoves) snapshot.legal = enumerateLegalMoves(hands[seat], pile);
            snapshots.push(snapshot);

            // --- passes -----------------------------------------------------
            if (action === ACTION.PASS || action === ACTION.AUTO_PASS) {
                // AUTO_PASS is server-generated by the 2S rule rather than a
                // decision, but it moves state identically.
                if (!pile) {
                    throw new ReplayError(
                        `ply ${ply}: seat ${seat} passed on a free lead`, { ply }
                    );
                }
                passedSeats.add(seat);
                passCount++;

                // Auto-passes stay out of trickHistory, matching RoomManager.
                // That history feeds opponent modelling -- "what did this seat
                // decline to beat?" -- and a forced pass against a lone 2S
                // answers nothing, since no single can beat it. Recording it
                // would teach the bot a read that does not exist.
                if (action === ACTION.PASS) {
                    trickHistory.push({ seat, action: 'pass', hand: pile });
                }

                if (othersAllPassed(hands, passedSeats, pileSeat)) {
                    // Trick won. The pile clears and its owner leads fresh.
                    pile = null;
                    pileSeat = null;
                    passedSeats = new Set();
                    passCount = 0;
                }
                continue;
            }

            // --- plays ------------------------------------------------------
            if (action !== ACTION.PLAY) {
                throw new ReplayError(`ply ${ply}: unknown action ${action}`, { ply });
            }

            const cards = decodeCards(entry.cards_mask);
            if (cards.length === 0) {
                throw new ReplayError(`ply ${ply}: play with no cards`, { ply });
            }

            // The seat must hold every card it played. This is the check that
            // catches a corrupt, truncated, or mis-ordered tape.
            const hand = hands[seat];
            for (const card of cards) {
                const idx = hand.findIndex(c => c.value === card.value);
                if (idx === -1) {
                    throw new ReplayError(
                        `ply ${ply}: seat ${seat} played ${card.rank}${card.suit} without holding it`,
                        { ply }
                    );
                }
                hand.splice(idx, 1);
            }

            const validated = Big2Rules.validateHand(cards);
            if (!validated) {
                throw new ReplayError(`ply ${ply}: cards do not form a valid hand`, { ply });
            }
            if (pile && !Big2Rules.canBeat(validated, pile)) {
                throw new ReplayError(
                    `ply ${ply}: ${validated.type} does not beat ${pile.type}`, { ply }
                );
            }

            // Derived columns are denormalized into the tape for query
            // convenience. Replay is the authority, so a mismatch means the
            // writer is wrong -- which is exactly what this catches.
            assertDerived(entry, 'hand_type', HAND_TYPE_ORDINALS[validated.type], ply, validated.type);
            assertDerived(entry, 'hand_value', validated.value, ply, validated.type);

            pile = validated;
            pileSeat = seat;
            playedCards.push(...cards);
            trickHistory.push({ seat, action: 'play', hand: validated, cards });

            // A new lead lets everyone answer again. Under the 2S rule the
            // server marks the other three passed in the same breath, but those
            // arrive as explicit AUTO_PASS plies, so clearing here stays correct.
            passedSeats = new Set();
            passCount = 0;

            if (hand.length === 0) {
                winnerSeat = seat;
                break;   // the round ends the moment a hand empties
            }
        }
    } catch (err) {
        if (strict || !(err instanceof ReplayError)) throw err;
        error = err;
    }

    return {
        snapshots,
        hands,
        cardsLeft: hands.map(hand => hand.length),
        winnerSeat,
        complete: error === null,
        error
    };
}

function assertDerived(entry, column, expected, ply, handType) {
    const stored = entry[column];
    if (stored === null || stored === undefined) return;
    if (stored !== expected) {
        throw new ReplayError(
            `ply ${ply}: stored ${column} ${stored} but replay derived ${expected} (${handType})`,
            { ply }
        );
    }
}

/**
 * Replays a whole game, round by round.
 *
 * Rounds are independent -- each is dealt fresh -- so a corrupt round does not
 * invalidate the others. Non-strict mode reports per round accordingly.
 */
function replayGame(rounds, actionsByRound, options = {}) {
    return rounds
        .slice()
        .sort((a, b) => a.round_number - b.round_number)
        .map(round => ({
            round,
            result: replayRound(round, actionsByRound[round.round_number] || [], options)
        }));
}

module.exports = {
    replayRound,
    replayGame,
    enumerateLegalMoves,
    othersAllPassed,
    ReplayError
};
