// Runtime selection between the established heuristic and the promoted PPO
// policy. Both paths execute entirely in JavaScript; Python is training-only.

const path = require('path');

const { BotLogic, BOT_LOGIC_VERSION } = require('./BotLogic');
const { PPOModel } = require('./PPOModel');
const { PPOBot } = require('./PPOBot');
const { decisionOptions } = require('./RLValueBot');
const {
    MIN_TEMPERATURE,
    MAX_TEMPERATURE,
    COLD_START_TEMPERATURE
} = require('./AdaptiveBotController');

const PPO_POLICY_GENERATION = 14;
const DEFAULT_PPO_MODEL_PATH = path.resolve(
    __dirname, '../ai/ppo-policy-gpu-v1.json');

// How hard the bots try. One dial - the softmax temperature the promoted PPO
// actor is sampled at - because it is the only knob that is unbounded, monotone
// and measurable. Adaptive supplies a bounded continuous value selected before
// a complete game; the fixed tiers remain as benchmark and history anchors.
// See docs/BOT-DIFFICULTY.md for the measured table.
//
// `competitive` is argmax and must stay byte-identical to the pre-difficulty
// behaviour. It remains the low-level factory default for internal callers and
// fixed-policy benchmarks; new player rooms explicitly choose Adaptive.
//
// Note `sample: true` also disables PPOBot's heuristic-override guard, because
// PPOBot.js gates it on `!sample`. That is deliberate, not an oversight. The
// guard pulls near-tie deviations back to the heuristic move, which is exactly
// the class of deviation that produces the weakening - re-applying it after
// sampling would partly undo each tier and make the ladder non-monotone at low
// temperature. Measured, the guard is worth ~0.1pp of win rate, so nothing of
// value is lost. Do not "fix" the coupling without re-running the bench.
const BOT_DIFFICULTIES = {
    adaptive: {
        id: 'adaptive',
        label: 'Adaptive',
        sample: true,
        temperature: COLD_START_TEMPERATURE,
        variabilityMultiplier: COLD_START_TEMPERATURE + 1
    },
    competitive: {
        id: 'competitive',
        label: 'Competitive',
        sample: false,
        temperature: 1,
        variabilityMultiplier: 1
    },
    balanced: {
        id: 'balanced',
        label: 'Balanced',
        sample: true,
        temperature: 4.5,
        variabilityMultiplier: 4
    },
    casual: {
        id: 'casual',
        label: 'Casual',
        sample: true,
        temperature: 8,
        variabilityMultiplier: 9
    }
};

const DEFAULT_BOT_DIFFICULTY = 'competitive';

// The strongest tier available to a room. `competitive` is argmax — it never
// samples, so it cannot play below its own best judgement, which is what makes
// it the ceiling rather than merely the lowest temperature. Named so the
// waiting room's max-difficulty toggle does not hardcode a tier id that a
// future retune might move.
const MAX_BOT_DIFFICULTY = 'competitive';

function resolveDifficulty(difficulty) {
    const id = difficulty === undefined || difficulty === null
        ? DEFAULT_BOT_DIFFICULTY
        : difficulty;
    const tier = BOT_DIFFICULTIES[id];
    if (!tier) {
        throw new Error('bot difficulty must be one of ' +
            Object.keys(BOT_DIFFICULTIES).join(', '));
    }
    return tier;
}

function resolveStrength(difficulty, temperature) {
    const tier = resolveDifficulty(difficulty);
    if (tier.id !== 'adaptive' || temperature === undefined ||
        temperature === null) {
        return tier;
    }

    const value = Number(temperature);
    if (!Number.isFinite(value) ||
        value < MIN_TEMPERATURE || value > MAX_TEMPERATURE) {
        throw new Error(
            `adaptive bot temperature must be between ` +
            `${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}`);
    }
    return {
        ...tier,
        temperature: value,
        variabilityMultiplier: value + 1
    };
}

let cachedPPO = null;

function heuristicPolicy({ difficulty, temperature } = {}) {
    const tier = resolveStrength(difficulty, temperature);
    return {
        kind: 'heuristic',
        occupant: 'bot_heuristic',
        difficulty: tier.id,
        sample: tier.sample,
        temperature: tier.temperature,
        policyGen: BOT_LOGIC_VERSION,
        policyRef: null,
        // The configuration-only rollback path (BOT_POLICY=heuristic in
        // fly.toml) must not turn the difficulty setting into a silent no-op,
        // so the tiers map onto the heuristic's own variability window. It is
        // an approximation: forcing variability up tops out around a 40% win
        // rate for the reference seat where temperature reaches 55%, so the
        // easy end is out of reach. Synthesized here rather than in BotLogic so
        // BotLogic.js and BotContext.js stay untouched - versionPins.test.js
        // and `npm run bench` both depend on that.
        profileFor(name) {
            const profile = BotLogic.getBotProfile(name);
            if (tier.variabilityMultiplier === 1) return profile;
            return {
                ...profile,
                variability: profile.variability * tier.variabilityMultiplier
            };
        },
        getMove(hand, lastPlayedHand, isFirstTurn, gameContext, {
            captureReasoning = false
        } = {}) {
            return BotLogic.getBotMove(
                hand,
                lastPlayedHand,
                isFirstTurn,
                gameContext,
                captureReasoning
            );
        }
    };
}

function loadPPO(modelPath) {
    const resolved = path.resolve(modelPath);
    if (!cachedPPO || cachedPPO.path !== resolved) {
        cachedPPO = {
            path: resolved,
            model: PPOModel.load(resolved)
        };
    }
    return cachedPPO.model;
}

function ppoPolicy({
    modelPath = DEFAULT_PPO_MODEL_PATH,
    overrideMargin = 0.02,
    difficulty,
    temperature
} = {}) {
    const tier = resolveStrength(difficulty, temperature);
    const model = loadPPO(modelPath);
    return {
        kind: 'ppo',
        occupant: 'bot_ppo',
        difficulty: tier.id,
        sample: tier.sample,
        temperature: tier.temperature,
        policyGen: PPO_POLICY_GENERATION,
        // The artifact, and only the artifact. The difficulty tier is recorded
        // separately (mlog_seat.difficulty) - encoding it here would break
        // grouping by checkpoint in every query that compares generations.
        policyRef: path.basename(modelPath),
        // PPO reads the observation directly; the heuristic profile is not part
        // of its input. Present so callers never have to branch on policy kind.
        profileFor: () => null,
        advise(hand, lastPlayedHand, isFirstTurn, gameContext) {
            const options = decisionOptions({
                hand, lastPlayedHand, isFirstTurn, gameContext
            });
            if (!options.length) {
                return {
                    forced: true,
                    action: 'pass',
                    cards: null,
                    key: 'pass',
                    policyMargin: Infinity,
                    probability: 1,
                    policyGeneration: PPO_POLICY_GENERATION,
                    policyRef: path.basename(modelPath)
                };
            }
            const evaluation = model.evaluate(
                options.map(option => option.features));
            const ranked = evaluation.logits
                .map((logit, index) => ({ logit, index }))
                .sort((left, right) => right.logit - left.logit);
            const rawIndex = ranked[0].index;
            const heuristicIndex = options.findIndex(
                option => option.isHeuristicChoice);
            let chosenIndex = rawIndex;
            let guardFallback = false;
            if (heuristicIndex !== -1 && rawIndex !== heuristicIndex &&
                evaluation.logits[rawIndex] <
                    evaluation.logits[heuristicIndex] + overrideMargin) {
                chosenIndex = heuristicIndex;
                guardFallback = true;
            }
            const chosen = options[chosenIndex];
            return {
                forced: false,
                action: chosen.action,
                cards: chosen.move ? chosen.move.cards : null,
                key: chosen.key,
                chosenIndex,
                rawIndex,
                heuristicIndex,
                heuristicKey: heuristicIndex === -1
                    ? null
                    : options[heuristicIndex].key,
                policyMargin: ranked.length > 1
                    ? ranked[0].logit - ranked[1].logit
                    : Infinity,
                probability: evaluation.probabilities[chosenIndex],
                guardFallback,
                policyGeneration: PPO_POLICY_GENERATION,
                policyRef: path.basename(modelPath)
            };
        },
        getMove(hand, lastPlayedHand, isFirstTurn, gameContext, {
            captureReasoning = false
        } = {}) {
            let decision = null;
            const bot = new PPOBot(model, {
                sample: tier.sample,
                temperature: tier.temperature,
                overrideMargin,
                onDecision: value => {
                    decision = value;
                }
            });
            const cards = bot.getBotMove(
                hand, lastPlayedHand, isFirstTurn, gameContext);
            if (!captureReasoning) return cards;
            return {
                cards,
                reasoning: {
                    strategy: 'ppo-policy',
                    difficulty: tier.id,
                    sampled: tier.sample,
                    temperature: tier.temperature,
                    policyGeneration: PPO_POLICY_GENERATION,
                    policyRef: path.basename(modelPath),
                    decision: decision ? {
                        action: decision.action,
                        key: decision.key,
                        heuristicKey: decision.heuristicKey,
                        overrodeHeuristic: decision.overrodeHeuristic,
                        policyMargin: decision.valueMargin,
                        guardFallback: decision.guardFallback,
                        reason: tier.sample
                            ? `Sampled from the learned policy at temperature ${tier.temperature} (${tier.id}).`
                            : decision.overrodeHeuristic
                                ? 'The learned policy preferred this legal alternative.'
                                : 'The learned policy agreed with the heuristic move.'
                    } : null
                }
            };
        }
    };
}

function createBotPolicy({
    mode = process.env.BOT_POLICY || 'heuristic',
    modelPath = process.env.BOT_PPO_MODEL_PATH || DEFAULT_PPO_MODEL_PATH,
    overrideMargin = process.env.BOT_PPO_OVERRIDE_MARGIN === undefined
        ? 0.02
        : Number(process.env.BOT_PPO_OVERRIDE_MARGIN),
    difficulty = process.env.BOT_DIFFICULTY || DEFAULT_BOT_DIFFICULTY,
    temperature
} = {}) {
    if (mode === 'heuristic') {
        return heuristicPolicy({ difficulty, temperature });
    }
    if (mode === 'ppo') {
        if (!Number.isFinite(overrideMargin) || overrideMargin < 0) {
            throw new Error('BOT_PPO_OVERRIDE_MARGIN must be non-negative');
        }
        return ppoPolicy({
            modelPath, overrideMargin, difficulty, temperature
        });
    }
    throw new Error('BOT_POLICY must be heuristic or ppo');
}

function createCoachAdvisor({
    mode = process.env.COACH_POLICY || 'move_quality',
    modelPath = process.env.COACH_PPO_MODEL_PATH ||
        process.env.BOT_PPO_MODEL_PATH ||
        DEFAULT_PPO_MODEL_PATH,
    overrideMargin = process.env.COACH_PPO_OVERRIDE_MARGIN === undefined
        ? 0.02
        : Number(process.env.COACH_PPO_OVERRIDE_MARGIN),
    minMargin = process.env.COACH_PPO_MIN_MARGIN === undefined
        ? 2
        : Number(process.env.COACH_PPO_MIN_MARGIN)
} = {}) {
    if (mode === 'move_quality') return null;
    if (mode !== 'ppo') {
        throw new Error('COACH_POLICY must be move_quality or ppo');
    }
    if (!Number.isFinite(minMargin) || minMargin < 0) {
        throw new Error('COACH_PPO_MIN_MARGIN must be non-negative');
    }
    if (!Number.isFinite(overrideMargin) || overrideMargin < 0) {
        throw new Error(
            'COACH_PPO_OVERRIDE_MARGIN must be non-negative');
    }
    // Always full strength. The coach is a teaching aid, not an opponent: its
    // hints must not get worse because the table was set to an easier tier.
    const advisor = ppoPolicy({
        modelPath,
        overrideMargin,
        difficulty: DEFAULT_BOT_DIFFICULTY
    });
    return {
        ...advisor,
        minMargin
    };
}

module.exports = {
    createBotPolicy,
    createCoachAdvisor,
    BOT_DIFFICULTIES,
    DEFAULT_BOT_DIFFICULTY,
    MAX_BOT_DIFFICULTY,
    DEFAULT_PPO_MODEL_PATH,
    PPO_POLICY_GENERATION
};
