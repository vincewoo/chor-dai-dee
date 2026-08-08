// Experimental variable-action value policy.
//
// Each legal play (and pass, when meaningful) is encoded alongside the public
// observation and scored by RLValueModel.  The heuristic score is an input and
// can also be blended at selection time, allowing a learned checkpoint to be
// introduced gradually while BotLogic remains the safe fallback.

const { BotLogic } = require('./BotLogic');
const { HAND_TYPES } = require('./Big2Rules');
const { rankOptions } = require('./MoveQuality');
const { FEATURE_NAMES } = require('./BotFeatures');

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function removeCards(hand, cards) {
    if (!cards) return [...hand];
    return hand.filter(card =>
        !cards.some(used => used.rank === card.rank && used.suit === card.suit));
}

function countShapes(hand) {
    if (!hand.length) return { pairs: 0, triples: 0, fives: 0 };
    const byRank = new Map();
    const bySuit = new Map();
    for (const card of hand) {
        byRank.set(card.rank, (byRank.get(card.rank) || 0) + 1);
        bySuit.set(card.suit, (bySuit.get(card.suit) || 0) + 1);
    }
    const rankCounts = [...byRank.values()];
    const hasFullHouse = rankCounts.some(count => count >= 3) &&
        rankCounts.some(count => count >= 2) &&
        (rankCounts.filter(count => count >= 2).length >= 2 ||
            rankCounts.some(count => count >= 5));
    const hasQuads = hand.length >= 5 && rankCounts.some(count => count === 4);
    const hasFlush = [...bySuit.values()].some(count => count >= 5);
    const rankWindows = [
        ['3', '4', '5', '6', '7'], ['4', '5', '6', '7', '8'],
        ['5', '6', '7', '8', '9'], ['6', '7', '8', '9', '10'],
        ['7', '8', '9', '10', 'J'], ['8', '9', '10', 'J', 'Q'],
        ['9', '10', 'J', 'Q', 'K'], ['10', 'J', 'Q', 'K', 'A'],
        ['A', '2', '3', '4', '5'], ['2', '3', '4', '5', '6']
    ];
    const straightWindows = rankWindows.filter(window =>
        window.every(rank => byRank.has(rank))).length;
    return {
        pairs: rankCounts.reduce((sum, count) => sum + count * (count - 1) / 2, 0),
        triples: rankCounts.reduce((sum, count) =>
            sum + count * (count - 1) * (count - 2) / 6, 0),
        // This is deliberately an inexpensive structural signal rather than
        // another legal-move enumeration for every candidate.
        fives: straightWindows + Number(hasFlush) + Number(hasFullHouse) + Number(hasQuads)
    };
}

/**
 * Encode one option. Values are deliberately bounded near [-1, 1] so the
 * dependency-free network trains stably without a separate normalization file.
 */
function encodeCandidate({
    hand,
    lastPlayedHand,
    isFirstTurn,
    gameContext,
    option,
    optionIndex,
    optionCount,
    heuristicKey = null
}) {
    const counts = gameContext.playerCardCounts || [13, 13, 13];
    const played = gameContext.playedCards || [];
    const cards = option.move ? option.move.cards : [];
    const remaining = removeCards(hand, cards);
    const shapes = countShapes(remaining);
    const lastRelative = gameContext.lastPlayedByRelative;
    const heuristicScore = Number.isFinite(option.score) ? option.score : -1000;
    const feature = {
        bias: 1,
        own_cards: hand.length / 13,
        next_cards: counts[0] / 13,
        across_cards: counts[1] / 13,
        previous_cards: counts[2] / 13,
        min_opponent_cards: Math.min(...counts) / 13,
        played_fraction: played.length / 52,
        pass_count: clamp((gameContext.passCount || 0) / 3, 0, 1),
        has_control: lastPlayedHand ? 0 : 1,
        first_turn: isFirstTurn ? 1 : 0,
        pile_by_next: lastRelative === 1 ? 1 : 0,
        pile_by_across: lastRelative === 2 ? 1 : 0,
        pile_by_previous: lastRelative === 3 ? 1 : 0,
        action_pass: option.action === 'pass' ? 1 : 0,
        action_size: cards.length / 5,
        action_strength: option.move ? clamp(option.move.value / 56, 0, 1) : 0,
        heuristic_score: Math.tanh(heuristicScore / 250),
        heuristic_rank: optionCount <= 1 ? 1 : 1 - optionIndex / (optionCount - 1),
        heuristic_choice: option.key === heuristicKey ? 1 : 0,
        spends_king: cards.some(card => card.rank === 'K') ? 1 : 0,
        spends_ace: cards.some(card => card.rank === 'A') ? 1 : 0,
        spends_two: cards.some(card => card.rank === '2') ? 1 : 0,
        remaining_cards: remaining.length / 13,
        remaining_pairs: clamp(shapes.pairs / 12, 0, 1),
        remaining_triples: clamp(shapes.triples / 4, 0, 1),
        remaining_five_card_hands: clamp(shapes.fives / 20, 0, 1),
        remaining_aces: remaining.filter(card => card.rank === 'A').length / 4,
        remaining_twos: remaining.filter(card => card.rank === '2').length / 4,
        plays_out: remaining.length === 0 ? 1 : 0,
        crosses_ten_card_tier: hand.length >= 10 && remaining.length < 10 ? 1 : 0,
        crosses_thirteen_card_tier: hand.length >= 13 && remaining.length < 13 ? 1 : 0,
        opponent_at_one: Math.min(...counts) <= 1 ? 1 : 0,
        opponent_at_two: Math.min(...counts) === 2 ? 1 : 0
    };
    return FEATURE_NAMES.map(name => feature[name]);
}

function decisionOptions({ hand, lastPlayedHand, isFirstTurn, gameContext }) {
    const heuristicMove = BotLogic.getBotMove(
        hand,
        lastPlayedHand,
        isFirstTurn,
        { ...gameContext, profile: null },
        false
    );
    const heuristicKey = heuristicMove
        ? heuristicMove.map(card => `${card.rank}${card.suit}`).sort().join(',')
        : 'pass';
    const ranked = rankOptions({
        hand,
        lastPlayedHand,
        isFirstTurn,
        gameContext,
        keepKey: heuristicKey
    });
    return ranked.options.map((option, optionIndex, options) => {
        const normalizedKey = option.move
            ? option.move.cards.map(card => `${card.rank}${card.suit}`).sort().join(',')
            : option.key;
        const candidate = { ...option, key: normalizedKey };
        return {
            ...candidate,
            isHeuristicChoice: normalizedKey === heuristicKey,
            features: encodeCandidate({
                hand,
                lastPlayedHand,
                isFirstTurn,
                gameContext,
                option: candidate,
                optionIndex,
                optionCount: options.length,
                heuristicKey
            })
        };
    });
}

class RLValueBot {
    constructor(model, {
        valueWeight = 1,
        heuristicWeight = 0.20,
        overrideMargin = 0.05,
        epsilon = 0,
        rng = Math.random,
        captureTrajectory = false,
        onDecision = null
    } = {}) {
        this.model = model;
        this.valueWeight = valueWeight;
        this.heuristicWeight = heuristicWeight;
        this.overrideMargin = overrideMargin;
        this.epsilon = epsilon;
        this.rng = rng;
        this.captureTrajectory = captureTrajectory;
        this.onDecision = onDecision;
    }

    getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext = {}) {
        const options = decisionOptions({ hand, lastPlayedHand, isFirstTurn, gameContext });
        if (!options.length) return null; // forced pass

        for (const option of options) {
            option.value = this.model.predict(option.features);
            option.blendedScore =
                this.valueWeight * option.value +
                this.heuristicWeight * Math.tanh(
                    (Number.isFinite(option.score) ? option.score : -1000) / 250);
        }

        const heuristic = options.find(option => option.isHeuristicChoice);
        let chosen;
        let rawChoice;
        let explored = false;
        let guardFallback = false;
        if (this.epsilon > 0 && this.rng() < this.epsilon) {
            explored = true;
            chosen = options[Math.floor(this.rng() * options.length)];
            rawChoice = chosen;
        } else {
            rawChoice = options.reduce((best, option) =>
                option.blendedScore > best.blendedScore ? option : best);
            chosen = rawChoice;
            if (heuristic && rawChoice !== heuristic &&
                rawChoice.value < heuristic.value + this.overrideMargin) {
                chosen = heuristic;
                guardFallback = true;
            }
        }

        if (this.onDecision) {
            const decision = {
                features: [...chosen.features],
                action: chosen.action,
                key: chosen.key,
                chosenIndex: options.indexOf(chosen),
                heuristicIndex: heuristic ? options.indexOf(heuristic) : -1,
                predictedValue: chosen.value,
                maxPredictedValue: Math.max(
                    ...options.map(option => option.value)),
                optionCount: options.length,
                explored,
                heuristicKey: heuristic ? heuristic.key : null,
                rawChoiceKey: rawChoice ? rawChoice.key : null,
                rawPreferredOverride: Boolean(heuristic && rawChoice !== heuristic),
                overrodeHeuristic: Boolean(heuristic && chosen !== heuristic),
                guardFallback,
                valueMargin: heuristic && rawChoice
                    ? rawChoice.value - heuristic.value
                    : null,
                blendedMargin: heuristic && rawChoice
                    ? rawChoice.blendedScore - heuristic.blendedScore
                    : null
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

module.exports = { RLValueBot, encodeCandidate, decisionOptions };
