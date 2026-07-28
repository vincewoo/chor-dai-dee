// Runtime selection between the established heuristic and the promoted PPO
// policy. Both paths execute entirely in JavaScript; Python is training-only.

const path = require('path');

const { BotLogic, BOT_LOGIC_VERSION } = require('./BotLogic');
const { PPOModel } = require('./PPOModel');
const { PPOBot } = require('./PPOBot');
const { decisionOptions } = require('./RLValueBot');

const PPO_POLICY_GENERATION = 14;
const DEFAULT_PPO_MODEL_PATH = path.resolve(
    __dirname, '../ai/ppo-policy-gpu-v1.json');

let cachedPPO = null;

function heuristicPolicy() {
    return {
        kind: 'heuristic',
        occupant: 'bot_heuristic',
        policyGen: BOT_LOGIC_VERSION,
        policyRef: null,
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
    overrideMargin = 0.02
} = {}) {
    const model = loadPPO(modelPath);
    return {
        kind: 'ppo',
        occupant: 'bot_ppo',
        policyGen: PPO_POLICY_GENERATION,
        policyRef: path.basename(modelPath),
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
                    policyGeneration: PPO_POLICY_GENERATION,
                    policyRef: path.basename(modelPath),
                    decision: decision ? {
                        action: decision.action,
                        key: decision.key,
                        heuristicKey: decision.heuristicKey,
                        overrodeHeuristic: decision.overrodeHeuristic,
                        policyMargin: decision.valueMargin,
                        guardFallback: decision.guardFallback,
                        reason: decision.overrodeHeuristic
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
        : Number(process.env.BOT_PPO_OVERRIDE_MARGIN)
} = {}) {
    if (mode === 'heuristic') return heuristicPolicy();
    if (mode === 'ppo') {
        if (!Number.isFinite(overrideMargin) || overrideMargin < 0) {
            throw new Error('BOT_PPO_OVERRIDE_MARGIN must be non-negative');
        }
        return ppoPolicy({ modelPath, overrideMargin });
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
    const advisor = ppoPolicy({ modelPath, overrideMargin });
    return {
        ...advisor,
        minMargin
    };
}

module.exports = {
    createBotPolicy,
    createCoachAdvisor,
    DEFAULT_PPO_MODEL_PATH,
    PPO_POLICY_GENERATION
};
