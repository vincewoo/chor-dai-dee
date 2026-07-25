// server/test/replayer.test.js
//
// The store is only lossless if replay actually reconstructs what happened.
// Everything downstream -- every training example, every exported observation
// -- rests on that, so the central test here is not a hand-built fixture but a
// round trip over real self-play: play deterministic rounds, record the tape
// the server would have written, replay it, and require the reconstruction to
// match the live game exactly.

const test = require('node:test');
const assert = require('node:assert');

const { makeRng, deal, playRound } = require('./botHarness');
const { BotLogic } = require('../game/BotLogic');
const { Big2Rules, HAND_TYPE_ORDINALS } = require('../game/Big2Rules');
const { replayRound, enumerateLegalMoves, ReplayError } = require('../game/Replayer');
const {
    encodeDeal, decodeDeal, encodeCards, decodeCards,
    CARD_BY_VALUE, ACTION, clampThinkMs, THINK_MS_CEILING
} = require('../game/TapeCodec');

const seats = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));

/** Plays one seeded round and returns both the live result and its tape. */
function recordRound(seed, roundNumber = 1) {
    const hands = deal(makeRng(seed));
    const tape = [];
    const live = playRound(seats, hands, null, ply => tape.push(ply));
    const startSeat = hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D'));
    return {
        live,
        tape,
        round: { deal: encodeDeal(hands), start_seat: startSeat, round_number: roundNumber }
    };
}

// --- codec -----------------------------------------------------------------

test('deal survives a round trip', () => {
    const hands = deal(makeRng(11));
    const decoded = decodeDeal(encodeDeal(hands));

    for (let seat = 0; seat < 4; seat++) {
        assert.strictEqual(decoded[seat].length, 13);
        assert.deepStrictEqual(
            decoded[seat].map(c => c.value).sort((a, b) => a - b),
            hands[seat].map(c => c.value).sort((a, b) => a - b)
        );
    }
});

test('deal encoding is exactly 52 bytes and covers every card', () => {
    const encoded = encodeDeal(deal(makeRng(12)));
    assert.strictEqual(encoded.length, 52);
    const seen = new Set(decodeDeal(encoded).flat().map(c => c.value));
    assert.strictEqual(seen.size, 52);
});

test('encodeDeal rejects an incomplete deal', () => {
    const hands = deal(makeRng(13));
    hands[0] = hands[0].slice(1);
    assert.throws(() => encodeDeal(hands), /was not dealt/);
});

test('card masks survive a round trip, including the top bit', () => {
    // 2 of Spades is card 51 -- the bit that `1 << 51` would silently wrap to
    // 2^19 under JavaScript's 32-bit bitwise operators.
    const twoOfSpades = CARD_BY_VALUE[51];
    assert.strictEqual(twoOfSpades.rank, '2');
    assert.strictEqual(twoOfSpades.suit, 'S');

    const mask = encodeCards([twoOfSpades]);
    assert.strictEqual(mask, 2 ** 51);
    assert.deepStrictEqual(decodeCards(mask).map(c => c.value), [51]);
});

test('a full 52-card mask stays inside the safe integer range', () => {
    const mask = encodeCards(CARD_BY_VALUE);
    assert.ok(Number.isSafeInteger(mask), 'mask must round-trip through SQLite and JSON exactly');
    assert.strictEqual(decodeCards(mask).length, 52);
});

test('decodeCards returns cards in ascending value order', () => {
    const cards = [CARD_BY_VALUE[40], CARD_BY_VALUE[3], CARD_BY_VALUE[17]];
    assert.deepStrictEqual(decodeCards(encodeCards(cards)).map(c => c.value), [3, 17, 40]);
});

test('encodeCards rejects duplicates', () => {
    assert.throws(() => encodeCards([CARD_BY_VALUE[7], CARD_BY_VALUE[7]]), /duplicate/);
});

test('an empty mask decodes to no cards', () => {
    assert.deepStrictEqual(decodeCards(0), []);
});

// --- think_ms clamping -----------------------------------------------------

test('think_ms passes through below the ceiling and clamps above it', () => {
    assert.deepStrictEqual(clampThinkMs(3200), { thinkMs: 3200, clamped: false });
    assert.deepStrictEqual(clampThinkMs(THINK_MS_CEILING), { thinkMs: THINK_MS_CEILING, clamped: false });
    assert.deepStrictEqual(
        clampThinkMs(8 * 60 * 1000),
        { thinkMs: THINK_MS_CEILING, clamped: true }
    );
});

test('think_ms is null for bots rather than zero', () => {
    // Zero would be a real, trainable value; null means "not applicable".
    assert.deepStrictEqual(clampThinkMs(null), { thinkMs: null, clamped: false });
    assert.deepStrictEqual(clampThinkMs(undefined), { thinkMs: null, clamped: false });
});

// --- round trip over real self-play ----------------------------------------

test('replay reconstructs the final state of real rounds', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const { live, tape, round } = recordRound(seed);
        const result = replayRound(round, tape);

        assert.ok(result.complete, `seed ${seed}: replay did not complete`);
        assert.deepStrictEqual(
            result.cardsLeft, live.cardsLeft,
            `seed ${seed}: cards left diverged`
        );
        assert.strictEqual(
            result.winnerSeat, live.winnerSeat,
            `seed ${seed}: winner diverged`
        );
    }
});

test('replay emits one snapshot per recorded ply', () => {
    for (let seed = 50; seed <= 60; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape);
        assert.strictEqual(result.snapshots.length, tape.length, `seed ${seed}`);
        assert.deepStrictEqual(
            result.snapshots.map(s => s.ply),
            tape.map(p => p.ply),
            `seed ${seed}: snapshots are out of order`
        );
    }
});

test('replayed observations match what the bot actually saw', () => {
    // The strongest guarantee available: if this holds, a policy trained on
    // exported observations sees exactly what the live bot sees. `profile` and
    // `rng` are excluded because they are properties of the agent, not of the
    // game state being reconstructed.
    const stateOnly = (obs) => ({
        playerCardCounts: obs.playerCardCounts,
        lastPlayedByRelative: obs.lastPlayedByRelative,
        passedPlayers: obs.passedPlayers,
        passCount: obs.passCount,
        playedCards: obs.playedCards,
        playHistory: obs.playHistory
    });

    let compared = 0;
    for (let seed = 100; seed <= 130; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape);

        for (const snapshot of result.snapshots) {
            const recorded = tape.find(p => p.ply === snapshot.ply);
            // Auto-passes are server-generated and have no observation.
            if (!recorded.obs) continue;
            assert.deepStrictEqual(
                stateOnly(snapshot.obs), stateOnly(recorded.obs),
                `seed ${seed} ply ${snapshot.ply}: observation diverged`
            );
            compared++;
        }
    }
    assert.ok(compared > 500, `expected a meaningful sample, compared only ${compared}`);
});

test('replayed hands always contain the cards about to be played', () => {
    for (let seed = 200; seed <= 215; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape);

        for (const snapshot of result.snapshots) {
            if (snapshot.action.action !== ACTION.PLAY) continue;
            const held = new Set(snapshot.hands[snapshot.seat].map(c => c.value));
            for (const card of decodeCards(snapshot.action.cards_mask)) {
                assert.ok(held.has(card.value), `seed ${seed}: hand missing a played card`);
            }
        }
    }
});

test('hidden state is complete: all 52 cards are always accounted for', () => {
    for (let seed = 300; seed <= 310; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape);

        for (const snapshot of result.snapshots) {
            const inHands = snapshot.hands.flat().length;
            const played = snapshot.playedCards.length;
            assert.strictEqual(inHands + played, 52, `seed ${seed} ply ${snapshot.ply}`);
        }
    }
});

// --- corruption detection ---------------------------------------------------

test('replay rejects a play the seat does not hold', () => {
    const { tape, round } = recordRound(400);
    const firstPlay = tape.find(p => p.action === ACTION.PLAY);
    // Swap in a card the opener provably does not hold: their own hand minus
    // itself. Card 51 is 2S; if they hold it, use 0 instead.
    const held = new Set(decodeDeal(round.deal)[firstPlay.seat].map(c => c.value));
    const notHeld = [...Array(52).keys()].find(v => !held.has(v));
    const corrupt = tape.map(p => p === firstPlay
        ? { ...p, cards_mask: encodeCards([CARD_BY_VALUE[notHeld]]), hand_type: null, hand_value: null }
        : p);

    assert.throws(() => replayRound(round, corrupt), ReplayError);
});

test('replay rejects a hand that does not beat the pile', () => {
    const { tape, round } = recordRound(401);
    // Find a play answering a pile, and replace it with the lowest single its
    // seat holds -- which cannot beat whatever it originally played over.
    const result = replayRound(round, tape);
    const answering = result.snapshots.find(s =>
        s.action.action === ACTION.PLAY && s.pile && s.hands[s.seat].length > 1);
    assert.ok(answering, 'fixture produced no answering play');

    const weakest = answering.hands[answering.seat]
        .slice().sort((a, b) => a.value - b.value)[0];
    const corrupt = tape.map(p => p.ply === answering.ply
        ? { ...p, cards_mask: encodeCards([weakest]), hand_type: null, hand_value: null }
        : p);

    assert.throws(() => replayRound(round, corrupt), /does not beat|without holding/);
});

test('replay rejects a stored hand_type that disagrees with the rules', () => {
    const { tape, round } = recordRound(402);
    const firstPlay = tape.find(p => p.action === ACTION.PLAY);
    const corrupt = tape.map(p => p === firstPlay
        ? { ...p, hand_type: (p.hand_type + 1) % 8 }
        : p);

    assert.throws(() => replayRound(round, corrupt), /stored hand_type/);
});

test('replay rejects a stored hand_value that disagrees with the rules', () => {
    const { tape, round } = recordRound(403);
    const firstPlay = tape.find(p => p.action === ACTION.PLAY);
    const corrupt = tape.map(p => p === firstPlay ? { ...p, hand_value: p.hand_value + 1 } : p);

    assert.throws(() => replayRound(round, corrupt), /stored hand_value/);
});

test('non-strict mode reports corruption instead of throwing', () => {
    // The completeness sweep runs over the whole corpus and wants a report per
    // round, not an exception that stops the scan.
    const { tape, round } = recordRound(404);
    const firstPlay = tape.find(p => p.action === ACTION.PLAY);
    const corrupt = tape.map(p => p === firstPlay ? { ...p, hand_value: p.hand_value + 1 } : p);

    const result = replayRound(round, corrupt, { strict: false });
    assert.strictEqual(result.complete, false);
    assert.ok(result.error instanceof ReplayError);
    assert.match(result.error.message, /stored hand_value/);
    // Snapshots up to the failure are still usable.
    assert.ok(result.snapshots.length > 0);
});

test('replay rejects a pass on a free lead', () => {
    const { round } = recordRound(405);
    const tape = [{ ply: 0, seat: round.start_seat, action: ACTION.PASS, cards_mask: 0 }];
    assert.throws(() => replayRound(round, tape), /passed on a free lead/);
});

test('replay rejects an out-of-range seat', () => {
    const { round } = recordRound(406);
    const tape = [{ ply: 0, seat: 7, action: ACTION.PLAY, cards_mask: 1 }];
    assert.throws(() => replayRound(round, tape), /out of range/);
});

// --- legal moves ------------------------------------------------------------

test('legal moves on a free lead include every valid combination', () => {
    const { tape, round } = recordRound(500);
    const result = replayRound(round, tape, { legalMoves: true });
    const lead = result.snapshots[0];

    assert.strictEqual(lead.pile, null);
    assert.strictEqual(lead.legal.canPass, false, 'passing is illegal on a free lead');
    assert.ok(lead.legal.plays.length > 13, 'a full hand has more than 13 combinations');
});

test('every enumerated legal move actually beats the pile', () => {
    for (let seed = 600; seed <= 610; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape, { legalMoves: true });

        for (const snapshot of result.snapshots) {
            if (!snapshot.pile || !snapshot.legal) continue;
            for (const move of snapshot.legal.plays) {
                const validated = Big2Rules.validateHand(move.cards.map(v => CARD_BY_VALUE[v]));
                assert.ok(validated, `seed ${seed}: enumerated an invalid hand`);
                assert.ok(
                    Big2Rules.canBeat(validated, snapshot.pile),
                    `seed ${seed}: enumerated ${validated.type} does not beat the pile`
                );
            }
            assert.strictEqual(snapshot.legal.canPass, true);
        }
    }
});

test('the move actually played is always among the legal moves', () => {
    // If this ever fails, either the enumerator is incomplete or the game
    // allowed something it should not have.
    for (let seed = 700; seed <= 712; seed++) {
        const { tape, round } = recordRound(seed);
        const result = replayRound(round, tape, { legalMoves: true });

        for (const snapshot of result.snapshots) {
            const { action, cards_mask: mask } = snapshot.action;
            if (action !== ACTION.PLAY) continue;
            const played = decodeCards(mask).map(c => c.value).join(',');
            const found = snapshot.legal.plays.some(m => m.cards.join(',') === played);
            assert.ok(found, `seed ${seed} ply ${snapshot.ply}: played move was not enumerated as legal`);
        }
    }
});

test('legal move enumeration is skipped unless asked for', () => {
    const { tape, round } = recordRound(800);
    const result = replayRound(round, tape);
    assert.ok(result.snapshots.every(s => s.legal === undefined));
});

test('enumerateLegalMoves narrows as the pile gets stronger', () => {
    const hand = [0, 4, 8, 12, 16, 20, 24, 28].map(v => CARD_BY_VALUE[v]);
    const free = enumerateLegalMoves(hand, null);
    const overNine = enumerateLegalMoves(hand, Big2Rules.validateHand([CARD_BY_VALUE[24]]));

    assert.ok(overNine.plays.length < free.plays.length);
    assert.ok(overNine.plays.every(m => m.typeOrdinal !== HAND_TYPE_ORDINALS.SINGLE
        || m.value > 24));
});
