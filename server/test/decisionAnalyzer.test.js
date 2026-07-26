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
    // Graded by MoveQuality: `scored` false means the move was forced and must
    // stay out of every accuracy figure.
    scored: true,
    forced: false,
    lossFraction: 0,
    isRisky: false,
    riskOutcome: null,
    handSize: 10,
    cardsInDeck: 52,
    ...overrides
});

test('summarizeDecisions counts decisions, not games', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ quality: 'optimal' }),
        decision({ quality: 'mistake' }),
        decision({ quality: 'optimal', action: 'pass' })
    ]);

    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.optimal, 2);
    assert.strictEqual(summary.suboptimal, 1);
    assert.strictEqual(summary.plays, 2);
    assert.strictEqual(summary.passes, 1);
});

test('forced moves are counted apart and never graded', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ quality: 'optimal', lossFraction: 0 }),
        // Nothing beat the pile: no choice was made here.
        decision({ scored: false, forced: true, quality: null, lossFraction: null, action: 'pass' }),
        decision({ quality: 'inaccuracy', lossFraction: 0.3 })
    ]);

    assert.strictEqual(summary.total, 2, 'only decisions with a choice are graded');
    assert.strictEqual(summary.forced, 1);
    assert.strictEqual(summary.suboptimal, 1);
    assert.ok(Math.abs(summary.totalLoss - 0.3) < 1e-9);
    // Accuracy is derived from these two: 1 - 0.3/2 = 0.85.
    assert.strictEqual(summary.passes, 1, 'a forced pass is still a pass');
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
        decision({ cardsInDeck: 50, quality: 'mistake' }), // early, ignored
        decision({ cardsInDeck: 10, quality: 'optimal' }),
        decision({ cardsInDeck: 8, quality: 'mistake' })
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

test('passes split by whether a legal answer existed', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ action: 'pass', scored: false, forced: true, quality: null, lossFraction: null }),
        decision({ action: 'pass', quality: 'good', lossFraction: 0.1 }),
        decision({ action: 'pass', quality: 'optimal' }),
        decision({ action: 'play' })
    ]);

    assert.strictEqual(summary.passes, 3);
    assert.strictEqual(summary.forcedPasses, 1, 'nothing beat the pile');
    assert.strictEqual(summary.voluntaryPasses, 2, 'held a legal answer back');
});

test('danger response counts only turns that offered a choice', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        // Opponent on two cards, contested.
        decision({ action: 'play', minOpponentCards: 2 }),
        // Opponent on one card, conceded.
        decision({ action: 'pass', minOpponentCards: 1 }),
        // Opponent on one card but nothing could beat the pile: not a failure.
        decision({ action: 'pass', minOpponentCards: 1, scored: false, forced: true, quality: null, lossFraction: null }),
        // Nobody close to going out.
        decision({ action: 'pass', minOpponentCards: 9 })
    ]);

    assert.strictEqual(summary.dangerDecisions, 2);
    assert.strictEqual(summary.dangerContested, 1);
});

test('aggression measures early engagement, not the whole round', () => {
    // Played 6 of 8 early decisions that offered a choice.
    assert.strictEqual(DecisionAnalyzer.calculateAggressionScore(6, 8), 0.75);
    // No early choices recorded: neutral, never NaN.
    assert.strictEqual(DecisionAnalyzer.calculateAggressionScore(0, 0), 0.5);
    // Passing without ever playing used to divide by zero and poison the
    // stored EWMA with NaN forever.
    assert.ok(Number.isFinite(DecisionAnalyzer.calculateAggressionScore(0, 5)));
    assert.strictEqual(DecisionAnalyzer.calculateAggressionScore(0, 5), 0);
});

test('risk score rises monotonically with how much is gambled', () => {
    const never = DecisionAnalyzer.calculateRiskScore(0, 0, 50);
    const rareWon = DecisionAnalyzer.calculateRiskScore(2, 0, 50);
    const rareLost = DecisionAnalyzer.calculateRiskScore(0, 2, 50);
    const frequent = DecisionAnalyzer.calculateRiskScore(10, 10, 50);

    assert.strictEqual(never, 0, 'never gambling is zero risk, not 0.2');
    assert.strictEqual(rareWon, rareLost, 'outcome must not change the risk taken');
    assert.ok(frequent > rareWon, 'more gambles means more risk');
    // The old formula had the reckless loser BELOW the cautious winner.
    assert.ok(DecisionAnalyzer.calculateRiskScore(0, 20, 50) > rareWon);
});

test('summarizeDecisions splits play rate by round phase', () => {
    const summary = DecisionAnalyzer.summarizeDecisions([
        decision({ action: 'play', cardsInDeck: 50 }),
        decision({ action: 'pass', cardsInDeck: 48 }),
        decision({ action: 'play', cardsInDeck: 8 }),
        decision({ action: 'play', cardsInDeck: 6 })
    ]);

    assert.strictEqual(summary.choicePlays, 3);
    assert.strictEqual(summary.earlyChoices, 2);
    assert.strictEqual(summary.earlyChoicePlays, 1);
    assert.strictEqual(summary.lateChoices, 2);
    assert.strictEqual(summary.lateChoicePlays, 2);
});
