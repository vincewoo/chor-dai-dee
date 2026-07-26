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
