const test = require('node:test');
const assert = require('node:assert');

const { RANKS, SUITS } = require('../game/Deck');
const { BotLogic } = require('../game/BotLogic');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const { PPOModel, stableSoftmax } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const { decisionOptions } = require('../game/RLValueBot');
const { makeRng, deal, playRound } = require('./botHarness');
const {
    finishTrajectory,
    encodeActions,
    encodeDecisions,
    DECISION_BYTES
} = require('../scripts/generate-ppo-experience');
const { selectPPOCandidate } = require('../scripts/run-ppo-generation');
const {
    encodeTeacherDecisions
} = require('../scripts/generate-ppo-imitation-experience');
const {
    isEligible: isHumanPPOEligible,
    splitGames,
    encodeDecision: encodeHumanDecision,
    FLAG_HUMAN_OVERRIDE,
    FLAG_VALIDATION
} = require('../scripts/convert-human-ppo-export');

function card(text) {
    const suit = text.slice(-1);
    const rank = text.slice(0, -1);
    return {
        rank,
        suit,
        value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit)
    };
}

function hand(text) {
    return text.split(/\s+/).map(card);
}

function context() {
    return {
        playerCardCounts: [13, 13, 13],
        lastPlayedByRelative: null,
        passedPlayers: [],
        passCount: 0,
        playedCards: [],
        playHistory: []
    };
}

test('stable softmax produces finite normalized probabilities', () => {
    const probabilities = stableSoftmax([1000, 999, -1000]);
    assert.ok(probabilities.every(Number.isFinite));
    assert.ok(Math.abs(
        probabilities.reduce((sum, value) => sum + value, 0) - 1
    ) < 1e-12);
    assert.ok(probabilities[0] > probabilities[1]);
});

test('heuristic PPO bootstrap selects the canonical heuristic move', () => {
    const cards = hand('3D 4C 5H 6S 7D 8C 9H 10S JD QH KS AH 2S');
    const ctx = context();
    const artifact = PPOModel.heuristicBootstrap({
        actorHiddenSize: 8,
        criticHiddenSize: 6
    });
    const model = new PPOModel(JSON.parse(JSON.stringify(artifact)));
    const options = decisionOptions({
        hand: cards,
        lastPlayedHand: null,
        isFirstTurn: false,
        gameContext: ctx
    });
    const evaluation = model.evaluate(
        options.map(option => option.features));
    const selected = evaluation.logits.indexOf(Math.max(...evaluation.logits));
    assert.strictEqual(options[selected].isHeuristicChoice, true);

    const bot = new PPOBot(model);
    assert.deepStrictEqual(
        bot.getBotMove(cards, null, false, ctx),
        BotLogic.getBotMove(cards, null, false, ctx, false)
    );
    const rng = makeRng(811);
    for (let round = 0; round < 30; round++) {
        const randomHand = deal(rng)[0];
        assert.deepStrictEqual(
            bot.getBotMove(randomHand, null, false, ctx),
            BotLogic.getBotMove(randomHand, null, false, ctx, false)
        );
    }
});

test('PPO policy completes seeded games with canonical legal moves', () => {
    const model = new PPOModel(PPOModel.heuristicBootstrap({
        actorHiddenSize: 8,
        criticHiddenSize: 6
    }));
    const bot = new PPOBot(model);
    const seats = [0, 1, 2, 3].map(seat => ({
        name: `ppo-${seat}`,
        logic: bot
    }));
    for (let seed = 1; seed <= 10; seed++) {
        const result = playRound(seats, deal(makeRng(seed)));
        assert.ok(result.cardsLeft.some(count => count === 0));
    }
});

test('GAE trajectories and ragged binary records retain decision grouping', () => {
    const features = value => Array(FEATURE_NAMES.length).fill(value);
    const trajectory = [
        {
            predictedValue: 0.1,
            oldLogProbability: -0.5,
            chosenIndex: 1,
            heuristicIndex: 0,
            actionFeatures: [features(1), features(2)]
        },
        {
            predictedValue: 0.2,
            oldLogProbability: -0.2,
            chosenIndex: 0,
            heuristicIndex: 0,
            actionFeatures: [features(3)]
        }
    ];
    finishTrajectory(trajectory, 1, 1, 1);
    assert.ok(Math.abs(trajectory[0].return - 1) < 1e-12);
    assert.ok(Math.abs(trajectory[1].return - 1) < 1e-12);
    const actions = encodeActions(trajectory);
    assert.strictEqual(actions.actionCount, 3);
    assert.strictEqual(
        actions.buffer.length, 3 * FEATURE_NAMES.length * 4);
    const decisions = encodeDecisions(trajectory);
    assert.strictEqual(decisions.length, 2 * DECISION_BYTES);
    assert.strictEqual(decisions.readUInt16LE(0), 2);
    assert.strictEqual(decisions.readUInt16LE(2), 1);
    assert.strictEqual(decisions.readUInt16LE(DECISION_BYTES), 1);
});

test('PPO selection retains the full update when behavior is tied', () => {
    const candidate = alpha => ({
        alpha,
        result: {
            averagePoints: 3,
            winRatePercent: 25
        },
        diagnostics: {
            allPairedRounds: {
                meanUtilityDelta: 0
            }
        }
    });
    assert.strictEqual(
        selectPPOCandidate([candidate(0.25), candidate(0.5), candidate(1)])
            .alpha,
        1
    );
});

test('imitation records preserve teacher overrides', () => {
    const buffer = encodeTeacherDecisions([{
        actionFeatures: [
            Array(FEATURE_NAMES.length).fill(0),
            Array(FEATURE_NAMES.length).fill(1)
        ],
        chosenIndex: 1,
        heuristicIndex: 0
    }]);
    assert.strictEqual(buffer.length, DECISION_BYTES);
    assert.strictEqual(buffer.readUInt16LE(0), 2);
    assert.strictEqual(buffer.readUInt16LE(2), 1);
    assert.strictEqual(buffer.readUInt16LE(4), 0);
    assert.strictEqual(buffer.readUInt16LE(6), 1);
});

test('human PPO validation split keeps complete games together', () => {
    const games = Array.from({ length: 10 }, (_, index) => `game-${index}`);
    const first = splitGames(games, 0.2, 17);
    const second = splitGames([...games].reverse(), 0.2, 17);
    assert.strictEqual(first.validation.size, 2);
    assert.strictEqual(first.training.size, 8);
    assert.deepStrictEqual(
        [...first.validation].sort(),
        [...second.validation].sort()
    );
    assert.ok([...first.validation].every(game =>
        !first.training.has(game)));
});

test('human PPO records mark overrides and held-out decisions', () => {
    const buffer = encodeHumanDecision({
        actionFeatures: [
            Array(FEATURE_NAMES.length).fill(0),
            Array(FEATURE_NAMES.length).fill(1)
        ],
        chosenIndex: 1,
        heuristicIndex: 0
    }, true);
    assert.strictEqual(buffer.length, DECISION_BYTES);
    assert.strictEqual(buffer.readUInt16LE(0), 2);
    assert.strictEqual(buffer.readUInt16LE(2), 1);
    assert.strictEqual(buffer.readUInt16LE(4), 0);
    assert.strictEqual(
        buffer.readUInt16LE(6),
        FLAG_HUMAN_OVERRIDE | FLAG_VALIDATION
    );
});

test('human PPO eligibility requires a deliberate completed-round decision', () => {
    const record = {
        occupant: 'human',
        subject: 'h:test',
        joined_mid_game: false,
        forced_pass: false,
        policy_fallback: false,
        turn_disconnected: false,
        action: { type: 'play', cards: [0] },
        labels: { round_points: 3 }
    };
    assert.strictEqual(
        isHumanPPOEligible(record, new Set(['h:test'])),
        true
    );
    assert.strictEqual(
        isHumanPPOEligible({
            ...record,
            labels: { round_points: null }
        }, new Set(['h:test'])),
        false
    );
    assert.strictEqual(
        isHumanPPOEligible({
            ...record,
            turn_disconnected: true
        }, new Set(['h:test'])),
        false
    );
});

test('guest seats are excluded unless --include-guests asks for them', () => {
    const guest = {
        occupant: 'guest',
        subject: null,
        joined_mid_game: false,
        forced_pass: false,
        policy_fallback: false,
        turn_disconnected: false,
        action: { type: 'play', cards: [0] },
        labels: { round_points: 3 }
    };

    assert.strictEqual(isHumanPPOEligible(guest, new Set(['h:test'])), false);
    assert.strictEqual(
        isHumanPPOEligible(guest, new Set(['h:test']), true), true);
    // Guests are a pool, not a subject: an empty subject set still takes them.
    assert.strictEqual(isHumanPPOEligible(guest, new Set(), true), true);

    // Every other deliberateness filter still applies to a guest decision.
    assert.strictEqual(
        isHumanPPOEligible({ ...guest, forced_pass: true }, new Set(), true),
        false
    );
    assert.strictEqual(
        isHumanPPOEligible(
            { ...guest, labels: { round_points: null } }, new Set(), true),
        false
    );

    // An account seat whose user_id was missing at export time also has a null
    // subject. Including guests must not sweep it in.
    assert.strictEqual(
        isHumanPPOEligible(
            { ...guest, occupant: 'human' }, new Set(), true),
        false
    );
});
