// server/game/DecisionAnalyzer.js
const { Big2Rules } = require('./Big2Rules');

// Reference points for the behavioural axes, measured rather than chosen.
//
// 160 seat-samples over 40 four-handed games, every decision graded by
// MoveQuality with the bots playing their own policy. Medians and the
// inter-quartile spread of that sample:
//
//   early-round play rate   p25 0.719  median 0.765  p75 0.826
//   gambles per play        p25 0.165  median 0.200  p75 0.237
//
// The bands are wider than that IQR because the reference is four copies of
// one policy and real players spread further; a band at the bot IQR would flip
// a human between labels on noise. Regenerate with the baseline script in the
// PR description if the cost model changes.
//
// The previous thresholds (aggression > 0.7 AND risk > 0.6 for Aggressive)
// were unreachable: sweeping the space the scores can occupy put 90% of a
// realistic band in Balanced and 0% in Aggressive.
const BEHAVIOR_BASELINE_VERSION = 1;
const AGGRESSION_REFERENCE = 0.765;
const AGGRESSION_BAND = 0.08;
const RISK_REFERENCE = 0.200;
const RISK_BAND = 0.06;

/**
 * DecisionAnalyzer - Evaluates hand strength, decision quality, and play optimality
 * Used for Tier 3 advanced analytics
 */

class DecisionAnalyzer {
    /**
     * Calculate the raw strength of a hand based on card values and possible combinations
     * @param {Array} hand - Array of card values
     * @returns {number} - Hand strength score (0-100)
     */
    static calculateHandStrength(hand) {
        if (!hand || hand.length === 0) return 0;

        let score = 0;
        const sorted = [...hand].sort((a, b) => a - b);

        // High card value (higher cards = stronger)
        // Cards range from 0 (3 of diamonds) to 51 (2 of spades)
        const avgCardValue = sorted.reduce((sum, card) => sum + card, 0) / sorted.length;
        score += (avgCardValue / 51) * 30; // Up to 30 points for high card values

        // Count valuable combinations
        const combinations = this.findAllCombinations(sorted);

        // Straight flushes (most valuable)
        score += combinations.straightFlushes * 15;

        // Quads
        score += combinations.quads * 12;

        // Full houses
        score += combinations.fullHouses * 10;

        // Flushes
        score += combinations.flushes * 8;

        // Straights
        score += combinations.straights * 7;

        // Triples
        score += combinations.triples * 5;

        // Pairs
        score += combinations.pairs * 2;

        // Having 2s (most powerful card)
        const twoCount = sorted.filter(card => Math.floor(card / 4) === 12).length;
        score += twoCount * 8;

        // Hand size factor (fewer cards = better position)
        const handSizePenalty = (hand.length / 13) * 10;
        score -= handSizePenalty;

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Find all possible combinations in a hand
     * @param {Array} sortedHand - Sorted array of card values
     * @returns {Object} - Count of each combination type
     */
    static findAllCombinations(sortedHand) {
        const combinations = {
            straightFlushes: 0,
            quads: 0,
            fullHouses: 0,
            flushes: 0,
            straights: 0,
            triples: 0,
            pairs: 0
        };

        // Group cards by rank
        const rankGroups = {};
        sortedHand.forEach(card => {
            const rank = Math.floor(card / 4);
            if (!rankGroups[rank]) rankGroups[rank] = [];
            rankGroups[rank].push(card);
        });

        // Count pairs, triples, quads
        Object.values(rankGroups).forEach(group => {
            if (group.length === 4) combinations.quads++;
            else if (group.length === 3) combinations.triples++;
            else if (group.length === 2) combinations.pairs++;
        });

        // Check for full houses (triple + pair)
        if (combinations.triples > 0 && combinations.pairs > 0) {
            combinations.fullHouses++;
        }

        // Check for straights and flushes (simplified - check 5-card windows)
        if (sortedHand.length >= 5) {
            combinations.straights = this.countStraights(sortedHand);
            combinations.flushes = this.countFlushes(sortedHand);
            combinations.straightFlushes = this.countStraightFlushes(sortedHand);
        }

        return combinations;
    }

    static countStraights(hand) {
        let count = 0;
        const ranks = hand.map(c => Math.floor(c / 4));

        for (let i = 0; i <= ranks.length - 5; i++) {
            const window = ranks.slice(i, i + 5);
            const uniqueRanks = [...new Set(window)];
            if (uniqueRanks.length === 5) {
                // Check if consecutive (accounting for Big 2 rank order)
                const sorted = uniqueRanks.sort((a, b) => a - b);
                let isConsecutive = true;
                for (let j = 1; j < sorted.length; j++) {
                    if (sorted[j] - sorted[j-1] !== 1) {
                        isConsecutive = false;
                        break;
                    }
                }
                if (isConsecutive) count++;
            }
        }
        return count;
    }

    static countFlushes(hand) {
        const suits = {};
        hand.forEach(card => {
            const suit = card % 4;
            suits[suit] = (suits[suit] || 0) + 1;
        });
        return Object.values(suits).filter(count => count >= 5).length;
    }

    static countStraightFlushes(hand) {
        const bySuit = {};
        hand.forEach(card => {
            const suit = card % 4;
            if (!bySuit[suit]) bySuit[suit] = [];
            bySuit[suit].push(card);
        });

        let count = 0;
        Object.values(bySuit).forEach(suitCards => {
            if (suitCards.length >= 5) {
                count += this.countStraights(suitCards);
            }
        });
        return count;
    }

    /**
     * Calculate the strength of the current pile on the table
     * @param {Object} pile - { cards, type, value } or null
     * @returns {number} - Pile strength (0-100)
     */
    static calculatePileStrength(pile) {
        if (!pile || !pile.cards) return 0;

        const { type, value, cards } = pile;
        let strength = 0;

        // Base strength by type
        const typeStrengths = {
            'single': 10,
            'pair': 20,
            'triple': 30,
            'straight': 50,
            'flush': 60,
            'full_house': 70,
            'quads': 85,
            'straight_flush': 95
        };

        strength = typeStrengths[type] || 0;

        // Add value factor (higher cards = stronger)
        const valueBonus = (value / 51) * 20;
        strength += valueBonus;

        return Math.min(100, strength);
    }

    // evaluateDecision is gone. It graded a move with an if-ladder whose
    // fallback was 'optimal', so nearly every play scored as optimal whatever
    // was on the table. Grading now happens in MoveQuality.js, which ranks the
    // move actually made inside BotLogic's own scored list of the legal
    // alternatives. calculateHandStrength and calculatePileStrength above stay:
    // they are descriptive metadata stored alongside each decision, not the
    // judgement itself.

    /**
     * Roll a game's tracked decisions up into the counts the stats tables
     * store. Every figure here is per DECISION - the aggregates used to be
     * incremented once per game, which made "247 decisions" mean "247 games".
     *
     * @param {Array} decisions - Decision records from Room.tier3DecisionTracking
     * @returns {Object} - Counts, all integers
     */
    static summarizeDecisions(decisions) {
        const summary = {
            // Decisions that carried a real choice. Forced moves are counted
            // separately: a pass with nothing that beats the pile, or a lone
            // legal lead, measures the cards, not the player.
            total: 0,
            forced: 0,
            optimal: 0,
            suboptimal: 0,
            // Summed normalized loss over `total`. Accuracy is 1 - loss/total.
            totalLoss: 0,
            plays: 0,
            passes: 0,
            // Plays chosen over an available alternative, and the same split by
            // round phase. These are the aggression axis: forced moves are
            // excluded, so bad cards no longer read as a passive style.
            choicePlays: 0,
            earlyChoices: 0,
            earlyChoicePlays: 0,
            lateChoices: 0,
            lateChoicePlays: 0,
            // A pass with nothing that beats the pile says the cards were
            // unplayable; a pass with a legal answer in hand is a choice. Split
            // apart, a high pass rate stops reading as passivity by default.
            forcedPasses: 0,
            voluntaryPasses: 0,
            // Decisions taken with an opponent one or two cards from going out,
            // and how many of those contested the trick rather than conceding.
            dangerDecisions: 0,
            dangerContested: 0,
            riskySucceeded: 0,
            riskyFailed: 0,
            lateTotal: 0,
            lateOptimal: 0
        };

        for (const d of decisions || []) {
            if (d.action === 'play') summary.plays++;
            else if (d.action === 'pass') {
                summary.passes++;
                if (d.forced) summary.forcedPasses++;
                else summary.voluntaryPasses++;
            }

            // Only counts where the player had something to decide: conceding
            // with no legal answer is not a failure to respond.
            if (!d.forced && this.isDangerDecision(d)) {
                summary.dangerDecisions++;
                if (d.action === 'play') summary.dangerContested++;
            }

            // Risky plays resolve when the trick they were made into resolves.
            // An unresolved one (the round ended first) is counted as neither.
            if (d.riskOutcome === 'success') summary.riskySucceeded++;
            else if (d.riskOutcome === 'failed') summary.riskyFailed++;

            if (!d.scored) {
                if (d.forced) summary.forced++;
                continue;
            }

            summary.total++;
            summary.totalLoss += d.lossFraction || 0;

            // Plays made when holding back was an option. This is the honest
            // numerator for aggression: a forced lead is not assertiveness and
            // a forced pass is not caution.
            const chosePlay = d.action === 'play';
            if (chosePlay) summary.choicePlays++;

            const isOptimal = d.quality === 'optimal';
            if (isOptimal) summary.optimal++;
            else summary.suboptimal++;

            if (this.isEarlyGameDecision(d)) {
                summary.earlyChoices++;
                if (chosePlay) summary.earlyChoicePlays++;
            }

            if (this.isLateGameDecision(d)) {
                summary.lateTotal++;
                summary.lateChoices++;
                if (chosePlay) summary.lateChoicePlays++;
                if (isOptimal) summary.lateOptimal++;
            }
        }

        return summary;
    }

    /**
     * Late game is when more than 60% of the deck has been played. Each
     * decision records the deck remaining at the moment it was taken, so this
     * is a property of the decision rather than of the game's final state.
     */
    static isLateGameDecision(decision) {
        return this.roundProgress(decision) > 0.6;
    }

    /**
     * Was an opponent close enough to going out that letting the trick go was
     * likely to end the round? Two cards is the point at which a single
     * uncontested trick can finish them.
     */
    static isDangerDecision(decision) {
        return typeof decision.minOpponentCards === 'number' && decision.minOpponentCards <= 2;
    }

    /** Mirror of isLateGameDecision: the opening 40% of a round. */
    static isEarlyGameDecision(decision) {
        return this.roundProgress(decision) < 0.4;
    }

    /** Fraction of the deck already played when a decision was taken. */
    static roundProgress(decision) {
        const deckSize = 52;
        const cardsInDeck = typeof decision.cardsInDeck === 'number' ? decision.cardsInDeck : deckSize;
        return (deckSize - cardsInDeck) / deckSize;
    }

    // Late-game accuracy is lateOptimal / lateTotal. It is stored as those two
    // counts and divided on read (db.getCardAwarenessStats) rather than kept as
    // a running mean, so it stays a ratio of things that actually happened.

    /**
     * Aggression: how often a player engages when holding back is genuinely an
     * option, measured over the opening 40% of a round.
     *
     * Three things this fixes. It used to divide plays by plays-plus-passes,
     * counting FORCED passes as passivity - so a player dealt unplayable cards
     * read as timid. It blended in leadsWon/totalPlays, which is closer to how
     * effective a play was than to how willing the player is to make one, and
     * which divided by zero (guarded on the wrong variable) for anyone who
     * passed without playing, poisoning the stored EWMA with NaN permanently.
     *
     * And it covered the whole round. Late in a round everyone plays whatever
     * they legally can - measured across 160 reference seats the late-round
     * play rate has a median of 1.000 - so including that region only dilutes
     * the signal. The early round is where players actually differ.
     *
     * @param {number} earlyChoicePlays - Early plays chosen over an alternative
     * @param {number} earlyChoices - Early decisions that offered a choice
     * @returns {number} - Aggression score (0-1), 0.5 when unknown
     */
    static calculateAggressionScore(earlyChoicePlays, earlyChoices) {
        if (!earlyChoices) return 0.5;
        return earlyChoicePlays / earlyChoices;
    }

    /**
     * Risk: how often a player's plays are gambles - a card committed where
     * the value at stake times the chance of losing it clears the price the
     * cost model puts on a trick.
     *
     * Frequency only. The old version was 0.6 x frequency + 0.4 x success
     * rate, which made the score non-monotonic in risk: a cautious player who
     * won two gambles scored 0.412 while a reckless one who lost thirty scored
     * 0.180. How the gambles turn out is a separate question, and one the
     * "Risky play success" meter already answers. A player who never gambles
     * now scores 0 rather than 0.200.
     *
     * Per PLAY rather than per decision. Gambles are plays, so dividing by all
     * decisions couples this to how often the player plays at all - measured
     * across the reference sample that coupling is r = 0.32, against r = 0.15
     * per play. The archetype needs two axes that move independently.
     *
     * @param {number} riskyPlaysSuccessful - Gambles that held the trick
     * @param {number} riskyPlaysFailed - Gambles that were beaten
     * @param {number} choicePlays - Plays made when there was a choice
     * @returns {number} - Risk score (0-1), 0.5 when unknown
     */
    static calculateRiskScore(riskyPlaysSuccessful, riskyPlaysFailed, choicePlays) {
        if (!choicePlays) return 0.5;
        return Math.min(1, (riskyPlaysSuccessful + riskyPlaysFailed) / choicePlays);
    }

    /**
     * Adaptability: is the player's recent form improving on their earlier
     * form? This used to be 1 - stdDev/1.5 over the placement history, which
     * is the same number updateVarianceScores already stores as
     * consistency_rating - two meters showing one measurement. Consistency is
     * the spread; adaptability is the trend.
     *
     * @param {Array} placements - Placement finishes, NEWEST FIRST (the order
     *                             getPlacementHistory returns). Order matters
     *                             here, unlike the variance calculation it
     *                             replaces.
     * @returns {number} - Adaptability score (0-1), 0.5 when flat or unknown
     */
    static calculateAdaptabilityScore(placements) {
        if (!placements || placements.length < 6) return 0.5; // Not enough data

        // Split the window in half: most recent games against what came before.
        const half = Math.floor(placements.length / 2);
        const recent = placements.slice(0, half);
        const earlier = placements.slice(half);

        const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

        // Lower placement is better, so an improving player has a positive
        // delta. One whole placement of improvement saturates the scale.
        const delta = mean(earlier) - mean(recent);
        return Math.max(0, Math.min(1, 0.5 + delta / 2));
    }

    // isLuckyWin is gone. Splitting wins into "lucky" and "skilled" on a pair of
    // thresholds was a coarse restatement of what the deal-strength stats
    // already measure: those work per round rather than per game, over every
    // round rather than wins only, against a measured per-tier baseline, and
    // with a confidence interval. See DealStrength.js and the hand-strength
    // endpoint in index.js.

    /**
     * Classify a play style from the two axes that were measured to move
     * independently (r = 0.007 across the reference sample): how often a player
     * engages early, and how much they commit per play.
     *
     * Four quadrants exist; three get names, because "plays often with cheap
     * cards" is not a distinct style so much as steadiness. Nothing here reads
     * form: a trend in results is not a play style, and the old 'Adaptive' label
     * claimed to detect opponent reading that nothing in the data supports.
     */
    static classifyArchetype(aggression, risk) {
        const engaged = aggression > AGGRESSION_REFERENCE + AGGRESSION_BAND;
        const withdrawn = aggression < AGGRESSION_REFERENCE - AGGRESSION_BAND;
        const committing = risk > RISK_REFERENCE + RISK_BAND;
        const sparing = risk < RISK_REFERENCE - RISK_BAND;

        if (engaged && committing) return 'Aggressive';
        if (withdrawn && sparing) return 'Conservative';
        // Picks its spots, then commits hard to the ones it picks.
        if (withdrawn && committing) return 'Opportunist';
        return 'Balanced';
    }
}

module.exports = { DecisionAnalyzer, BEHAVIOR_BASELINE_VERSION };
