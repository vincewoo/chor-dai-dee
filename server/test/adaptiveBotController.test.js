const test = require('node:test');
const assert = require('node:assert');

const {
    defaultCalibration,
    averageCalibrations,
    summarizeEvidence,
    updateCalibration,
    publicCalibration
} = require('../game/AdaptiveBotController');

const decisions = (count, {
    round = 1,
    lossFraction = 0.05,
    confident = true,
    scored = true
} = {}) => Array.from({ length: count }, (_, index) => ({
    round: round + Math.floor(index / 8),
    lossFraction,
    confident,
    scored
}));

const rounds = (count, { dealRank = 3, placement = 1 } = {}) =>
    Array.from({ length: count }, (_, index) => ({
        round: index + 1,
        dealRank,
        placement
    }));

test('room calibration averages every human estimate', () => {
    const average = averageCalibrations([
        { ...defaultCalibration(), lastTemperature: 4, skillMu: 0.8 },
        { ...defaultCalibration(), lastTemperature: 10, skillMu: 0.5 },
        { ...defaultCalibration(), lastTemperature: 16, skillMu: 0.2 }
    ]);

    assert.strictEqual(average.lastTemperature, 10);
    assert.strictEqual(average.skillMu, 0.5);
});

test('only confident choices count and each round is capped', () => {
    const evidence = summarizeEvidence({
        decisions: [
            ...decisions(20).map(decision => ({ ...decision, round: 1 })),
            ...decisions(5, { confident: false }),
            ...decisions(5, { scored: false })
        ]
    });

    assert.strictEqual(evidence.effectiveDecisions, 8);
    assert.ok(Math.abs(evidence.meanLoss - 0.05) < 1e-12);
});

test('the per-round cap still represents choices from the whole round', () => {
    const evidence = summarizeEvidence({
        decisions: [
            ...decisions(8, { lossFraction: 0 }),
            ...decisions(8, { lossFraction: 1 })
        ].map(decision => ({ ...decision, round: 1 }))
    });

    assert.strictEqual(evidence.effectiveDecisions, 8);
    assert.ok(Math.abs(evidence.meanLoss - 0.5) < 1e-12);
});

test('a long game moves the estimate more than a short game with the same play', () => {
    const initial = defaultCalibration();
    const shortEvidence = summarizeEvidence({
        decisions: decisions(8),
        rounds: rounds(2)
    });
    const longEvidence = summarizeEvidence({
        decisions: decisions(40),
        rounds: rounds(8)
    });

    const short = updateCalibration(initial, shortEvidence).calibration;
    const long = updateCalibration(initial, longEvidence).calibration;

    assert.ok(long.skillMu > short.skillMu);
    assert.ok(long.lastTemperature < short.lastTemperature);
});

test('calibration needs games and evidence, but never traps a player past ten', () => {
    let value = defaultCalibration();
    const useful = summarizeEvidence({
        decisions: decisions(24),
        rounds: rounds(4)
    });

    for (let game = 0; game < 4; game++) {
        value = updateCalibration(value, useful).calibration;
    }
    assert.strictEqual(value.calibrationComplete, false);

    value = updateCalibration(value, useful).calibration;
    assert.strictEqual(value.calibrationComplete, true);
    assert.strictEqual(publicCalibration(value).progress, 100);

    let sparse = defaultCalibration();
    const sparseEvidence = summarizeEvidence({
        decisions: decisions(1),
        rounds: rounds(1)
    });
    for (let game = 0; game < 10; game++) {
        sparse = updateCalibration(sparse, sparseEvidence).calibration;
    }
    assert.strictEqual(sparse.calibrationComplete, true);
    assert.ok(sparse.skillSigma > 0.08,
        'the ten-game stop must not pretend sparse evidence is certain');
});

test('temperature changes are smaller after calibration', () => {
    const strongEvidence = summarizeEvidence({
        decisions: decisions(80, { lossFraction: 0 }),
        rounds: rounds(12)
    });
    const calibrated = {
        ...defaultCalibration(),
        calibrationComplete: true,
        completedGames: 8,
        meaningfulDecisions: 200,
        completedRounds: 30,
        lastTemperature: 10
    };

    const next = updateCalibration(
        calibrated, strongEvidence).calibration;
    assert.ok(next.lastTemperature < 10);
    assert.ok(10 - next.lastTemperature <= 0.75);
});

// Max Bots games count toward placement, but the table was deliberately set
// above the player's own calibration, so where they finished is not read as
// skill. `outcomeCounts: false` withholds that inference without discarding the
// rounds themselves - they are real completed rounds and buy real progress.
test('outcomeCounts:false keeps the rounds and drops only the skill claim', () => {
    const played = { decisions: decisions(24), rounds: rounds(6) };
    const counted = summarizeEvidence(played);
    const withheld = summarizeEvidence({ ...played, outcomeCounts: false });

    assert.strictEqual(withheld.completedRounds, counted.completedRounds,
        'the rounds still count toward placement progress');
    assert.strictEqual(withheld.effectiveDecisions, counted.effectiveDecisions);
    assert.strictEqual(withheld.decisionSkill, counted.decisionSkill);
    assert.notStrictEqual(counted.outcomeSkill, null);
    assert.strictEqual(withheld.outcomeSkill, null);
});

test('a withheld outcome is no opinion, not a bad one', () => {
    // Losing every round to a table set above you must not read as evidence
    // that you are worse than a player who won every round against it.
    const lost = {
        decisions: decisions(24),
        rounds: rounds(6, { dealRank: 1, placement: 4 }),
        outcomeCounts: false
    };
    const won = {
        decisions: decisions(24),
        rounds: rounds(6, { dealRank: 4, placement: 1 }),
        outcomeCounts: false
    };
    const start = defaultCalibration();

    const afterLoss = updateCalibration(start, summarizeEvidence(lost));
    const afterWin = updateCalibration(start, summarizeEvidence(won));
    assert.strictEqual(afterLoss.calibration.skillMu,
        afterWin.calibration.skillMu,
        'with the outcome withheld, only decision quality may move skill');

    // And it must not be silently read as zero skill either: good decisions
    // still push the estimate up from the forgiving cold start.
    assert.ok(afterLoss.calibration.skillMu > start.skillMu,
        'decision quality is still admissible evidence');
});

test('placement still completes on Max Bots evidence alone', () => {
    // The failure this fixes: a player who only ever chose the hardest bots
    // never completed placement and stayed Unranked indefinitely.
    let calibration = defaultCalibration();
    for (let game = 0; game < 5; game++) {
        calibration = updateCalibration(calibration, summarizeEvidence({
            decisions: decisions(24),
            rounds: rounds(4),
            outcomeCounts: false
        })).calibration;
    }
    assert.strictEqual(calibration.calibrationComplete, true);
    assert.ok(calibration.completedRounds >= 15);
});
