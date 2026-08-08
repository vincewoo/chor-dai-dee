// Dependency-free actor/critic inference for the variable-action PPO bot.
//
// Training happens in PyTorch, but the exported matrices deliberately use the
// same small tanh networks here so production needs no Python runtime.

const { FEATURE_NAMES } = require('./BotFeatures');

const PPO_SCHEMA_VERSION = 1;
const STATE_FEATURE_NAMES = [
    'bias',
    'own_cards',
    'next_cards',
    'across_cards',
    'previous_cards',
    'min_opponent_cards',
    'played_fraction',
    'pass_count',
    'has_control',
    'first_turn',
    'pile_by_next',
    'pile_by_across',
    'pile_by_previous',
    'opponent_at_one',
    'opponent_at_two'
];
const STATE_FEATURE_INDICES = STATE_FEATURE_NAMES.map(name =>
    FEATURE_NAMES.indexOf(name));

function finiteVector(value, length, label) {
    if (!Array.isArray(value) || value.length !== length ||
        value.some(item => !Number.isFinite(item))) {
        throw new Error(`${label} must contain ${length} finite numbers`);
    }
}

function validateNetwork(parameters, prefix, inputSize, hiddenSize) {
    const w1 = parameters[`${prefix}W1`];
    if (!Array.isArray(w1) || w1.length !== hiddenSize) {
        throw new Error(`${prefix}W1 must contain ${hiddenSize} rows`);
    }
    w1.forEach((row, index) =>
        finiteVector(row, inputSize, `${prefix}W1[${index}]`));
    finiteVector(parameters[`${prefix}B1`], hiddenSize, `${prefix}B1`);
    finiteVector(parameters[`${prefix}W2`], hiddenSize, `${prefix}W2`);
    if (!Number.isFinite(parameters[`${prefix}B2`])) {
        throw new Error(`${prefix}B2 must be finite`);
    }
}

function forward(features, w1, b1, w2, b2, squash) {
    const hidden = w1.map((row, h) => {
        let total = b1[h];
        for (let i = 0; i < row.length; i++) total += row[i] * features[i];
        return Math.tanh(total);
    });
    let output = b2;
    for (let h = 0; h < hidden.length; h++) output += w2[h] * hidden[h];
    return squash ? Math.tanh(output) : output;
}

function stableSoftmax(logits, temperature = 1) {
    const scale = Math.max(1e-6, temperature);
    const maximum = Math.max(...logits);
    const weights = logits.map(logit => Math.exp((logit - maximum) / scale));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => weight / total);
}

class PPOModel {
    constructor(artifact) {
        if (!artifact || artifact.schemaVersion !== PPO_SCHEMA_VERSION ||
            artifact.kind !== 'chor-dai-dee-ppo-policy') {
            throw new Error('Unsupported PPO policy artifact');
        }
        if (JSON.stringify(artifact.featureNames) !== JSON.stringify(FEATURE_NAMES) ||
            JSON.stringify(artifact.stateFeatureNames) !==
                JSON.stringify(STATE_FEATURE_NAMES)) {
            throw new Error('PPO policy feature schema does not match this server');
        }
        this.actorHiddenSize = artifact.actorHiddenSize;
        this.criticHiddenSize = artifact.criticHiddenSize;
        this.parameters = artifact.parameters;
        validateNetwork(
            this.parameters, 'actor', FEATURE_NAMES.length, this.actorHiddenSize);
        validateNetwork(
            this.parameters, 'critic',
            STATE_FEATURE_NAMES.length, this.criticHiddenSize);
        this.artifact = artifact;
    }

    policyLogit(features) {
        finiteVector(features, FEATURE_NAMES.length, 'candidate features');
        const p = this.parameters;
        return forward(
            features, p.actorW1, p.actorB1, p.actorW2, p.actorB2, false);
    }

    stateValue(candidateFeatures) {
        finiteVector(candidateFeatures, FEATURE_NAMES.length, 'candidate features');
        const state = STATE_FEATURE_INDICES.map(index => candidateFeatures[index]);
        const p = this.parameters;
        return forward(
            state, p.criticW1, p.criticB1, p.criticW2, p.criticB2, true);
    }

    evaluate(featureRows, temperature = 1) {
        const logits = featureRows.map(features => this.policyLogit(features));
        return {
            logits,
            probabilities: stableSoftmax(logits, temperature),
            value: this.stateValue(featureRows[0])
        };
    }

    static heuristicBootstrap({ actorHiddenSize = 64, criticHiddenSize = 64 } = {}) {
        const zeros = length => Array(length).fill(0);
        let randomState = 0xC0FFEE;
        const random = () => {
            randomState = (randomState + 0x6D2B79F5) >>> 0;
            let value = randomState;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
        const randomVector = (length, scale = 0.02) =>
            Array.from({ length }, () => (random() * 2 - 1) * scale);
        const matrix = (rows, columns, scale = 0.02) =>
            Array.from({ length: rows }, () =>
                randomVector(columns, scale));
        const actorW1 = matrix(actorHiddenSize, FEATURE_NAMES.length);
        const actorW2 = randomVector(actorHiddenSize);
        const heuristicIndex = FEATURE_NAMES.indexOf('heuristic_choice');
        actorW1[0][heuristicIndex] += 1;
        // Deterministic inference still picks the heuristic, while stochastic
        // collection retains enough entropy to discover alternatives. Small
        // nonzero initialization keeps every hidden unit trainable.
        actorW2[0] += 0.5;
        return {
            schemaVersion: PPO_SCHEMA_VERSION,
            kind: 'chor-dai-dee-ppo-policy',
            featureNames: FEATURE_NAMES,
            stateFeatureNames: STATE_FEATURE_NAMES,
            actorHiddenSize,
            criticHiddenSize,
            parameters: {
                actorW1,
                actorB1: zeros(actorHiddenSize),
                actorW2,
                actorB2: 0,
                criticW1: matrix(
                    criticHiddenSize, STATE_FEATURE_NAMES.length),
                criticB1: zeros(criticHiddenSize),
                criticW2: randomVector(criticHiddenSize),
                criticB2: 0
            },
            metadata: {
                initializedFrom: 'heuristic-choice-feature',
                bootstrapActorWeight: 0.5,
                createdAt: new Date().toISOString()
            }
        };
    }
}

module.exports = {
    PPOModel,
    PPO_SCHEMA_VERSION,
    STATE_FEATURE_NAMES,
    STATE_FEATURE_INDICES,
    stableSoftmax
};
