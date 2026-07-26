// server/test/decisionAnalyzer.test.js
//
// The Tier 3 aggregates are cumulative and cannot be recomputed after the fact,
// so the parts pinned here are the ones whose meaning has to stay fixed: that
// counts are counts of decisions (not of games), that round phase is read from
// the deck rather than from a decision's position in the list, and that the
// adaptability definition does not quietly drift back into
// measuring something else.

const test = require('node:test');
const assert = require('node:assert');

const { DecisionAnalyzer } = require('../game/DecisionAnalyzer');

/** A decision record shaped like the ones Room.tier3DecisionTracking holds. */
const decision = (overrides = {}) => ({
    round: 1,
    turn: 0,
    action: 'play',
    quality: 'optimal',
    isRisky: false,
    riskOutcome: null,
    handSize: 10,
    cardsInDeck: 52,
    ...overrides
});

test('summarizeDecisions counts decisions, not games', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ quality: 'optimal' }),
        decision({ quality: 'suboptimal' }),
        decision({ quality: 'optimal', action: 'pass' })
    ]);

    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.optimal, 2);
    assert.strictEqual(summary.suboptimal, 1);
    assert.strictEqual(summary.plays, 2);
    assert.strictEqual(summary.passes, 1);
});

test('summarizeDecisions counts only resolved risky plays', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ isRisky: true, riskOutcome: 'success' }),
        decision({ isRisky: true, riskOutcome: 'failed' }),
        // Round ended before the trick resolved: neither a success nor a failure.
        decision({ isRisky: true, riskOutcome: null })
    ]);

    assert.strictEqual(summary.riskySucceeded, 1);
    assert.strictEqual(summary.riskyFailed, 1);
});

test('round phase comes from the deck remaining, not list position', () => {
    // 5 cards played of 52 -- opening of a round, even if it is the last
    // decision of a long game.
    const early = decision({ cardsInDeck: 47 });
    // 40 cards played of 52.
    const late = decision({ cardsInDeck: 12 });

    assert.strictEqual(DecisionAnalyzer.isEarlyGameDecision(early), true);
    assert.strictEqual(DecisionAnalyzer.isLateGameDecision(early), false);
    assert.strictEqual(DecisionAnalyzer.isLateGameDecision(late), true);
    assert.strictEqual(DecisionAnalyzer.isEarlyGameDecision(late), false);
});

test('late-game counts track quality of late decisions only', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ cardsInDeck: 50, quality: 'suboptimal' }), // early, ignored
        decision({ cardsInDeck: 10, quality: 'optimal' }),
        decision({ cardsInDeck: 8, quality: 'suboptimal' })
    ]);

    assert.strictEqual(summary.lateTotal, 2);
    assert.strictEqual(summary.lateOptimal, 1);
});

test('risk score scales with how often risks are taken', () => {
    const rare = DecisionAnalyzer.calculateRiskScore(1, 1, 100);
    const frequent = DecisionAnalyzer.calculateRiskScore(25, 25, 100);

    assert.ok(frequent > rare, 'taking more risks should score higher');
    // Same success rate either way, so the difference is frequency alone.
    assert.ok(rare >= 0 && frequent <= 1);
});

test('adaptability measures trend, not spread', () => {
    // Newest first, as getPlacementHistory returns. Improving: recent 1sts,
    // earlier 4ths.
    const improving = DecisionAnalyzer.calculateAdaptabilityScore([1, 1, 1, 4, 4, 4]);
    const declining = DecisionAnalyzer.calculateAdaptabilityScore([4, 4, 4, 1, 1, 1]);
    // Same results in both halves: form has not moved.
    const flat = DecisionAnalyzer.calculateAdaptabilityScore([2, 3, 2, 2, 3, 2]);

    assert.ok(improving > 0.9, `improving player should score high, got ${improving}`);
    assert.ok(declining < 0.1, `declining player should score low, got ${declining}`);
    assert.ok(Math.abs(flat - 0.5) < 0.1, `flat form should sit near 0.5, got ${flat}`);
});

test('adaptability is not the same measurement as consistency', () => {
    // Identical spread, opposite trends -- a variance-based score would give
    // these two the same number, which is exactly the duplication being fixed.
    const up = DecisionAnalyzer.calculateAdaptabilityScore([1, 1, 1, 4, 4, 4]);
    const down = DecisionAnalyzer.calculateAdaptabilityScore([4, 4, 4, 1, 1, 1]);

    assert.notStrictEqual(up, down);
});

test('adaptability is neutral without enough history', () => {
    assert.strictEqual(DecisionAnalyzer.calculateAdaptabilityScore([1, 2, 3]), 0.5);
    assert.strictEqual(DecisionAnalyzer.calculateAdaptabilityScore([]), 0.5);
});

test('lucky-vs-skilled classification is not reintroduced', () => {
    // The deal-strength stats own the luck-vs-skill question. A helper here
    // would mean a second, uncalibrated answer to it.
    assert.strictEqual(DecisionAnalyzer.isLuckyWin, undefined);
});
