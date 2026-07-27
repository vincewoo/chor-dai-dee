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
const { main: experienceMain } = require('../scripts/generate-rl-experience');

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
