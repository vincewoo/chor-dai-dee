// server/test/moveQuality.test.js
//
// Move quality is the foundation every Tier 3 "quality" figure now rests on, so
// what is pinned here is the contract rather than any particular score: which
// decisions get graded at all, that the grade is relative to the alternatives
// that existed, and that the yardstick is deterministic.

const test = require('node:test');
const assert = require('node:assert');

const { evaluateMove } = require('../game/MoveQuality');
const { DecisionAnalyzer } = require('../game/DecisionAnalyzer');
const { BotLogic } = require('../game/BotLogic');
const { Big2Rules } = require('../game/Big2Rules');
const { RANKS, SUITS } = require('../game/Deck');

const card = (rank, suit) => ({
    rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit)
});

/** Build a hand from "rank+suit" shorthand, e.g. hand('3D', 'KS'). */
const hand = (...codes) => codes.map(code => {
    const suit = code.slice(-1);
    return card(code.slice(0, -1), suit);
});

/** A validated pile, as RoomManager would hold it. */
const pile = (...codes) => {
    const cards = hand(...codes);
    return Big2Rules.validateHand(cards);
};

const context = (opponentCounts = [8, 8, 8]) => ({
    playerCardCounts: opponentCounts,
    passedPlayers: [],
    passCount: 0,
    playedCards: [],
    playHistory: [],
    profile: null
});

test('a pass with nothing that beats the pile is forced, not graded', () => {
    const result = evaluateMove({
        hand: hand('3D', '4C', '5H'),
        lastPlayedHand: pile('KS'),
        gameContext: context(),
        action: 'pass'
    });

    assert.strictEqual(result.forced, true);
    assert.strictEqual(result.scored, false);
    assert.strictEqual(result.quality, null);
});

test('a lone legal lead is forced, not graded', () => {
    const result = evaluateMove({
        hand: hand('7C'),
        lastPlayedHand: null,
        gameContext: context(),
        action: 'play',
        cards: hand('7C')
    });

    assert.strictEqual(result.forced, true);
    assert.strictEqual(result.scored, false);
});

test('a real choice is graded and ranked among the alternatives', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'KC', '2S');
    const result = evaluateMove({
        hand: myHand,
        lastPlayedHand: null,
        gameContext: context(),
        action: 'play',
        cards: hand('3D')
    });

    assert.strictEqual(result.scored, true);
    assert.strictEqual(result.forced, false);
    assert.ok(result.optionCount > 1, 'several leads were available');
    assert.ok(result.rank >= 1 && result.rank <= result.optionCount);
    assert.ok(result.lossFraction >= 0 && result.lossFraction <= 1);
    assert.ok(['optimal', 'good', 'inaccuracy', 'mistake'].includes(result.quality));
});

test('shedding the lowest card leads better than burning the 2', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'KC', '2S');
    const cheap = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context(),
        action: 'play', cards: hand('3D')
    });
    const burn = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context(),
        action: 'play', cards: hand('2S')
    });

    assert.ok(
        cheap.lossFraction < burn.lossFraction,
        `leading 3D (${cheap.lossFraction}) should grade better than leading 2S (${burn.lossFraction})`
    );
});

test('spending a 2 to beat a low single grades worse than passing', () => {
    // The price-of-the-trick rule: the 2 costs more than this trick is worth.
    const myHand = hand('2S', '5C', '6D', '8H', '9C', 'TD', 'JS', 'QH');
    const passed = evaluateMove({
        hand: myHand, lastPlayedHand: pile('4S'), gameContext: context(),
        action: 'pass'
    });
    const burned = evaluateMove({
        hand: myHand, lastPlayedHand: pile('4S'), gameContext: context(),
        action: 'play', cards: hand('2S')
    });

    assert.strictEqual(passed.scored, true);
    assert.strictEqual(burned.scored, true);
    assert.ok(
        passed.lossFraction < burned.lossFraction,
        `passing (${passed.lossFraction}) should beat burning the 2S (${burned.lossFraction})`
    );
});

test('passing is not an option when a winning play is on the table', () => {
    // One card left and it beats the pile: passing up the round is the error.
    const myHand = hand('AS');
    const passed = evaluateMove({
        hand: myHand, lastPlayedHand: pile('KD'), gameContext: context([3, 3, 3]),
        action: 'pass'
    });

    assert.strictEqual(passed.scored, true, 'play-or-pass is a real choice');
    assert.strictEqual(passed.quality, 'mistake');
    assert.strictEqual(passed.lossFraction, 1);
});

test('grading is deterministic and profile-free', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'KC', '2S');
    const args = {
        hand: myHand, lastPlayedHand: null, gameContext: context(),
        action: 'play', cards: hand('7H')
    };

    const first = evaluateMove({ ...args });
    const second = evaluateMove({ ...args });
    // A bot profile makes live play sample near the top rather than take the
    // argmax; the yardstick must ignore it entirely.
    const withProfile = evaluateMove({
        ...args,
        gameContext: { ...context(), profile: BotLogic.getBotProfile('Bot 2') }
    });

    assert.strictEqual(first.lossFraction, second.lossFraction);
    assert.strictEqual(first.lossFraction, withProfile.lossFraction);
    assert.strictEqual(first.rank, withProfile.rank);
});

test('risk is the value at stake, not the rank played', () => {
    const myHand = hand('AS', '5C', '6D', '8H', '9C', 'TD', 'JS', 'QH', '3C', '4D');

    // An ace with the deck still full: expensive, and beatable.
    const gamble = evaluateMove({
        hand: myHand, lastPlayedHand: pile('KD'), gameContext: context(),
        action: 'play', cards: hand('AS')
    });
    // A low card stakes nothing worth losing.
    const cheap = evaluateMove({
        hand: myHand, lastPlayedHand: pile('4S'), gameContext: context(),
        action: 'play', cards: hand('5C')
    });

    assert.strictEqual(gamble.isRisky, true);
    assert.strictEqual(cheap.isRisky, false);
});

test('the same card is not a gamble once nothing can beat it', () => {
    const myHand = hand('AS', '5C', '6D', '8H');
    // Every card that beats an ace is already gone, so the model expects it to
    // hold outright - a strong play rather than a bet.
    const spent = hand('2S', '2H', '2D', '2C');
    const safe = evaluateMove({
        hand: myHand,
        lastPlayedHand: pile('KD'),
        gameContext: { ...context([5, 5, 5]), playedCards: spent },
        action: 'play',
        cards: hand('AS')
    });

    assert.strictEqual(safe.isRisky, false);
});

test('a move that is not legal in the position is not graded', () => {
    const result = evaluateMove({
        hand: hand('3D', '4C', '5H', '6S', '7D'),
        lastPlayedHand: pile('KS'),
        gameContext: context(),
        action: 'play',
        cards: hand('3D') // cannot beat a king
    });

    assert.strictEqual(result.scored, false);
    assert.strictEqual(result.quality, null);
});

// --- the endgame gap ---------------------------------------------------------
//
// BotLogic hands off to solveEndgame at five cards, and this module deliberately
// does not follow it there. Measured against self-play that cost 30% of all
// small-hand decisions a false "mistake", and 96% of a strong player's flagged
// mistakes came from this one range. What follows pins the two halves of the
// repair: defer to search where search proves an answer, and decline to assert
// an error where it does not.

test('a forced two-move win is graded optimal, not a blunder', () => {
    // 2S cannot be beaten, and KH KD plays out as a pair next turn. The cost
    // model on its own hates leading a 2 and used to rank this near the bottom.
    const myHand = hand('2S', 'KH', 'KD');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([6, 6, 6]),
        action: 'play', cards: hand('2S')
    });

    assert.strictEqual(result.scored, true);
    assert.strictEqual(result.forcedWin, true);
    assert.strictEqual(result.quality, 'optimal');
    assert.strictEqual(result.lossFraction, 0);
});

test('every forcing move is credited, not just the first one found', () => {
    // solveEndgame returns the first forced win it enumerates because it only
    // needs one to play. Grading has to credit them all: 2S and 2H each leave a
    // valid pair and neither can be beaten, so both are optimal. 2D is not -
    // 2C is still outstanding and beats it.
    const myHand = hand('2S', '2H', '2D');
    const ctx = context([6, 6, 6]);

    const spades = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: ctx,
        action: 'play', cards: hand('2S')
    });
    const hearts = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: ctx,
        action: 'play', cards: hand('2H')
    });
    const diamonds = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: ctx,
        action: 'play', cards: hand('2D')
    });

    assert.strictEqual(spades.forcedWin, true);
    assert.strictEqual(hearts.forcedWin, true);
    assert.strictEqual(spades.quality, 'optimal');
    assert.strictEqual(hearts.quality, 'optimal');
    assert.strictEqual(diamonds.forcedWin, false, '2C outstanding beats 2D');
});

test('missing a forced win is a confident mistake', () => {
    // The counterpart: the win was there and the player led a king instead.
    const myHand = hand('2S', 'KH', 'KD');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([6, 6, 6]),
        action: 'play', cards: hand('KH')
    });

    assert.strictEqual(result.quality, 'mistake');
    assert.strictEqual(result.confident, true, 'a proof settles this position');
    assert.ok(result.absoluteLoss > 1e5, 'the gap is the whole win');
});

test('a small hand with no win on the board is graded but not confident', () => {
    // solveEndgame owns this position and picks by a "power" heuristic that is
    // neither the cost model nor a proof. Two heuristics disagreeing is not
    // evidence of a mistake, so the score stands but nothing may call it one.
    const myHand = hand('3D', '5C', '8H', 'TS', 'QD');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([7, 7, 7]),
        action: 'play', cards: hand('QD')
    });

    assert.strictEqual(result.scored, true);
    assert.strictEqual(result.confident, false);
    assert.notStrictEqual(result.quality, null, 'still scored for the aggregates');
});

test('the last-card emergency is graded but not confident', () => {
    // selectBestMove abandons scoring outright to block here, and whether a
    // given block works depends on the one card they hold - unknowable from
    // this side of the table.
    //
    // The hand carries a pair deliberately. With the next player on one card
    // the highest-single rule leaves exactly one legal single, so a hand of all
    // distinct ranks would have a single legal lead and grade as forced - a
    // different branch from the one under test here.
    const myHand = hand('3D', '3C', '8H', 'TS', 'QD', 'KC', 'AH');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([1, 7, 7]),
        action: 'play', cards: hand('3D', '3C')
    });

    assert.strictEqual(result.scored, true);
    assert.strictEqual(result.confident, false);
});

test('the highest-single rule leaves a single legal lead forced', () => {
    // Same position, but every rank distinct: no pair, triple or five-card
    // shape to lead, so restricting singles to the highest leaves exactly one
    // legal move. Nothing was chosen, so nothing is graded.
    const myHand = hand('3D', '5C', '8H', 'TS', 'QD', 'KC', 'AH');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([1, 7, 7]),
        action: 'play', cards: hand('AH')
    });

    assert.strictEqual(result.scored, false);
});

test('an ordinary midgame decision is confident', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'KC', '2S', '5H');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([8, 8, 8]),
        action: 'play', cards: hand('3D')
    });

    assert.strictEqual(result.confident, true);
});

test('absolute loss is carried alongside the normalized fraction', () => {
    // lossFraction is normalized to the spread at one decision, so it cannot
    // tell "gave up a lot" from "every option was near-identical". Ranking the
    // worst few decisions in a game needs the raw gap.
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'KC', '2S', '5H');
    const result = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context(),
        action: 'play', cards: hand('2S')
    });

    assert.strictEqual(typeof result.absoluteLoss, 'number');
    assert.ok(result.absoluteLoss >= 0);
    assert.strictEqual(typeof result.spread, 'number');
    // The structured form the review renders from.
    assert.ok(Array.isArray(result.bestMoveCards));
    assert.strictEqual(
        result.bestMoveCards.map(c => `${c.rank}${c.suit}`).join(' '),
        result.bestMove
    );
});

test('every archetype is reachable, and the reference reads Balanced', () => {
    const { classifyArchetype } = DecisionAnalyzer;

    assert.strictEqual(classifyArchetype(0.90, 0.30), 'Aggressive');
    assert.strictEqual(classifyArchetype(0.60, 0.10), 'Conservative');
    assert.strictEqual(classifyArchetype(0.60, 0.32), 'Opportunist');
    // A player who plays exactly like the measured reference is not a type.
    assert.strictEqual(classifyArchetype(0.765, 0.200), 'Balanced');

    // Sweep a plausible human range: no label may be unreachable, which is
    // what the previous thresholds were.
    const seen = new Set();
    for (let a = 0.4; a <= 1.0001; a += 0.02) {
        for (let r = 0; r <= 0.45; r += 0.02) seen.add(classifyArchetype(a, r));
    }
    assert.deepStrictEqual(
        [...seen].sort(),
        ['Aggressive', 'Balanced', 'Conservative', 'Opportunist']
    );
});
