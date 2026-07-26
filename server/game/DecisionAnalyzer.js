// server/game/DecisionAnalyzer.js
const { Big2Rules } = require('./Big2Rules');

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

    /**
     * Evaluate if a play decision is optimal, suboptimal, or risky
     * @param {Object} params - { action, hand, pile, cardsInDeck, playedCards }
     * @returns {Object} - { quality: 'optimal'|'suboptimal'|'risky', isRisky: boolean, reasoning: string }
     */
    static evaluateDecision({ action, hand, pile, cardsInDeck, playedCards }) {
        const handStrength = this.calculateHandStrength(hand);
        const pileStrength = this.calculatePileStrength(pile);

        if (action === 'pass') {
            // Passing is optimal when pile is strong and hand is weak
            if (pileStrength > 60 && handStrength < 40) {
                return { quality: 'optimal', isRisky: false, reasoning: 'Wise pass against strong pile with weak hand' };
            }
            // Passing is suboptimal when you could play and pile is weak
            if (pileStrength < 30 && handStrength > 50) {
                return { quality: 'suboptimal', isRisky: false, reasoning: 'Could have played against weak pile' };
            }
            return { quality: 'optimal', isRisky: false, reasoning: 'Reasonable pass' };
        }

        if (action === 'play') {
            // Playing strong cards early is risky
            if (hand.length > 8 && handStrength > 70) {
                return { quality: 'risky', isRisky: true, reasoning: 'Playing strong cards with many cards remaining' };
            }

            // Playing when you have control is optimal
            if (!pile) {
                return { quality: 'optimal', isRisky: false, reasoning: 'Leading with control' };
            }

            // Beating a weak pile is optimal
            if (pileStrength < 40) {
                return { quality: 'optimal', isRisky: false, reasoning: 'Beating weak pile' };
            }

            // Using powerful hands to beat strong piles in late game is optimal
            if (hand.length <= 5 && handStrength > 60) {
                return { quality: 'optimal', isRisky: false, reasoning: 'Strong play in end game' };
            }

            return { quality: 'optimal', isRisky: false, reasoning: 'Standard play' };
        }

        return { quality: 'optimal', isRisky: false, reasoning: 'Unknown action' };
    }

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
            total: 0,
            optimal: 0,
            suboptimal: 0,
            plays: 0,
            passes: 0,
            riskySucceeded: 0,
            riskyFailed: 0,
            lateTotal: 0,
            lateOptimal: 0
        };

        for (const d of decisions || []) {
            summary.total++;
            if (d.quality === 'optimal') summary.optimal++;
            else summary.suboptimal++;

            if (d.action === 'play') summary.plays++;
            else if (d.action === 'pass') summary.passes++;

            // Risky plays resolve when the trick they were made into resolves.
            // An unresolved one (the round ended first) is counted as neither.
            if (d.riskOutcome === 'success') summary.riskySucceeded++;
            else if (d.riskOutcome === 'failed') summary.riskyFailed++;

            if (this.isLateGameDecision(d)) {
                summary.lateTotal++;
                if (d.quality === 'optimal') summary.lateOptimal++;
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
     * Calculate aggression score based on play patterns
     * @param {number} totalPlays - Total plays made
     * @param {number} totalPasses - Total passes made
     * @param {number} leadsWon - Number of times won control
     * @returns {number} - Aggression score (0-1)
     */
    static calculateAggressionScore(totalPlays, totalPasses, leadsWon) {
        const totalActions = totalPlays + totalPasses;
        if (totalActions === 0) return 0.5;

        const playRate = totalPlays / totalActions;
        const leadRate = totalActions > 0 ? leadsWon / totalPlays : 0;

        // Aggression = high play rate + high control rate
        return (playRate * 0.7) + (leadRate * 0.3);
    }

    /**
     * Calculate risk score based on risky play frequency
     *
     * All three arguments must be counted over the same population. Callers
     * used to divide per-game risky counters by a lifetime count of plays,
     * which pinned riskyPlayRate near zero and made the score a function of
     * the success rate alone.
     *
     * @param {number} riskyPlaysSuccessful - Number of successful risky plays
     * @param {number} riskyPlaysFailed - Number of failed risky plays
     * @param {number} totalDecisions - Decisions taken over the same period
     * @returns {number} - Risk score (0-1)
     */
    static calculateRiskScore(riskyPlaysSuccessful, riskyPlaysFailed, totalDecisions) {
        if (totalDecisions === 0) return 0.5;

        const totalRiskyPlays = riskyPlaysSuccessful + riskyPlaysFailed;
        const riskyPlayRate = Math.min(1, totalRiskyPlays / totalDecisions);

        // Risk score combines frequency of risky plays and success rate
        const successRate = totalRiskyPlays > 0 ? riskyPlaysSuccessful / totalRiskyPlays : 0.5;

        return (riskyPlayRate * 0.6) + (successRate * 0.4);
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
}

module.exports = { DecisionAnalyzer };
