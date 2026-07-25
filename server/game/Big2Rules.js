// server/game/Big2Rules.js
const { SUITS, RANKS } = require('./Deck');

/**
 * Generation of the rules in force, recorded on every logged game so old games
 * replay under the rules they were actually played with.
 *
 * Bump when any of these changes:
 *   - hand validity or comparison in this file, including the A-2-3-4-5 and
 *     2-3-4-5-6 straight special cases and the flush suit-in-`value` convention
 *   - the Hong Kong dragon rule (isDragon, and its 39-point penalty)
 *   - the 2-of-Spades single auto-pass rule in RoomManager.playHand
 *   - round scoring, including the 1x/2x/3x penalty tiers in Scoring.js
 *   - who leads: 3-of-Diamonds on round 1, previous winner thereafter
 *
 * That list is the contract. A change not on it does not affect replay.
 * test/versionPins.test.js fails if the covered source changes without a bump.
 *
 * Changelog:
 *   1 - as of the first logged game. Earlier history is not backfillable.
 */
const RULES_VERSION = 1;

// Hand Types
const HAND_TYPES = {
    SINGLE: 'SINGLE',
    PAIR: 'PAIR',
    TRIPLE: 'TRIPLE',
    STRAIGHT: 'STRAIGHT',
    FLUSH: 'FLUSH',
    FULL_HOUSE: 'FULL_HOUSE',
    QUADS: 'QUADS', // Four of a kind + 1
    STRAIGHT_FLUSH: 'STRAIGHT_FLUSH'
};

const Big2Rules = {
    // Check if a hand is valid and return its type and value
    validateHand: (cards) => {
        if (!cards || cards.length === 0) return null;
        const sortedCards = Big2Rules.sortCards(cards);
        const count = sortedCards.length;

        if (count === 1) return Big2Rules.isSingle(sortedCards);
        if (count === 2) return Big2Rules.isPair(sortedCards);
        if (count === 3) return Big2Rules.isTriple(sortedCards);
        if (count === 5) return Big2Rules.isFiveCardHand(sortedCards);

        return null;
    },

    sortCards: (cards) => {
        return [...cards].sort((a, b) => a.value - b.value);
    },

    isSingle: (cards) => {
        return { type: HAND_TYPES.SINGLE, value: cards[0].value, rank: cards[0].rank, suit: cards[0].suit, cards };
    },

    isPair: (cards) => {
        if (cards[0].rank === cards[1].rank) {
            // Value is the value of the higher suit card (which is at index 1 due to sort)
            return { type: HAND_TYPES.PAIR, value: cards[1].value, rank: cards[1].rank, cards };
        }
        return null;
    },

    isTriple: (cards) => {
        if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) {
            return { type: HAND_TYPES.TRIPLE, value: cards[2].value, rank: cards[2].rank, cards };
        }
        return null;
    },

    isFiveCardHand: (cards) => {
        // Check Strict Hierarchy: Straight Flush > Quads > Full House > Flush > Straight
        // Wait, usually Royal Flush is top, but that's just a high Straight Flush.

        const isFlush = cards.every(c => c.suit === cards[0].suit);
        const isStraight = Big2Rules.checkStraight(cards);

        if (isFlush && isStraight) {
            // Special cases for straight flushes with 2 (2 is high):
            // - A-2-3-4-5: HIGHEST straight flush, value based on 2
            // - 2-3-4-5-6: second highest, value based on 2
            const ranks = cards.map(c => c.rank);
            if (ranks.includes('2')) {
                const twoCard = cards.find(c => c.rank === '2');
                let value = twoCard.value;
                if (ranks.includes('A')) {
                    // A-2-3-4-5 is the highest straight flush
                    value += 4;
                }
                return { type: HAND_TYPES.STRAIGHT_FLUSH, value, cards };
            }
            return { type: HAND_TYPES.STRAIGHT_FLUSH, value: cards[4].value, cards };
        }

        const quads = Big2Rules.checkQuads(cards);
        if (quads) {
            return { type: HAND_TYPES.QUADS, value: quads.value, cards };
        }

        const fullHouse = Big2Rules.checkFullHouse(cards);
        if (fullHouse) {
            return { type: HAND_TYPES.FULL_HOUSE, value: fullHouse.value, cards };
        }

        if (isFlush) {
            // Flush value determined by highest card, then suit.
            // In HK rules, Suit > Rank usually? Or Rank > Suit?
            // "If two flushes have the same suit, the one with the highest rank card wins."
            // "Usually, the rank of the flush is determined by the highest card."
            // But suit order matters. Spades flush > Hearts flush.
            // Let's use the highest card's value.
            return { type: HAND_TYPES.FLUSH, value: cards[4].value, suit: cards[4].suit, cards };
        }

        if (isStraight) {
            // Straight value determined by highest card
            // Special cases for straights with 2 (2 is high):
            // - A-2-3-4-5: HIGHEST straight, value based on 2
            // - 2-3-4-5-6: second highest, value based on 2
            const ranks = cards.map(c => c.rank);
            if (ranks.includes('2')) {
                // Any straight with 2 uses 2's value (2 is highest card)
                const twoCard = cards.find(c => c.rank === '2');
                // A-2-3-4-5 is higher than 2-3-4-5-6, so add a bonus for having A
                let value = twoCard.value;
                if (ranks.includes('A')) {
                    // A-2-3-4-5 is the highest straight - add 4 to ensure it beats 2-3-4-5-6
                    value += 4;
                }
                return { type: HAND_TYPES.STRAIGHT, value, cards };
            }
            return { type: HAND_TYPES.STRAIGHT, value: cards[4].value, cards };
        }

        return null;
    },

    checkStraight: (cards) => {
        // Valid straights in Big 2:
        // - Standard: 3-4-5-6-7 up to 10-J-Q-K-A
        // - Special: A-2-3-4-5 (lowest straight, "wheel")
        // - Special: 2-3-4-5-6 (second lowest)
        // Invalid: J-Q-K-A-2 (2 cannot be high end of straight)

        const ranks = cards.map(c => c.rank);
        const has = (r) => ranks.includes(r);

        // Check for special straight: A-2-3-4-5 (lowest straight - "wheel")
        if (has('A') && has('2') && has('3') && has('4') && has('5')) {
            return true;
        }

        // Check for special straight: 2-3-4-5-6 (second lowest)
        if (has('2') && has('3') && has('4') && has('5') && has('6')) {
            return true;
        }

        // For all other straights, 2 is not allowed
        if (cards.some(c => c.rank === '2')) {
            return false;
        }

        // Check for normal consecutive (using rank indices)
        // RANKS: ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
        // So 3=0, 4=1, ... A=11, 2=12
        // Valid straights go from index 0-4 (3-4-5-6-7) to index 7-11 (10-J-Q-K-A)
        let isConsecutive = true;
        for (let i = 0; i < 4; i++) {
            const rankIdx1 = RANKS.indexOf(cards[i].rank);
            const rankIdx2 = RANKS.indexOf(cards[i+1].rank);
            if (rankIdx2 !== rankIdx1 + 1) {
                isConsecutive = false;
                break;
            }
        }

        return isConsecutive;
    },

    checkQuads: (cards) => {
        // 4 of a kind + 1
        // Sorted: A A A A B or B A A A A
        const ranks = cards.map(c => c.rank);
        if (ranks[0] === ranks[3]) return { value: cards[3].value }; // AAAA B (value is of the quad)
        if (ranks[1] === ranks[4]) return { value: cards[4].value }; // B AAAA
        return null;
    },

    checkFullHouse: (cards) => {
        // 3 of one, 2 of another.
        // Sorted: A A A B B or B B A A A
        const ranks = cards.map(c => c.rank);
        if (ranks[0] === ranks[2] && ranks[3] === ranks[4]) {
            // AAA BB - Value determined by the triple
            return { value: cards[2].value };
        }
        if (ranks[0] === ranks[1] && ranks[2] === ranks[4]) {
            // BB AAA
            return { value: cards[4].value };
        }
        return null;
    },

    // Compare if newHand beats oldHand
    canBeat: (newHand, oldHand) => {
        if (!newHand || !oldHand) return false;

        // Must be same number of cards (except special cases? No, strict usually)
        // Wait, can you play 5 card hands over other 5 card hands of different types? Yes.
        const count = newHand.cards ? newHand.cards.length : 0; // Assuming we pass full object or just check types?
        // Let's assume we passed the result of validateHand.

        if (newHand.type === oldHand.type) {
             // Same type, compare values
             // EXCEPT for Flush: Suit priority vs Rank priority.
             // Our 'value' logic handles Rank priority mostly.
             // For Flush, we used cards[4].value.
             // If suits are different?
             // "If two flushes have the same suit, the one with the highest rank card wins."
             // "If the suits are different, the one with the higher suit wins." (Some rules)
             // HK Rules: Rank of flush determined by highest card. If highest cards same, compare suit of highest card.
             // Our `value` = RankIndex * 4 + SuitIndex. So it handles both naturally.
             // 2 of Spades > 2 of Hearts.
             // So simply comparing value works.
             return newHand.value > oldHand.value;
        }

        // Different types - only for 5 card hands
        const fiveCardOrder = [HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH, HAND_TYPES.FULL_HOUSE, HAND_TYPES.QUADS, HAND_TYPES.STRAIGHT_FLUSH];
        if (fiveCardOrder.includes(newHand.type) && fiveCardOrder.includes(oldHand.type)) {
            return fiveCardOrder.indexOf(newHand.type) > fiveCardOrder.indexOf(oldHand.type);
        }

        return false;
    },

    // Check if a hand is a dragon (one card of each rank: A-2-3-4-5-6-7-8-9-10-J-Q-K)
    // Hong Kong variation: player with dragon immediately wins the game
    isDragon: (cards) => {
        if (!cards || cards.length !== 13) return false;

        // Get all ranks in the hand
        const ranks = cards.map(c => c.rank);
        const uniqueRanks = new Set(ranks);

        // Dragon requires exactly one card of each rank (13 unique ranks)
        if (uniqueRanks.size !== 13) return false;

        // Verify all 13 ranks are present
        const allRanks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
        return allRanks.every(rank => uniqueRanks.has(rank));
    }
};

// Ordinal encoding for the game log. Order is pinned by SCHEMA_VERSION: append
// only, never reorder, or every logged hand_type silently changes meaning.
const HAND_TYPE_ORDINALS = {
    [HAND_TYPES.SINGLE]: 0,
    [HAND_TYPES.PAIR]: 1,
    [HAND_TYPES.TRIPLE]: 2,
    [HAND_TYPES.STRAIGHT]: 3,
    [HAND_TYPES.FLUSH]: 4,
    [HAND_TYPES.FULL_HOUSE]: 5,
    [HAND_TYPES.QUADS]: 6,
    [HAND_TYPES.STRAIGHT_FLUSH]: 7
};

const HAND_TYPE_BY_ORDINAL = Object.fromEntries(
    Object.entries(HAND_TYPE_ORDINALS).map(([name, ord]) => [ord, name])
);

module.exports = {
    Big2Rules,
    HAND_TYPES,
    HAND_TYPE_ORDINALS,
    HAND_TYPE_BY_ORDINAL,
    RULES_VERSION
};
