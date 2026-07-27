const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { RANKS, SUITS } = require('../game/Deck');
const { Big2Rules } = require('../game/Big2Rules');
const { BotLogic } = require('../game/BotLogic');
const { RLValueModel, FEATURE_NAMES } = require('../game/RLValueModel');
const { RLValueBot, decisionOptions } = require('../game/RLValueBot');
const {
    makeRng, deal, playRound, playRoundAsync
} = require('./botHarness');
const {
    main: trainMain, roundUtilities, saveCheckpoint
} = require('../scripts/train-rl-value-bot');
const {
    main: experienceMain,
    rowsForRound
} = require('../scripts/generate-rl-experience');
const {
    reconstructDecision,
    utilitiesByRound
} = require('../scripts/convert-human-export');
const {
    parseBenchmark,
    seedForWorker,
    compareBenchmarkReports,
    interpolateValueArtifacts,
    selectConservativeCandidate,
    promotionDecision
} = require('../scripts/run-rl-generation');

function card(text) {
    const suit = text.slice(-1);
    const rank = text.slice(0, -1);
    return { rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) };
}

function hand(text) {
    return text.split(/\s+/).filter(Boolean).map(card);
}

function context(overrides = {}) {
    return {
        playerCardCounts: [13, 13, 13],
        lastPlayedByRelative: null,
        passedPlayers: [],
        passCount: 0,
        playedCards: [],
        playHistory: [],
        ...overrides
    };
}

test('candidate encoder returns the pinned finite feature schema', () => {
    const options = decisionOptions({
        hand: hand('3D 3C 4D 5D 6D 7D 8D AS 2S'),
        lastPlayedHand: null,
        isFirstTurn: true,
        gameContext: context()
    });
    assert.ok(options.length > 0);
    assert.strictEqual(options.filter(option => option.isHeuristicChoice).length, 1);
    for (const option of options) {
        assert.strictEqual(option.features.length, FEATURE_NAMES.length);
        assert.ok(option.features.every(Number.isFinite));
    }
});

test('value policy can capture every candidate for policy distillation', () => {
    const decisions = [];
    const bot = new RLValueBot(new RLValueModel({
        hiddenSize: 7,
        seed: 19
    }), {
        captureTrajectory: true,
        onDecision: decision => decisions.push(decision)
    });
    bot.getBotMove(
        hand('3D 3C 4D 5D 6D 7D 8D AS 2S'),
        null,
        true,
        context()
    );
    assert.strictEqual(decisions.length, 1);
    assert.ok(decisions[0].actionFeatures.length > 1);
    assert.strictEqual(
        decisions[0].actionFeatures[decisions[0].chosenIndex].length,
        FEATURE_NAMES.length
    );
    assert.ok(decisions[0].heuristicIndex >= 0);
});

test('opening action set is rules-faithful and always contains 3D', () => {
    const options = decisionOptions({
        hand: hand('3D 3C 4D 5D 6D 7D 8D 9S AS 2S'),
        lastPlayedHand: null,
        isFirstTurn: true,
        gameContext: context()
    });
    assert.ok(options.length > 1);
    assert.ok(options.every(option =>
        option.move.cards.some(c => c.rank === '3' && c.suit === 'D')));
    assert.ok(options.every(option => option.move.cards.length !== 4));
});

test('response set includes pass and only server-legal plays', () => {
    const pile = Big2Rules.validateHand(hand('8D'));
    const options = decisionOptions({
        hand: hand('3D 7C 9D 10C JS QH KS AH 2S'),
        lastPlayedHand: pile,
        isFirstTurn: false,
        gameContext: context({ lastPlayedByRelative: 3 })
    });
    assert.ok(options.some(option => option.action === 'pass'));
    for (const option of options.filter(option => option.action === 'play')) {
        assert.ok(Big2Rules.canBeat(option.move, pile));
    }
});

test('model artifacts round-trip without changing predictions', () => {
    const model = new RLValueModel({ hiddenSize: 7, seed: 19 });
    const features = Array(FEATURE_NAMES.length).fill(0).map((_, i) => i / 100);
    const artifact = model.toArtifact({ fixture: true });
    const loaded = RLValueModel.fromArtifact(JSON.parse(JSON.stringify(artifact)));
    assert.strictEqual(loaded.predict(features), model.predict(features));
    assert.throws(() => RLValueModel.fromArtifact({
        ...artifact, featureNames: [...FEATURE_NAMES].reverse()
    }), /feature schema/);
});

test('training update learns a simple target', () => {
    const model = new RLValueModel({ hiddenSize: 8, seed: 4 });
    const features = Array(FEATURE_NAMES.length).fill(0);
    features[0] = 1;
    const before = Math.abs(model.predict(features) - 0.75);
    for (let i = 0; i < 200; i++) model.trainExample(features, 0.75, 0.01);
    const after = Math.abs(model.predict(features) - 0.75);
    assert.ok(after < before / 4, `expected error to fall: before=${before}, after=${after}`);
});

test('round utility matches penalty tiers and is zero-sum', () => {
    const utility = roundUtilities({
        winnerSeat: 0,
        cardsLeft: [0, 13, 10, 9]
    });
    assert.ok(Math.abs(utility.reduce((sum, value) => sum + value, 0)) < 1e-12);
    assert.strictEqual(utility[1], -39 / 117);
    assert.strictEqual(utility[2], -20 / 117);
    assert.strictEqual(utility[3], -9 / 117);
    assert.strictEqual(utility[0], 68 / 117);
});

test('TD(lambda) targets blend the next-state value with terminal utility', () => {
    const trajectories = [
        [
            { features: [1], maxPredictedValue: 0.1 },
            { features: [2], maxPredictedValue: 0.4 },
            { features: [3], maxPredictedValue: 0.6 }
        ],
        [],
        [],
        []
    ];
    const rows = rowsForRound(trajectories, [1, 0, 0, 0], 1, 0.5);
    assert.ok(Math.abs(rows[0].target - 0.6) < 1e-12);
    assert.ok(Math.abs(rows[1].target - 0.8) < 1e-12);
    assert.strictEqual(rows[2].target, 1);
});

test('value policy completes seeded rounds without an illegal action', () => {
    const model = new RLValueModel({ hiddenSize: 8, seed: 2 });
    const learned = new RLValueBot(model, { heuristicWeight: 0.2 });
    const seats = [0, 1, 2, 3].map(i => ({
        name: `value-${i}`, logic: learned
    }));
    for (let seed = 1; seed <= 20; seed++) {
        const result = playRound(seats, deal(makeRng(seed)));
        assert.ok(result.cardsLeft.some(count => count === 0), `seed ${seed}`);
    }
});

test('override margin can make the learned policy exactly preserve the baseline', () => {
    const model = new RLValueModel({ hiddenSize: 8, seed: 92 });
    const learned = new RLValueBot(model, {
        heuristicWeight: 0,
        overrideMargin: Infinity
    });
    const rng = makeRng(77);
    for (let i = 0; i < 30; i++) {
        const cards = deal(rng)[0];
        const ctx = context();
        const expected = BotLogic.getBotMove(cards, null, false, ctx, false);
        const actual = learned.getBotMove(cards, null, false, ctx);
        assert.deepStrictEqual(actual, expected);
    }
});

test('value policy reports heuristic overrides and margin-guard fallbacks', () => {
    const heuristicChoiceIndex = FEATURE_NAMES.indexOf('heuristic_choice');
    const decisions = [];
    const model = {
        predict(features) {
            return features[heuristicChoiceIndex] ? 0 : 0.5;
        }
    };
    const learned = new RLValueBot(model, {
        heuristicWeight: 0,
        overrideMargin: Infinity,
        onDecision: decision => decisions.push(decision)
    });
    learned.getBotMove(
        hand('3D 4C 5H 6S 7D 8C 9H 10S JD QH KS AH 2S'),
        null,
        false,
        context()
    );
    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].rawPreferredOverride, true);
    assert.strictEqual(decisions[0].guardFallback, true);
    assert.strictEqual(decisions[0].overrodeHeuristic, false);
    assert.strictEqual(decisions[0].key, decisions[0].heuristicKey);
    assert.ok(decisions[0].valueMargin > 0);
});

test('async harness has identical transitions for synchronous policies', async () => {
    const seats = [0, 1, 2, 3].map(i => ({
        name: `heuristic-${i}`, logic: BotLogic
    }));
    for (let seed = 30; seed <= 35; seed++) {
        const hands = deal(makeRng(seed));
        const sync = playRound(seats, hands);
        const asyncResult = await playRoundAsync(seats, hands);
        assert.deepStrictEqual(asyncResult, sync, `seed ${seed}`);
    }
});

test('dragon deals resolve before asking a policy for a move', () => {
    const dragon = RANKS.map((rank, i) => ({
        rank, suit: SUITS[i % SUITS.length],
        value: i * 4 + (i % SUITS.length)
    }));
    let calls = 0;
    const logic = { getBotMove: () => { calls++; return null; } };
    const result = playRound(
        [0, 1, 2, 3].map(i => ({ name: `seat-${i}`, logic })),
        [dragon, [], [], []]
    );
    assert.strictEqual(result.dragon, true);
    assert.strictEqual(result.winnerSeat, 0);
    assert.strictEqual(calls, 0);
});

test('training CLI writes a loadable checkpoint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-value-test-'));
    const output = path.join(dir, 'model.json');
    const originalLog = console.log;
    console.log = () => {};
    try {
        assert.strictEqual(trainMain([
            'node', 'train',
            '--rounds', '3',
            '--hidden', '6',
            '--output', output,
            '--report-every', '3'
        ]), 0);
    } finally {
        console.log = originalLog;
    }
    const model = RLValueModel.load(output);
    assert.strictEqual(model.hiddenSize, 6);
});

test('experience generator writes a shape-pinned float32 replay buffer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-experience-test-'));
    const checkpoint = path.join(dir, 'policy.json');
    const output = path.join(dir, 'rows.rl-experience.bin');
    saveCheckpoint(
        new RLValueModel({ hiddenSize: 6, seed: 41 }),
        checkpoint,
        { fixture: true }
    );
    const originalLog = console.log;
    console.log = () => {};
    try {
        assert.strictEqual(experienceMain([
            'node', 'experience',
            '--rounds', '3',
            '--model', checkpoint,
            '--output', output,
            '--report-every', '3'
        ]), 0);
    } finally {
        console.log = originalLog;
    }
    const metadata = JSON.parse(fs.readFileSync(`${output}.json`, 'utf8'));
    assert.ok(metadata.rows > 0);
    assert.deepStrictEqual(metadata.featureNames, FEATURE_NAMES);
    assert.strictEqual(
        fs.statSync(output).size,
        metadata.rows * (FEATURE_NAMES.length + 1) * 4
    );
});

test('human export reconstructs zero-sum utility from all four seat labels', () => {
    const records = [0, 1, 2, 3].map(seat => ({
        game: 'g1',
        round: 2,
        seat,
        labels: {
            round_points: [0, 5, 20, 9][seat],
            won_round: seat === 0
        }
    }));
    const utility = utilitiesByRound(records).get('g1:2');
    assert.strictEqual(utility.get(0), 34 / 117);
    assert.strictEqual(utility.get(1), -5 / 117);
    assert.strictEqual(utility.get(2), -20 / 117);
    assert.strictEqual(utility.get(3), -9 / 117);
});

test('human export preserves legal plays outside the bot action abstraction', () => {
    // BotLogic keeps only low/high suit representatives for a straight. This
    // mixed-suit allocation is server-legal and was observed in the real
    // corpus, so conversion must encode it instead of silently dropping it.
    const record = {
        game: 'human-fixture',
        round: 3,
        ply: 0,
        action: { type: 'play', cards: [0, 6, 10, 13, 16] },
        obs: {
            hand: [0, 6, 9, 10, 11, 13, 16, 17, 23, 26, 36, 40, 49],
            pile: null,
            pile_owner_rel: null,
            counts_rel: [13, 13, 13],
            passed_rel: [],
            pass_count: 0,
            played: [],
            history: []
        }
    };
    const features = reconstructDecision(record);
    assert.strictEqual(features.length, FEATURE_NAMES.length);
    assert.ok(features.every(Number.isFinite));
});

test('generation runner parses the learned seat from benchmark output', () => {
    const result = parseBenchmark(`
RL value benchmark [12000 rounds, 26.3s]
   name          win rate   avg points   avg cards left
   value-1         26.3%       2.93           2.58
   heuristic-1     24.7%       3.10           2.72
`);
    assert.deepStrictEqual(result, {
        winRatePercent: 26.3,
        averagePoints: 2.93,
        averageCardsLeft: 2.58
    });
});

test('parallel collection derives stable distinct worker seeds', () => {
    assert.strictEqual(seedForWorker(123, 0), 123);
    assert.strictEqual(seedForWorker(123, 1), seedForWorker(123, 1));
    assert.notStrictEqual(seedForWorker(123, 1), seedForWorker(123, 2));
});

test('paired diagnostics isolate outcomes on policy-disagreement rounds', () => {
    const report = (actions, outcomes, telemetry = {}) => ({
        seed: 7,
        rounds: actions.length,
        telemetry,
        traces: actions.map((roundActions, round) => ({
            round,
            actions: roundActions,
            outcome: outcomes[round]
        }))
    });
    const parent = report(
        [['3D', '4D'], ['pass'], []],
        [
            { utility: -0.1, points: 5, cardsLeft: 5 },
            { utility: 0.2, points: 0, cardsLeft: 0 },
            { utility: 0.1, points: 0, cardsLeft: 0 }
        ],
        { overrideRate: 0.1 }
    );
    const candidate = report(
        [['3D', '5D'], ['pass'], []],
        [
            { utility: 0.2, points: 0, cardsLeft: 0 },
            { utility: 0.2, points: 0, cardsLeft: 0 },
            { utility: 0.1, points: 0, cardsLeft: 0 }
        ],
        { overrideRate: 0.2 }
    );
    const result = compareBenchmarkReports(parent, candidate);
    assert.strictEqual(result.roundsWithDecisions, 2);
    assert.strictEqual(result.roundsWithDisagreement, 1);
    assert.strictEqual(result.firstActionDisagreements, 1);
    assert.strictEqual(result.sharedDecisionPositions, 3);
    assert.strictEqual(result.disagreementRounds.rounds, 1);
    assert.ok(Math.abs(result.disagreementRounds.meanUtilityDelta - 0.3) < 1e-12);
    assert.strictEqual(result.disagreementRounds.meanPointsDelta, -5);
    assert.strictEqual(result.candidateTelemetry.overrideRate, 0.2);
});

test('conservative interpolation preserves schema and scales the trained update', () => {
    const artifact = value => ({
        kind: 'chor-dai-dee-candidate-value',
        hiddenSize: 1,
        featureNames: ['bias'],
        parameters: {
            w1: [[value]],
            b1: [value],
            w2: [value],
            b2: value
        },
        metadata: { trainedAt: `time-${value}` }
    });
    const interpolated = interpolateValueArtifacts(
        artifact(2), artifact(6), 0.25);
    assert.deepStrictEqual(interpolated.parameters, {
        w1: [[3]],
        b1: [3],
        w2: [3],
        b2: 3
    });
    assert.strictEqual(interpolated.metadata.conservativeAlpha, 0.25);
});

test('candidate selection prioritizes paired utility over headline win rate', () => {
    const candidate = (alpha, utility, points, wins) => ({
        alpha,
        result: {
            averagePoints: points,
            winRatePercent: wins
        },
        diagnostics: {
            allPairedRounds: { meanUtilityDelta: utility }
        }
    });
    const selected = selectConservativeCandidate([
        candidate(0.25, 0.002, 2.9, 26.0),
        candidate(0.5, -0.001, 2.8, 27.0),
        candidate(1, 0.001, 2.7, 28.0)
    ]);
    assert.strictEqual(selected.alpha, 0.25);
});

test('promotion requires a convincing paired improvement on the final holdout', () => {
    const parent = { winRatePercent: 26, averagePoints: 3 };
    const candidate = { winRatePercent: 26.1, averagePoints: 2.9 };
    const diagnostics = {
        allPairedRounds: { meanUtilityDelta: 0.001 },
        disagreementRounds: {
            candidateBetter: 80,
            parentBetter: 20
        }
    };
    assert.strictEqual(
        promotionDecision(parent, candidate, diagnostics).accepted, true);
    diagnostics.disagreementRounds = {
        candidateBetter: 52,
        parentBetter: 48
    };
    assert.strictEqual(
        promotionDecision(parent, candidate, diagnostics).accepted, false);
});
