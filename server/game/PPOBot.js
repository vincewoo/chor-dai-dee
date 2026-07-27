// Variable-action actor/critic policy. Legal moves and public features come
// from the same canonical encoder as RLValueBot.

const { decisionOptions } = require('./RLValueBot');

function sampleIndex(probabilities, rng) {
    const threshold = rng();
    let cumulative = 0;
    for (let index = 0; index < probabilities.length; index++) {
        cumulative += probabilities[index];
        if (threshold < cumulative) return index;
    }
    return probabilities.length - 1;
}

class PPOBot {
    constructor(model, {
        sample = false,
        temperature = 1,
        overrideMargin = 0,
        rng = Math.random,
        captureTrajectory = false,
        onDecision = null
    } = {}) {
        this.model = model;
        this.sample = sample;
        this.temperature = temperature;
        this.overrideMargin = overrideMargin;
        this.rng = rng;
        this.captureTrajectory = captureTrajectory;
        this.onDecision = onDecision;
    }

    getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext = {}) {
        const options = decisionOptions({
            hand, lastPlayedHand, isFirstTurn, gameContext
        });
        if (!options.length) return null;

        const evaluation = this.model.evaluate(
            options.map(option => option.features), this.temperature);
        const heuristicIndex = options.findIndex(
            option => option.isHeuristicChoice);
        const rawIndex = this.sample
            ? sampleIndex(evaluation.probabilities, this.rng)
            : evaluation.logits.reduce((best, logit, index, logits) =>
                logit > logits[best] ? index : best, 0);
        let chosenIndex = rawIndex;
        let guardFallback = false;
        if (!this.sample && heuristicIndex !== -1 &&
            rawIndex !== heuristicIndex &&
            evaluation.logits[rawIndex] <
                evaluation.logits[heuristicIndex] + this.overrideMargin) {
            chosenIndex = heuristicIndex;
            guardFallback = true;
        }
        const chosen = options[chosenIndex];

        if (this.onDecision) {
            const decision = {
                action: chosen.action,
                key: chosen.key,
                chosenIndex,
                heuristicIndex,
                oldLogProbability:
                    Math.log(Math.max(1e-12, evaluation.probabilities[chosenIndex])),
                predictedValue: evaluation.value,
                optionCount: options.length,
                heuristicKey:
                    heuristicIndex === -1 ? null : options[heuristicIndex].key,
                rawChoiceKey: options[rawIndex].key,
                rawPreferredOverride:
                    heuristicIndex !== -1 && rawIndex !== heuristicIndex,
                overrodeHeuristic:
                    heuristicIndex !== -1 && chosenIndex !== heuristicIndex,
                guardFallback,
                valueMargin: heuristicIndex === -1
                    ? null
                    : evaluation.logits[rawIndex] -
                        evaluation.logits[heuristicIndex],
                blendedMargin: null
            };
            if (this.captureTrajectory) {
                decision.actionFeatures =
                    options.map(option => [...option.features]);
            }
            this.onDecision(decision);
        }
        return chosen.action === 'pass' ? null : chosen.move.cards;
    }
}

module.exports = { PPOBot, sampleIndex };
