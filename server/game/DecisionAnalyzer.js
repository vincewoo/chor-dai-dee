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
     * Calculate late-game accuracy based on cards remaining and decision quality
     * @param {number} cardsInHand - Number of cards in hand
     * @param {number} totalCardsPlayed - Total cards played in the round
     * @returns {number} - Accuracy score (0-1)
     */
    static calculateLateGameAccuracy(cardsInHand, totalCardsPlayed) {
        // Late game is when > 60% of deck has been played
        const deckSize = 52;
        const playProgress = totalCardsPlayed / deckSize;

        if (playProgress < 0.6) {
            return 0.5; // Neutral in early/mid game
        }

        // In late game, fewer cards = better position
        const lateGameScore = Math.max(0, 1 - (cardsInHand / 13));
        return lateGameScore;
    }

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
     * @param {number} riskyPlaysSuccessful - Number of successful risky plays
     * @param {number} riskyPlaysFailed - Number of failed risky plays
     * @param {number} totalPlays - Total plays made
     * @returns {number} - Risk score (0-1)
     */
    static calculateRiskScore(riskyPlaysSuccessful, riskyPlaysFailed, totalPlays) {
        if (totalPlays === 0) return 0.5;

        const totalRiskyPlays = riskyPlaysSuccessful + riskyPlaysFailed;
        const riskyPlayRate = totalRiskyPlays / totalPlays;

        // Risk score combines frequency of risky plays and success rate
        const successRate = totalRiskyPlays > 0 ? riskyPlaysSuccessful / totalRiskyPlays : 0.5;

        return (riskyPlayRate * 0.6) + (successRate * 0.4);
    }

    /**
     * Calculate adaptability based on performance variance across games
     * @param {Array} placements - Array of placement finishes [1,2,3,4]
     * @returns {number} - Adaptability score (0-1)
     */
    static calculateAdaptabilityScore(placements) {
        if (placements.length < 3) return 0.5; // Not enough data

        // Calculate variance
        const avg = placements.reduce((a, b) => a + b, 0) / placements.length;
        const variance = placements.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / placements.length;
        const stdDev = Math.sqrt(variance);

        // Lower variance = more consistent = more adaptable
        // stdDev ranges from 0 (perfect consistency) to ~1.5 (high variance)
        const adaptability = Math.max(0, 1 - (stdDev / 1.5));

        return adaptability;
    }

    /**
     * Determine if a win was "lucky" vs "skilled"
     * @param {number} cardsRemainingAvg - Average cards remaining for other players
     * @param {number} playerOptimalRate - Player's optimal decision rate
     * @returns {boolean} - True if win appears lucky
     */
    static isLuckyWin(cardsRemainingAvg, playerOptimalRate) {
        // Lucky win indicators:
        // - Other players had many cards left (> 8 avg)
        // - Player's decision quality was low (< 50% optimal)

        const highCardRemainder = cardsRemainingAvg > 8;
        const lowSkillPlay = playerOptimalRate < 0.5;

        return highCardRemainder && lowSkillPlay;
    }
}

module.exports = { DecisionAnalyzer };
