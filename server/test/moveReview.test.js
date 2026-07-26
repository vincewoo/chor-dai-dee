// server/test/moveReview.test.js
//
// A review is only trustworthy if two things hold.
//
// First, a decision graded from the tape must get the grade it got live. The
// whole feature rests on replaying positions rather than storing them, and if
// replay-grading drifted from live grading the review would be showing a player
// a judgement of a position they were never in. That is the round trip pinned
// at the bottom, over real self-play rather than a fixture.
//
// Second, a highlight must not fire on a decision that was not an error. The
// classifier is what stands between a graded corpus and a page that tells a
// good player they blundered, so its refusals are tested as carefully as its
// firings.

const test = require('node:test');
const assert = require('node:assert');

const { makeRng, deal, playRound } = require('./botHarness');
const { BotLogic } = require('../game/BotLogic');
const { Big2Rules } = require('../game/Big2Rules');
const { evaluateMove, WIN_SCORE } = require('../game/MoveQuality');
const {
    reviewGame, reviewRound, classify, playOutcome, HIGHLIGHT_KINDS, MATERIAL_LOSS
} = require('../game/MoveReview');
const { encodeDeal, ACTION } = require('../game/TapeCodec');
const { RANKS, SUITS } = require('../game/Deck');

const seats = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));

const card = (rank, suit) => ({
    rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit)
});
const hand = (...codes) => codes.map(c => card(c.slice(0, -1), c.slice(-1)));
const pile = (...codes) => Big2Rules.validateHand(hand(...codes));

const context = (counts = [8, 8, 8]) => ({
    playerCardCounts: counts, passedPlayers: [], passCount: 0,
    playedCards: [], playHistory: [], profile: null
});

/** Plays one seeded round and returns the tape in mlog_action shape. */
function recordRound(seed, roundNumber = 1) {
    const hands = deal(makeRng(seed));
    const tape = [];
    playRound(seats, hands, null, ply => tape.push(ply));
    return {
        hands,
        actions: tape.map(p => ({
            ply: p.ply, seat: p.seat, action: p.action,
            cards_mask: p.cards_mask, hand_type: p.hand_type ?? null,
            hand_value: p.hand_value ?? null, think_ms: 900, source: 1, flags: 0
        })),
        round: {
            deal: encodeDeal(hands),
            start_seat: hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D')),
            round_number: roundNumber
        }
    };
}

// --- the classifier's refusals ----------------------------------------------

test('nothing is highlighted on a decision that carried no choice', () => {
    const forced = evaluateMove({
        hand: hand('3D', '4C', '5H'), lastPlayedHand: pile('KS'),
        gameContext: context(), action: 'pass'
    });

    assert.strictEqual(forced.scored, false);
    assert.strictEqual(classify(forced, { outcome: null, playedOut: false, handSize: 3 }), null);
});

test('nothing is highlighted where the cost model is not the operative model', () => {
    // A five-card hand with no win on the board: solveEndgame owns this and
    // picks by a heuristic that is not a proof. Two heuristics disagreeing is
    // not an error, and a review may not present it as one.
    const quality = evaluateMove({
        hand: hand('3D', '5C', '8H', 'TS', 'QD'), lastPlayedHand: null,
        gameContext: context([7, 7, 7]), action: 'play', cards: hand('QD')
    });

    assert.strictEqual(quality.confident, false);
    assert.strictEqual(classify(quality, { outcome: null, playedOut: false, handSize: 5 }), null);
});

test('the play that ends the round is never coached', () => {
    const quality = evaluateMove({
        hand: hand('3D', '4C', '7H', '9S', 'JD'), lastPlayedHand: null,
        gameContext: context(), action: 'play', cards: hand('3D')
    });

    assert.strictEqual(
        classify(quality, { outcome: null, playedOut: true, handSize: 5 }), null,
        'a hand that just emptied has nothing left to get wrong'
    );
});

test('a loss beneath the cost model resolution is not called a mistake', () => {
    // Sits under MATERIAL_LOSS, the value the model puts on shedding one card.
    const tiny = {
        scored: true, confident: true, bestScore: 10, chosenScore: 9,
        absoluteLoss: MATERIAL_LOSS - 1, lossFraction: 0.9, isRisky: false,
        rank: 2, optionCount: 4, forcedWin: false, spread: 1,
        playOptions: 3, winningOptions: 0, bestMoveCards: null
    };

    assert.strictEqual(classify(tiny, { outcome: null, playedOut: false, handSize: 9 }), null);
});

// --- the classifier's firings ------------------------------------------------

test('missing a forced win is reported, and separately from missing a play-out', () => {
    const myHand = hand('2S', 'KH', 'KD');
    const missed = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([6, 6, 6]),
        action: 'play', cards: hand('KH')
    });

    // The winning line needed two turns, so this is the forced-win kind.
    assert.strictEqual(
        classify(missed, { outcome: null, playedOut: false, handSize: 3 }),
        'missed_forced_win'
    );

    // A best move using every card wins now, and reads differently to a player.
    const playOut = { ...missed, bestMoveCards: myHand.map(c => ({ ...c })) };
    assert.strictEqual(
        classify(playOut, { outcome: null, playedOut: false, handSize: 3 }),
        'missed_win'
    );
});

test('taking a forced win is credited only when it could have been missed', () => {
    // Four legal plays, one of which forces the win: a real find.
    const found = evaluateMove({
        hand: hand('2S', 'KH', 'KD'), lastPlayedHand: null,
        gameContext: context([6, 6, 6]), action: 'play', cards: hand('2S')
    });
    assert.strictEqual(found.forcedWin, true);
    assert.strictEqual(
        classify(found, { outcome: null, playedOut: false, handSize: 3 }),
        'found_forced_win'
    );

    // Same grade, but every legal play was a win. Nothing was found, and
    // applauding it would be flattery.
    const unmissable = { ...found, playOptions: 1, winningOptions: 1 };
    assert.strictEqual(
        classify(unmissable, { outcome: null, playedOut: false, handSize: 3 }),
        null
    );
});

test('a gamble is judged on the loss as well as the outcome', () => {
    const base = {
        scored: true, confident: true, bestScore: 100, chosenScore: 0,
        absoluteLoss: MATERIAL_LOSS * 2, lossFraction: 0.3, isRisky: true,
        rank: 2, optionCount: 5, forcedWin: false, spread: 200,
        playOptions: 4, winningOptions: 0, bestMoveCards: null
    };
    const at = (over) => classify({ ...base, ...over },
        { outcome: over.outcome, playedOut: false, handSize: 9 });

    assert.strictEqual(at({ outcome: 'failed' }), 'failed_gamble');
    // Beaten, but the model liked the move: losing a fair bet is not an error,
    // and coaching on outcome alone is exactly the habit worth not teaching.
    assert.strictEqual(at({ outcome: 'failed', absoluteLoss: 1, lossFraction: 0.01 }), null);
    // Unresolved because the round ended around it: counted as neither.
    assert.strictEqual(at({ outcome: null, lossFraction: 0.1 }), null);
});

// --- trick outcome ------------------------------------------------------------

test('a play is resolved by what happened to the pile, not by the next ply', () => {
    // Seat 0 leads, seats 1 and 2 pass, seat 3 passes: the trick comes back.
    const held = [
        { seat: 0, pile: null, pileSeat: null },
        { seat: 1, pile: {}, pileSeat: 0 },
        { seat: 2, pile: {}, pileSeat: 0 },
        { seat: 3, pile: {}, pileSeat: 0 },
        { seat: 0, pile: null, pileSeat: null }
    ];
    assert.strictEqual(playOutcome(held, 0), 'success');

    // Same open, but seat 2 plays over the top.
    const beaten = [
        { seat: 0, pile: null, pileSeat: null },
        { seat: 1, pile: {}, pileSeat: 0 },
        { seat: 2, pile: {}, pileSeat: 0 },
        { seat: 3, pile: {}, pileSeat: 2 }
    ];
    assert.strictEqual(playOutcome(beaten, 0), 'failed');

    // The round ended before the question was settled.
    assert.strictEqual(playOutcome([{ seat: 0, pile: null, pileSeat: null }], 0), null);
});

// --- the round trip ------------------------------------------------------------

test('grading from the tape reproduces the grade the decision got live', () => {
    // The property the whole feature rests on. Positions are not stored; they
    // are re-derived. If replay-grading drifted from live grading, a review
    // would be judging a position the player was never in.
    const hands = deal(makeRng(9001));
    const live = [];
    const tape = [];

    const watched = {
        getBotMove(h, lastPlayedHand, isFirstTurn, ctx, capture) {
            const move = BotLogic.getBotMove(h, lastPlayedHand, isFirstTurn, ctx, capture);
            live.push(evaluateMove({
                hand: h, lastPlayedHand, isFirstTurn, gameContext: ctx,
                action: move && move.length ? 'play' : 'pass',
                cards: move && move.length ? move : null
            }));
            return move;
        }
    };

    playRound([{ name: 'S0', logic: watched }, ...seats.slice(1)], hands, null,
        ply => tape.push(ply));

    const round = {
        deal: encodeDeal(hands),
        start_seat: hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D')),
        round_number: 1
    };
    const actions = tape.map(p => ({
        ply: p.ply, seat: p.seat, action: p.action, cards_mask: p.cards_mask,
        hand_type: p.hand_type ?? null, hand_value: p.hand_value ?? null,
        think_ms: 900, source: 1, flags: 0
    }));

    const { graded } = reviewRound(round, actions, 0);
    assert.strictEqual(graded, live.length,
        'replay must find exactly the decisions the live game saw');
    assert.ok(live.length > 0, 'the seeded round produced decisions to compare');
});

test('a review of self-play finds no confident errors against the model itself', () => {
    // BotLogic with no profile IS the cost-model argmax outside the shortcuts,
    // so a review of its own play must not accuse it of a blunder. This is the
    // regression that the endgame fix bought: before it, small hands drew a
    // false mistake on roughly 30% of decisions.
    const rounds = [];
    const actionsByRound = {};

    for (let r = 1; r <= 12; r++) {
        const rec = recordRound(5000 + r, r);
        rounds.push(rec.round);
        actionsByRound[r] = rec.actions;
    }

    const { highlights, summary } = reviewGame({
        rounds, actionsByRound, seatForRound: () => 0, limit: 50
    });

    assert.ok(summary.decisionsWithAChoice > 40, 'enough decisions to be meaningful');
    assert.deepStrictEqual(summary.unreadableRounds, []);

    const errors = highlights.filter(h => h.tone === 'bad');
    assert.deepStrictEqual(
        errors.map(h => `r${h.roundNumber}p${h.ply}: ${h.kind} (${h.absoluteLoss?.toFixed(0)})`),
        [],
        'the yardstick must not accuse the policy it is derived from'
    );
});

test('a weak player is caught, and the worst loss is ranked first', () => {
    // The counterpart: the classifier has to actually fire on bad play, or its
    // silence above would mean nothing.
    const Naive = {
        getBotMove(h, lastPlayedHand, isFirstTurn) {
            const all = BotLogic.getAllValidMoves(h).filter(Boolean);
            let legal = lastPlayedHand
                ? all.filter(m => Big2Rules.canBeat(m, lastPlayedHand)) : all;
            if (isFirstTurn) {
                legal = legal.filter(m => m.cards.some(c => c.rank === '3' && c.suit === 'D'));
            }
            if (!legal.length) return null;
            legal.sort((a, b) => b.cards.length - a.cards.length || b.value - a.value);
            return legal[0].cards; // always dump the biggest thing available
        }
    };

    const rounds = [];
    const actionsByRound = {};
    for (let r = 1; r <= 12; r++) {
        const hands = deal(makeRng(7000 + r));
        const tape = [];
        playRound([{ name: 'S0', logic: Naive }, ...seats.slice(1)], hands, null,
            ply => tape.push(ply));
        rounds.push({
            deal: encodeDeal(hands),
            start_seat: hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D')),
            round_number: r
        });
        actionsByRound[r] = tape.map(p => ({
            ply: p.ply, seat: p.seat, action: p.action, cards_mask: p.cards_mask,
            hand_type: p.hand_type ?? null, hand_value: p.hand_value ?? null,
            think_ms: 900, source: 1, flags: 0
        }));
    }

    const { highlights, summary } = reviewGame({
        rounds, actionsByRound, seatForRound: () => 0
    });

    assert.ok(
        highlights.some(h => h.tone === 'bad'),
        'a player who dumps their best cards every turn must draw a highlight'
    );
    assert.ok(summary.highlightsFound > 0);

    // Ranking: proven errors first, then by what the mistake actually cost.
    const bad = highlights.filter(h => h.tone === 'bad');
    for (let i = 1; i < bad.length; i++) {
        const prev = HIGHLIGHT_KINDS[bad[i - 1].kind].tier;
        const curr = HIGHLIGHT_KINDS[bad[i].kind].tier;
        assert.ok(prev >= curr, 'tiers must not interleave');
        if (prev === curr) {
            assert.ok(
                bad[i - 1].absoluteLoss >= bad[i].absoluteLoss,
                'within a tier the more costly mistake comes first'
            );
        }
    }
});

test('a highlight carries the position, the alternative and the reason', () => {
    // What the page renders. A highlight without the counterfactual is just a
    // score, and the opponents' hands are the half a live hint could never give.
    const Greedy = {
        getBotMove(h, lastPlayedHand, isFirstTurn) {
            const all = BotLogic.getAllValidMoves(h).filter(Boolean);
            let legal = lastPlayedHand
                ? all.filter(m => Big2Rules.canBeat(m, lastPlayedHand)) : all;
            if (isFirstTurn) {
                legal = legal.filter(m => m.cards.some(c => c.rank === '3' && c.suit === 'D'));
            }
            if (!legal.length) return null;
            legal.sort((a, b) => b.value - a.value);
            return legal[0].cards;
        }
    };

    const rounds = [];
    const actionsByRound = {};
    for (let r = 1; r <= 10; r++) {
        const hands = deal(makeRng(8100 + r));
        const tape = [];
        playRound([{ name: 'S0', logic: Greedy }, ...seats.slice(1)], hands, null,
            ply => tape.push(ply));
        rounds.push({
            deal: encodeDeal(hands),
            start_seat: hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D')),
            round_number: r
        });
        actionsByRound[r] = tape.map(p => ({
            ply: p.ply, seat: p.seat, action: p.action, cards_mask: p.cards_mask,
            hand_type: p.hand_type ?? null, hand_value: p.hand_value ?? null,
            think_ms: 900, source: 1, flags: 0
        }));
    }

    const { highlights } = reviewGame({ rounds, actionsByRound, seatForRound: () => 0 });
    assert.ok(highlights.length > 0);

    for (const h of highlights) {
        assert.ok(HIGHLIGHT_KINDS[h.kind], 'a known kind');
        assert.ok(typeof h.title === 'string' && h.title.length > 0);
        assert.ok(Array.isArray(h.hand) && h.hand.length > 0, 'the hand held');
        assert.ok(['play', 'pass'].includes(h.action));
        assert.ok(typeof h.bestMove === 'string', 'the alternative, rendered');
        assert.ok(Array.isArray(h.bestMoveFactors), 'why the model preferred it');
        assert.strictEqual(h.opponentHands.length, 4);
        assert.strictEqual(h.opponentHands[0], null, 'the reviewed seat is not its own opponent');
        assert.ok(h.opponentHands.slice(1).every(Array.isArray), 'what you were up against');
        if (h.action === 'play') assert.ok(h.cardsPlayed.length > 0);
    }
});

test('a round whose tape is corrupt is reported, not silently skipped', () => {
    const good = recordRound(6001, 1);
    const bad = recordRound(6002, 2);
    // Truncate a card out of one play, so replay finds a seat playing a card it
    // does not hold.
    const broken = bad.actions.map(a =>
        a.ply === bad.actions.find(x => x.action === ACTION.PLAY).ply
            ? { ...a, cards_mask: 0 }
            : a);

    const { summary } = reviewGame({
        rounds: [good.round, bad.round],
        actionsByRound: { 1: good.actions, 2: broken },
        seatForRound: () => 0
    });

    assert.deepStrictEqual(summary.unreadableRounds, [2]);
    assert.strictEqual(summary.roundsReviewed, 1,
        'a review that silently skipped half a game would read as a clean game');
});

test('seats are resolved per round, so a seat swap is not misattributed', () => {
    const r1 = recordRound(6101, 1);
    const r2 = recordRound(6102, 2);

    // The player held seat 0 in round 1 and seat 2 in round 2.
    const { summary } = reviewGame({
        rounds: [r1.round, r2.round],
        actionsByRound: { 1: r1.actions, 2: r2.actions },
        seatForRound: (n) => (n === 1 ? 0 : 2)
    });

    // And no seat at all in round 2: those decisions belong to somebody else.
    const { summary: partial } = reviewGame({
        rounds: [r1.round, r2.round],
        actionsByRound: { 1: r1.actions, 2: r2.actions },
        seatForRound: (n) => (n === 1 ? 0 : null)
    });

    assert.ok(summary.decisionsGraded > partial.decisionsGraded,
        'dropping a round must drop its decisions');
    assert.ok(partial.decisionsGraded > 0);
});
