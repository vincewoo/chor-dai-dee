/**
 * Card sorting and utility functions for Big Two (Chor Dai Dee)
 */

// Card ordering constants
export const SUITS_ORDER = ['D', 'C', 'H', 'S']; // Diamonds < Clubs < Hearts < Spades
export const RANKS_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

/**
 * Calculate numeric value of a card for sorting purposes
 * @param {Object} card - Card object with rank and suit properties
 * @returns {number} Numeric value (0-51) for sorting
 */
export const getCardValue = (card) => {
    const rankIndex = RANKS_ORDER.indexOf(card.rank);
    const suitIndex = SUITS_ORDER.indexOf(card.suit);
    return rankIndex * 4 + suitIndex;
};

/**
 * Sort cards by rank (primary), then by suit (secondary)
 * @param {Array} cards - Array of card objects
 * @returns {Array} New sorted array
 */
export const sortByRank = (cards) => {
    return [...cards].sort((a, b) => getCardValue(a) - getCardValue(b));
};

/**
 * Sort cards by suit (primary), then by rank (secondary)
 * @param {Array} cards - Array of card objects
 * @returns {Array} New sorted array
 */
export const sortBySuit = (cards) => {
    return [...cards].sort((a, b) => {
        const suitDiff = SUITS_ORDER.indexOf(a.suit) - SUITS_ORDER.indexOf(b.suit);
        if (suitDiff !== 0) return suitDiff;
        return RANKS_ORDER.indexOf(a.rank) - RANKS_ORDER.indexOf(b.rank);
    });
};

/**
 * Generate a stable key for a played hand (only changes when cards change)
 * Used for React animation keys
 * @param {Object} lastPlayed - Last played hand object
 * @returns {string|null} Stable key string or null
 */
export const getPlayedHandKey = (lastPlayed) => {
    if (!lastPlayed) return null;
    if (lastPlayed.type === 'pass') return 'pass';
    return lastPlayed.cards?.map(c => `${c.rank}-${c.suit}`).join(',') || null;
};
