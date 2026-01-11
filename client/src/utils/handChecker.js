// Client-side utility to check if any hand can beat the current hand
// This is a simplified version of the server's Big2Rules for auto-pass detection
import { findEligibleHands, HAND_TYPES as FINDER_HAND_TYPES } from './handFinder.js';

const SUITS = ['D', 'C', 'H', 'S'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

const HAND_TYPES = {
    SINGLE: 'SINGLE',
    PAIR: 'PAIR',
    TRIPLE: 'TRIPLE',
    STRAIGHT: 'STRAIGHT',
    FLUSH: 'FLUSH',
    FULL_HOUSE: 'FULL_HOUSE',
    QUADS: 'QUADS',
    STRAIGHT_FLUSH: 'STRAIGHT_FLUSH'
};

const FIVE_CARD_ORDER = [HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH, HAND_TYPES.FULL_HOUSE, HAND_TYPES.QUADS, HAND_TYPES.STRAIGHT_FLUSH];

// Get card value for comparison
const getCardValue = (rank, suit) => {
    const rankIndex = RANKS.indexOf(rank);
    const suitIndex = SUITS.indexOf(suit);
    return rankIndex * 4 + suitIndex;
};

// Ensure cards have value property
const ensureCardValues = (cards) => {
    return cards.map(c => ({
        ...c,
        value: c.value !== undefined ? c.value : getCardValue(c.rank, c.suit)
    }));
};

// Sort cards by value
const sortCards = (cards) => {
    return [...cards].sort((a, b) => a.value - b.value);
};

// Validate a single card
const validateSingle = (cards) => {
    if (cards.length !== 1) return null;
    return { type: HAND_TYPES.SINGLE, value: cards[0].value };
};

// Validate a pair
const validatePair = (cards) => {
    if (cards.length !== 2) return null;
    if (cards[0].rank === cards[1].rank) {
        const sorted = sortCards(cards);
        return { type: HAND_TYPES.PAIR, value: sorted[1].value };
    }
    return null;
};

// Validate a triple
const validateTriple = (cards) => {
    if (cards.length !== 3) return null;
    if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) {
        const sorted = sortCards(cards);
        return { type: HAND_TYPES.TRIPLE, value: sorted[2].value };
    }
    return null;
};

// Check if cards form a straight
const checkStraight = (cards) => {
    const ranks = cards.map(c => c.rank);
    const has = (r) => ranks.includes(r);

    // Special: A-2-3-4-5
    if (has('A') && has('2') && has('3') && has('4') && has('5')) return true;
    // Special: 2-3-4-5-6
    if (has('2') && has('3') && has('4') && has('5') && has('6')) return true;
    // No 2 in other straights
    if (cards.some(c => c.rank === '2')) return false;

    // Check consecutive
    const sorted = sortCards(cards);
    for (let i = 0; i < 4; i++) {
        const rankIdx1 = RANKS.indexOf(sorted[i].rank);
        const rankIdx2 = RANKS.indexOf(sorted[i + 1].rank);
        if (rankIdx2 !== rankIdx1 + 1) return false;
    }
    return true;
};

// Validate five-card hands
const validateFiveCard = (cards) => {
    if (cards.length !== 5) return null;

    const sorted = sortCards(cards);
    const isFlush = cards.every(c => c.suit === cards[0].suit);
    const isStraight = checkStraight(cards);

    if (isFlush && isStraight) {
        const ranks = cards.map(c => c.rank);
        if (ranks.includes('2')) {
            const twoCard = cards.find(c => c.rank === '2');
            let value = twoCard.value;
            if (ranks.includes('A')) value += 4;
            return { type: HAND_TYPES.STRAIGHT_FLUSH, value };
        }
        return { type: HAND_TYPES.STRAIGHT_FLUSH, value: sorted[4].value };
    }

    // Check quads
    const rankCounts = {};
    cards.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
    const quadRank = Object.keys(rankCounts).find(r => rankCounts[r] === 4);
    if (quadRank) {
        const quadCards = cards.filter(c => c.rank === quadRank);
        return { type: HAND_TYPES.QUADS, value: Math.max(...quadCards.map(c => c.value)) };
    }

    // Check full house
    const tripleRank = Object.keys(rankCounts).find(r => rankCounts[r] === 3);
    const pairRank = Object.keys(rankCounts).find(r => rankCounts[r] === 2);
    if (tripleRank && pairRank) {
        const tripleCards = cards.filter(c => c.rank === tripleRank);
        return { type: HAND_TYPES.FULL_HOUSE, value: Math.max(...tripleCards.map(c => c.value)) };
    }

    if (isFlush) {
        return { type: HAND_TYPES.FLUSH, value: sorted[4].value };
    }

    if (isStraight) {
        const ranks = cards.map(c => c.rank);
        if (ranks.includes('2')) {
            const twoCard = cards.find(c => c.rank === '2');
            let value = twoCard.value;
            if (ranks.includes('A')) value += 4;
            return { type: HAND_TYPES.STRAIGHT, value };
        }
        return { type: HAND_TYPES.STRAIGHT, value: sorted[4].value };
    }

    return null;
};

// Validate any hand
const validateHand = (cards) => {
    if (!cards || cards.length === 0) return null;
    const withValues = ensureCardValues(cards);

    if (cards.length === 1) return validateSingle(withValues);
    if (cards.length === 2) return validatePair(withValues);
    if (cards.length === 3) return validateTriple(withValues);
    if (cards.length === 5) return validateFiveCard(withValues);

    return null;
};

// Check if newHand beats oldHand
const canBeat = (newHand, oldHand) => {
    if (!newHand || !oldHand) return false;

    if (newHand.type === oldHand.type) {
        return newHand.value > oldHand.value;
    }

    // Different types - only for 5 card hands
    if (FIVE_CARD_ORDER.includes(newHand.type) && FIVE_CARD_ORDER.includes(oldHand.type)) {
        return FIVE_CARD_ORDER.indexOf(newHand.type) > FIVE_CARD_ORDER.indexOf(oldHand.type);
    }

    return false;
};

// Check if any valid hand from playerHand can beat lastPlayedHand
// Optimized to use constructive search instead of brute-force combinations
export const canBeatWithAnyHand = (playerHand, lastPlayedHand) => {
    if (!lastPlayedHand || !playerHand || playerHand.length === 0) return true;

    const cardCount = lastPlayedHand.cards.length;

    // Types to check depends on card count
    let typesToCheck = [];

    if (cardCount === 1) typesToCheck = [FINDER_HAND_TYPES.SINGLE];
    else if (cardCount === 2) typesToCheck = [FINDER_HAND_TYPES.PAIR];
    else if (cardCount === 3) typesToCheck = [FINDER_HAND_TYPES.TRIPLE];
    else if (cardCount === 5) {
        // For 5 cards, check all 5-card types.
        // findEligibleHands handles the logic of checking if the found hand actually beats lastPlayedHand
        // (including type superiority e.g. Flush > Straight)
        typesToCheck = [
            FINDER_HAND_TYPES.STRAIGHT,
            FINDER_HAND_TYPES.FLUSH,
            FINDER_HAND_TYPES.FULL_HOUSE,
            FINDER_HAND_TYPES.QUADS,
            FINDER_HAND_TYPES.STRAIGHT_FLUSH
        ];
    }

    for (const type of typesToCheck) {
        // findEligibleHands checks for hands of 'type' that can beat 'lastPlayedHand'
        // Limit to 1 for performance - we only need to know if ANY hand exists
        const eligible = findEligibleHands(playerHand, lastPlayedHand, type, 1);
        if (eligible.length > 0) return true;
    }

    return false;
};

export default { canBeatWithAnyHand, validateHand, canBeat };
