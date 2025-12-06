// Utility to find all eligible hands from player's cards
// Used for the hand helper buttons feature

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

// Validate and get hand info
const validateHand = (cards) => {
    if (!cards || cards.length === 0) return null;
    const withValues = ensureCardValues(cards);
    const sorted = sortCards(withValues);

    if (cards.length === 1) {
        return { type: HAND_TYPES.SINGLE, value: withValues[0].value, cards: withValues };
    }

    if (cards.length === 2) {
        if (withValues[0].rank === withValues[1].rank) {
            return { type: HAND_TYPES.PAIR, value: sorted[1].value, cards: sorted };
        }
        return null;
    }

    if (cards.length === 3) {
        if (withValues[0].rank === withValues[1].rank && withValues[1].rank === withValues[2].rank) {
            return { type: HAND_TYPES.TRIPLE, value: sorted[2].value, cards: sorted };
        }
        return null;
    }

    if (cards.length === 5) {
        const isFlush = withValues.every(c => c.suit === withValues[0].suit);
        const isStraight = checkStraight(withValues);

        if (isFlush && isStraight) {
            const ranks = withValues.map(c => c.rank);
            if (ranks.includes('2')) {
                const twoCard = withValues.find(c => c.rank === '2');
                let value = twoCard.value;
                if (ranks.includes('A')) value += 4;
                return { type: HAND_TYPES.STRAIGHT_FLUSH, value, cards: sorted };
            }
            return { type: HAND_TYPES.STRAIGHT_FLUSH, value: sorted[4].value, cards: sorted };
        }

        // Check quads
        const rankCounts = {};
        withValues.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
        const quadRank = Object.keys(rankCounts).find(r => rankCounts[r] === 4);
        if (quadRank) {
            const quadCards = withValues.filter(c => c.rank === quadRank);
            return { type: HAND_TYPES.QUADS, value: Math.max(...quadCards.map(c => c.value)), cards: sorted };
        }

        // Check full house
        const tripleRank = Object.keys(rankCounts).find(r => rankCounts[r] === 3);
        const pairRank = Object.keys(rankCounts).find(r => rankCounts[r] === 2);
        if (tripleRank && pairRank) {
            const tripleCards = withValues.filter(c => c.rank === tripleRank);
            return { type: HAND_TYPES.FULL_HOUSE, value: Math.max(...tripleCards.map(c => c.value)), cards: sorted };
        }

        if (isFlush) {
            return { type: HAND_TYPES.FLUSH, value: sorted[4].value, cards: sorted };
        }

        if (isStraight) {
            const ranks = withValues.map(c => c.rank);
            if (ranks.includes('2')) {
                const twoCard = withValues.find(c => c.rank === '2');
                let value = twoCard.value;
                if (ranks.includes('A')) value += 4;
                return { type: HAND_TYPES.STRAIGHT, value, cards: sorted };
            }
            return { type: HAND_TYPES.STRAIGHT, value: sorted[4].value, cards: sorted };
        }

        return null;
    }

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

// Generate all combinations of size k from array
const combinations = (arr, k) => {
    if (k === 0) return [[]];
    if (arr.length < k) return [];

    const result = [];
    const combine = (start, combo) => {
        if (combo.length === k) {
            result.push([...combo]);
            return;
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            combine(i + 1, combo);
            combo.pop();
        }
    };
    combine(0, []);
    return result;
};

// Find all valid hands of a specific type that can beat the current hand
export const findEligibleHands = (playerHand, lastPlayedHand, handType) => {
    if (!playerHand || playerHand.length === 0) return [];

    const handWithValues = ensureCardValues(playerHand);
    const eligibleHands = [];

    // Determine the size we need based on the hand type
    let cardCount;
    switch (handType) {
        case HAND_TYPES.SINGLE:
            cardCount = 1;
            break;
        case HAND_TYPES.PAIR:
            cardCount = 2;
            break;
        case HAND_TYPES.TRIPLE:
            cardCount = 3;
            break;
        case HAND_TYPES.STRAIGHT:
        case HAND_TYPES.FLUSH:
        case HAND_TYPES.FULL_HOUSE:
        case HAND_TYPES.QUADS:
        case HAND_TYPES.STRAIGHT_FLUSH:
            cardCount = 5;
            break;
        default:
            return [];
    }

    // If there's a hand to beat, we must match its size
    if (lastPlayedHand && lastPlayedHand.cards) {
        const requiredCount = lastPlayedHand.cards.length;
        if (cardCount !== requiredCount) return [];
    }

    // Generate all combinations of the required size
    const allCombos = combinations(handWithValues, cardCount);

    for (const combo of allCombos) {
        const validated = validateHand(combo);
        if (validated && validated.type === handType) {
            // If there's a hand to beat, check if this beats it
            if (lastPlayedHand && lastPlayedHand.type) {
                const lastHandValidated = {
                    type: lastPlayedHand.type,
                    value: lastPlayedHand.value
                };
                if (canBeat(validated, lastHandValidated)) {
                    eligibleHands.push(validated);
                }
            } else {
                // Free play - any valid hand works
                eligibleHands.push(validated);
            }
        }
    }

    // Sort by value (lowest first, so cycling goes from weakest to strongest)
    eligibleHands.sort((a, b) => a.value - b.value);

    return eligibleHands;
};

// Find all hand types that have at least one eligible hand
export const findAvailableHandTypes = (playerHand, lastPlayedHand) => {
    if (!playerHand || playerHand.length === 0) return [];

    const handWithValues = ensureCardValues(playerHand);
    const availableTypes = [];

    // Determine what card count we need (if there's a hand to beat)
    let requiredCount = null;
    if (lastPlayedHand && lastPlayedHand.cards) {
        requiredCount = lastPlayedHand.cards.length;
    }

    // Check each hand type
    const handTypesToCheck = [
        { type: HAND_TYPES.SINGLE, count: 1 },
        { type: HAND_TYPES.PAIR, count: 2 },
        { type: HAND_TYPES.TRIPLE, count: 3 },
        { type: HAND_TYPES.STRAIGHT, count: 5 },
        { type: HAND_TYPES.FLUSH, count: 5 },
        { type: HAND_TYPES.FULL_HOUSE, count: 5 },
        { type: HAND_TYPES.QUADS, count: 5 },
        { type: HAND_TYPES.STRAIGHT_FLUSH, count: 5 }
    ];

    for (const { type, count } of handTypesToCheck) {
        // Skip if this type doesn't match the required card count
        if (requiredCount !== null && count !== requiredCount) continue;

        const eligibleHands = findEligibleHands(handWithValues, lastPlayedHand, type);
        if (eligibleHands.length > 0) {
            availableTypes.push({
                type,
                count: eligibleHands.length,
                displayName: type.replace(/_/g, ' ')
            });
        }
    }

    return availableTypes;
};

export { HAND_TYPES };
export default { findEligibleHands, findAvailableHandTypes, HAND_TYPES };
