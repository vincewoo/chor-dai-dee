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
// Used for small sets (like generating pairs from 3 cards of same rank)
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

// Helper to group cards by rank
const groupCardsByRank = (cards) => {
    const groups = {};
    cards.forEach(card => {
        if (!groups[card.rank]) groups[card.rank] = [];
        groups[card.rank].push(card);
    });
    return groups;
};

// Helper to group cards by suit
const groupCardsBySuit = (cards) => {
    const groups = {};
    cards.forEach(card => {
        if (!groups[card.suit]) groups[card.suit] = [];
        groups[card.suit].push(card);
    });
    return groups;
};

// Cartesian product for generating straights from rank groups
const cartesianProduct = (arrays) => {
    return arrays.reduce((acc, curr) => {
        return acc.flatMap(a => curr.map(c => [...a, c]));
    }, [[]]);
};

// Find all valid hands of a specific type that can beat the current hand
// Added limit parameter to optimize "check existence" calls
export const findEligibleHands = (playerHand, lastPlayedHand, handType, limit = Infinity) => {
    if (!playerHand || playerHand.length === 0) return [];

    const handWithValues = ensureCardValues(playerHand);
    const eligibleHands = [];

    // Helper to add hand if valid and beats lastPlayedHand
    // Returns true if added, false otherwise
    const addIfValid = (cards, type) => {
        if (eligibleHands.length >= limit) return false;

        const sorted = sortCards(cards);
        let value;

        // Calculate value based on type logic matching server/Big2Rules.js and client/handChecker.js
        if (type === HAND_TYPES.SINGLE) value = sorted[0].value;
        else if (type === HAND_TYPES.PAIR) value = sorted[1].value;
        else if (type === HAND_TYPES.TRIPLE) value = sorted[2].value;
        else if (type === HAND_TYPES.FLUSH) value = sorted[4].value;
        else if (type === HAND_TYPES.FULL_HOUSE) {
             const rankCounts = {};
             sorted.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
             const tripleRank = Object.keys(rankCounts).find(r => rankCounts[r] === 3);
             const tripleCards = sorted.filter(c => c.rank === tripleRank);
             value = Math.max(...tripleCards.map(c => c.value));
        }
        else if (type === HAND_TYPES.QUADS) {
             const rankCounts = {};
             sorted.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
             const quadRank = Object.keys(rankCounts).find(r => rankCounts[r] === 4);
             const quadCards = sorted.filter(c => c.rank === quadRank);
             value = Math.max(...quadCards.map(c => c.value));
        }
        else if (type === HAND_TYPES.STRAIGHT || type === HAND_TYPES.STRAIGHT_FLUSH) {
             const ranks = sorted.map(c => c.rank);
             if (ranks.includes('2')) {
                 const twoCard = sorted.find(c => c.rank === '2');
                 value = twoCard.value;
                 if (ranks.includes('A')) value += 4;
             } else {
                 value = sorted[4].value;
             }
        }

        const handObj = { type, value, cards: sorted };

        if (lastPlayedHand) {
            if (canBeat(handObj, lastPlayedHand)) {
                eligibleHands.push(handObj);
                return true;
            }
        } else {
            eligibleHands.push(handObj);
            return true;
        }
        return false;
    };

    switch (handType) {
        case HAND_TYPES.SINGLE: {
            for (const card of handWithValues) {
                if (addIfValid([card], HAND_TYPES.SINGLE) && eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.PAIR: {
            const rankGroups = groupCardsByRank(handWithValues);
            const groups = Object.values(rankGroups);
            for (const group of groups) {
                if (group.length >= 2) {
                    const combos = combinations(group, 2);
                    for (const combo of combos) {
                        if (addIfValid(combo, HAND_TYPES.PAIR) && eligibleHands.length >= limit) break;
                    }
                }
                if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.TRIPLE: {
            const rankGroups = groupCardsByRank(handWithValues);
            const groups = Object.values(rankGroups);
            for (const group of groups) {
                if (group.length >= 3) {
                    const combos = combinations(group, 3);
                    for (const combo of combos) {
                        if (addIfValid(combo, HAND_TYPES.TRIPLE) && eligibleHands.length >= limit) break;
                    }
                }
                if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.QUADS: {
            const rankGroups = groupCardsByRank(handWithValues);
            const quads = [];
            const others = [];

            Object.values(rankGroups).forEach((group) => {
                if (group.length === 4) {
                    quads.push(group);
                } else {
                    others.push(...group);
                }
            });

            for (const quad of quads) {
                const kickers = [...others];
                for (const otherQuad of quads) {
                    if (otherQuad !== quad) kickers.push(...otherQuad);
                }

                for (const kicker of kickers) {
                    if (addIfValid([...quad, kicker], HAND_TYPES.QUADS) && eligibleHands.length >= limit) break;
                }
                if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.FULL_HOUSE: {
            const rankGroups = groupCardsByRank(handWithValues);
            const triples = [];
            const pairs = [];

            Object.values(rankGroups).forEach(group => {
                if (group.length >= 3) {
                    combinations(group, 3).forEach(c => triples.push({ cards: c, rank: group[0].rank }));
                    // Pairs from triples are added but will be deprioritized
                    combinations(group, 2).forEach(c => pairs.push({ cards: c, rank: group[0].rank, fromTriple: true }));
                } else if (group.length === 2) {
                    pairs.push({ cards: group, rank: group[0].rank, fromTriple: false });
                }
            });

            // Sort pairs: non-triple pairs first (sorted by rank), then triple-derived pairs (sorted by rank)
            // Within each group, sort by lowest rank value first
            pairs.sort((a, b) => {
                // First priority: prefer pairs NOT from triples
                if (a.fromTriple !== b.fromTriple) {
                    return a.fromTriple ? 1 : -1;
                }
                // Second priority: prefer lower rank pairs
                const aRankIndex = RANKS.indexOf(a.rank);
                const bRankIndex = RANKS.indexOf(b.rank);
                return aRankIndex - bRankIndex;
            });

            for (const triple of triples) {
                for (const pair of pairs) {
                    if (triple.rank !== pair.rank) {
                        if (addIfValid([...triple.cards, ...pair.cards], HAND_TYPES.FULL_HOUSE) && eligibleHands.length >= limit) break;
                    }
                }
                if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.FLUSH: {
            const suitGroups = groupCardsBySuit(handWithValues);
            const groups = Object.values(suitGroups);
            for (const group of groups) {
                if (group.length >= 5) {
                    const combos = combinations(group, 5);
                    for (const combo of combos) {
                        if (addIfValid(combo, HAND_TYPES.FLUSH) && eligibleHands.length >= limit) break;
                    }
                }
                if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.STRAIGHT: {
            const rankGroups = groupCardsByRank(handWithValues);
            const presentRanks = Object.keys(rankGroups);
            const standardRanks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
            const sequences = [];

            // Standard sequences (3-4-5-6-7 through 10-J-Q-K-A)
            // Loop only to i=7 to avoid invalid J-Q-K-A-2
            for (let i = 0; i <= 7; i++) {
                const seq = standardRanks.slice(i, i + 5);
                if (seq.every(r => presentRanks.includes(r))) {
                    sequences.push(seq);
                }
            }
            // A-2-3-4-5
            if (['A', '2', '3', '4', '5'].every(r => presentRanks.includes(r))) {
                sequences.push(['3', '4', '5', 'A', '2']);
            }
            // 2-3-4-5-6
            if (['2', '3', '4', '5', '6'].every(r => presentRanks.includes(r))) {
                sequences.push(['3', '4', '5', '6', '2']);
            }

            for (const seq of sequences) {
                 const groups = seq.map(r => rankGroups[r]);
                 const combos = cartesianProduct(groups);
                 for (const combo of combos) {
                     if (addIfValid(combo, HAND_TYPES.STRAIGHT) && eligibleHands.length >= limit) break;
                 }
                 if (eligibleHands.length >= limit) break;
            }
            break;
        }
        case HAND_TYPES.STRAIGHT_FLUSH: {
             const suitGroups = groupCardsBySuit(handWithValues);
             const groups = Object.values(suitGroups);
             for (const group of groups) {
                 if (group.length >= 5) {
                     // Do not limit inner search: max straights in a suit is small (~10), and limiting could miss winning hands
                     const subHand = findEligibleHands(group, null, HAND_TYPES.STRAIGHT);
                     for (const h of subHand) {
                         if (addIfValid(h.cards, HAND_TYPES.STRAIGHT_FLUSH) && eligibleHands.length >= limit) break;
                     }
                 }
                 if (eligibleHands.length >= limit) break;
             }
             break;
        }
    }

    eligibleHands.sort((a, b) => a.value - b.value);
    return eligibleHands;
};

// Find all hand types that have at least one eligible hand
export const findAvailableHandTypes = (playerHand, lastPlayedHand) => {
    if (!playerHand || playerHand.length === 0) return [];

    const handWithValues = ensureCardValues(playerHand);
    const availableTypes = [];

    let requiredCount = null;
    if (lastPlayedHand && lastPlayedHand.cards) {
        requiredCount = lastPlayedHand.cards.length;
    }

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
        if (requiredCount !== null && count !== requiredCount) continue;

        // Optimization: Limit to 100 hands.
        // This prevents generating thousands of combinations (e.g. Flush) just to show a button.
        // 100 is enough for the user to cycle through (UX-wise).
        const limit = 100;
        const hands = findEligibleHands(handWithValues, lastPlayedHand, type, limit);

        if (hands.length > 0) {
            availableTypes.push({
                type,
                // Return number so UI logic (count > 1) works correctly.
                count: hands.length,
                displayName: type.replace(/_/g, ' ')
            });
        }
    }

    return availableTypes;
};

export { HAND_TYPES };
export default { findEligibleHands, findAvailableHandTypes, HAND_TYPES };
