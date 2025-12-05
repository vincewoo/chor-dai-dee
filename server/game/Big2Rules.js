// server/game/Big2Rules.js
const { SUITS, RANKS } = require('./Deck');

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
        return { type: HAND_TYPES.SINGLE, value: cards[0].value, rank: cards[0].rank, suit: cards[0].suit };
    },

    isPair: (cards) => {
        if (cards[0].rank === cards[1].rank) {
            // Value is the value of the higher suit card (which is at index 1 due to sort)
            return { type: HAND_TYPES.PAIR, value: cards[1].value, rank: cards[1].rank };
        }
        return null;
    },

    isTriple: (cards) => {
        if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) {
            return { type: HAND_TYPES.TRIPLE, value: cards[2].value, rank: cards[2].rank };
        }
        return null;
    },

    isFiveCardHand: (cards) => {
        // Check Strict Hierarchy: Straight Flush > Quads > Full House > Flush > Straight
        // Wait, usually Royal Flush is top, but that's just a high Straight Flush.

        const isFlush = cards.every(c => c.suit === cards[0].suit);
        const isStraight = Big2Rules.checkStraight(cards);

        if (isFlush && isStraight) {
            return { type: HAND_TYPES.STRAIGHT_FLUSH, value: cards[4].value };
        }

        const quads = Big2Rules.checkQuads(cards);
        if (quads) {
            return { type: HAND_TYPES.QUADS, value: quads.value };
        }

        const fullHouse = Big2Rules.checkFullHouse(cards);
        if (fullHouse) {
            return { type: HAND_TYPES.FULL_HOUSE, value: fullHouse.value };
        }

        if (isFlush) {
            // Flush value determined by highest card, then suit.
            // In HK rules, Suit > Rank usually? Or Rank > Suit?
            // "If two flushes have the same suit, the one with the highest rank card wins."
            // "Usually, the rank of the flush is determined by the highest card."
            // But suit order matters. Spades flush > Hearts flush.
            // Let's use the highest card's value.
            return { type: HAND_TYPES.FLUSH, value: cards[4].value, suit: cards[4].suit };
        }

        if (isStraight) {
            // Straight value determined by highest card
            return { type: HAND_TYPES.STRAIGHT, value: cards[4].value };
        }

        return null;
    },

    checkStraight: (cards) => {
        // Normal straights: 3-4-5-6-7 ... 10-J-Q-K-A
        // Special straights in Big 2: A-2-3-4-5 (Lowest?), J-Q-K-A-2 (Highest?)
        // In standard Big 2:
        // 3-4-5-6-7 is lowest.
        // ...
        // 2-3-4-5-6 is usually not allowed or treated specially.
        // A-2-3-4-5 is often valid (lowest).
        // J-Q-K-A-2 is often valid (highest).
        // Let's assume standard ranks logic first.
        // Since we mapped 3=0, ... 2=12.
        // A straight is 5 consecutive indices.

        // Check for normal consecutive
        let isConsecutive = true;
        for (let i = 0; i < 4; i++) {
             // We need to check RANKS indices.
             const rankIdx1 = RANKS.indexOf(cards[i].rank);
             const rankIdx2 = RANKS.indexOf(cards[i+1].rank);
             if (rankIdx2 !== rankIdx1 + 1) {
                 isConsecutive = false;
                 break;
             }
        }
        if (isConsecutive) return true;

        // Check for special straights involving 2 (which is index 12) and A (index 11)
        // A-2-3-4-5? Ranks: A, 2, 3, 4, 5. Indices: 11, 12, 0, 1, 2.
        // 3-4-5-6-7 ...
        // In our sorting (by value), 2 is high.
        // If we have A, 2, 3, 4, 5. Sorted by value: 3, 4, 5, A, 2.
        // Let's check ranks present.
        const ranks = cards.map(c => c.rank);
        const has = (r) => ranks.includes(r);

        // A-2-3-4-5?
        if (has('A') && has('2') && has('3') && has('4') && has('5')) return true;

        // J-Q-K-A-2?
        // Sorted: J, Q, K, A, 2. This is consecutive in our system!
        // J=8, Q=9, K=10, A=11, 2=12. This is consecutive.

        return false;
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
    }
};

module.exports = { Big2Rules, HAND_TYPES };
