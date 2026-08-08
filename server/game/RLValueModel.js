// A small dependency-free value network used by the experimental RL bot.
//
// The model scores (public observation, legal candidate action) pairs.  Legal
// actions are still enumerated by Big2Rules/BotLogic, so a checkpoint can never
// invent a hand that the live server considers illegal.  Keeping the network
// here, rather than in the legacy Python environment, also means training and
// inference share the exact feature implementation.

const { FEATURE_NAMES } = require('./BotFeatures');

const MODEL_SCHEMA_VERSION = 1;
const DEFAULT_HIDDEN_SIZE = 32;

// Stable order: artifacts store this list and are rejected if it drifts.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function zeros(rows, cols = null) {
    if (cols === null) return Array(rows).fill(0);
    return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function assertFiniteArray(values, label, expectedLength) {
    if (!Array.isArray(values) || values.length !== expectedLength ||
        values.some(value => !Number.isFinite(value))) {
        throw new Error(`${label} must contain ${expectedLength} finite numbers`);
    }
}

class RLValueModel {
    constructor({ hiddenSize = DEFAULT_HIDDEN_SIZE, seed = 228, parameters = null } = {}) {
        this.inputSize = FEATURE_NAMES.length;
        this.hiddenSize = hiddenSize;

        if (parameters) {
            this.w1 = parameters.w1.map(row => [...row]);
            this.b1 = [...parameters.b1];
            this.w2 = [...parameters.w2];
            this.b2 = parameters.b2;
            this.assertShape();
            return;
        }

        const rng = mulberry32(seed);
        const scale = Math.sqrt(2 / this.inputSize);
        this.w1 = Array.from({ length: hiddenSize }, () =>
            Array.from({ length: this.inputSize }, () => (rng() * 2 - 1) * scale));
        this.b1 = zeros(hiddenSize);
        this.w2 = Array.from({ length: hiddenSize }, () =>
            (rng() * 2 - 1) * Math.sqrt(2 / hiddenSize));
        this.b2 = 0;
    }

    assertShape() {
        if (!Array.isArray(this.w1) || this.w1.length !== this.hiddenSize) {
            throw new Error(`w1 must contain ${this.hiddenSize} rows`);
        }
        for (let i = 0; i < this.hiddenSize; i++) {
            assertFiniteArray(this.w1[i], `w1[${i}]`, this.inputSize);
        }
        assertFiniteArray(this.b1, 'b1', this.hiddenSize);
        assertFiniteArray(this.w2, 'w2', this.hiddenSize);
        if (!Number.isFinite(this.b2)) throw new Error('b2 must be finite');
    }

    forward(features) {
        assertFiniteArray(features, 'features', this.inputSize);
        const hidden = Array(this.hiddenSize);
        for (let h = 0; h < this.hiddenSize; h++) {
            let sum = this.b1[h];
            const row = this.w1[h];
            for (let i = 0; i < this.inputSize; i++) sum += row[i] * features[i];
            hidden[h] = Math.tanh(sum);
        }
        let raw = this.b2;
        for (let h = 0; h < this.hiddenSize; h++) raw += this.w2[h] * hidden[h];
        // Utilities are normalized to [-1, 1].
        return { value: Math.tanh(raw), hidden, raw };
    }

    predict(features) {
        return this.forward(features).value;
    }

    /**
     * One bounded SGD update. Returns squared error before the update.
     *
     * Full-round Monte Carlo returns supervise every chosen action, which is
     * the delayed credit-assignment idea used by the Somerset paper without
     * requiring a tabular state space. Gradient clipping keeps a rare 39-point
     * loss from destabilizing a small checkpoint.
     */
    trainExample(features, target, learningRate) {
        const boundedTarget = Math.max(-1, Math.min(1, target));
        const { value, hidden } = this.forward(features);
        const error = value - boundedTarget;
        const dRaw = Math.max(-1, Math.min(1, 2 * error * (1 - value * value)));
        const oldW2 = [...this.w2];

        for (let h = 0; h < this.hiddenSize; h++) {
            this.w2[h] -= learningRate * dRaw * hidden[h];
        }
        this.b2 -= learningRate * dRaw;

        for (let h = 0; h < this.hiddenSize; h++) {
            const dHidden = Math.max(-1, Math.min(1,
                dRaw * oldW2[h] * (1 - hidden[h] * hidden[h])));
            for (let i = 0; i < this.inputSize; i++) {
                this.w1[h][i] -= learningRate * dHidden * features[i];
            }
            this.b1[h] -= learningRate * dHidden;
        }
        return error * error;
    }

    toArtifact(metadata = {}) {
        return {
            schemaVersion: MODEL_SCHEMA_VERSION,
            kind: 'chor-dai-dee-candidate-value',
            featureNames: FEATURE_NAMES,
            hiddenSize: this.hiddenSize,
            parameters: {
                w1: this.w1,
                b1: this.b1,
                w2: this.w2,
                b2: this.b2
            },
            metadata
        };
    }

    static fromArtifact(artifact) {
        if (!artifact || artifact.schemaVersion !== MODEL_SCHEMA_VERSION ||
            artifact.kind !== 'chor-dai-dee-candidate-value') {
            throw new Error('Unsupported RL value model artifact');
        }
        if (JSON.stringify(artifact.featureNames) !== JSON.stringify(FEATURE_NAMES)) {
            throw new Error('RL value model feature schema does not match this server');
        }
        return new RLValueModel({
            hiddenSize: artifact.hiddenSize,
            parameters: artifact.parameters
        });
    }

}

module.exports = {
    RLValueModel,
    FEATURE_NAMES,
    MODEL_SCHEMA_VERSION,
    DEFAULT_HIDDEN_SIZE
};
