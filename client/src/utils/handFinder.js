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

// Quick Select normally keeps structure-preserving hands ahead of options that
// borrow from another set. Low borrowed cards are still preferable to spending
// loose or paired aces and twos, which are valuable control cards.
const compareHandsLowestFirst = (a, b, optionPriorities) => {
    const optionPriorityDifference =
        (optionPriorities.get(a) || 0) - (optionPriorities.get(b) || 0);
    if (optionPriorityDifference !== 0) return optionPriorityDifference;

    if (a.value !== b.value) return a.value - b.value;

    for (let i = 0; i < Math.min(a.cards.length, b.cards.length); i++) {
        if (a.cards[i].value !== b.cards[i].value) {
            return a.cards[i].value - b.cards[i].value;
        }
    }

    return a.cards.length - b.cards.length;
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

// Optimized generator that calls callback for each combination
// callback should return true to stop generation (limit reached)
const generateCombinations = (arr, k, callback) => {
    const combine = (start, combo) => {
        if (combo.length === k) {
            return callback([...combo]);
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            if (combine(i + 1, combo)) return true;
            combo.pop();
        }
        return false;
    };
    combine(0, []);
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

const kickerOptionPriority = (rank, breaksSet) => {
    if (breaksSet) return rank === 'A' || rank === '2' ? 4 : 1;
    if (rank === 'A') return 2;
    if (rank === '2') return 3;
    return 0;
};

// Cartesian product for generating straights from rank groups
// Kept for backward compatibility if needed, but generateCartesianProduct is preferred
// eslint-disable-next-line no-unused-vars
const cartesianProduct = (arrays) => {
    return arrays.reduce((acc, curr) => {
        return acc.flatMap(a => curr.map(c => [...a, c]));
    }, [[]]);
};

// Optimized generator for cartesian product
const generateCartesianProduct = (arrays, callback) => {
    const generate = (index, current) => {
        if (index === arrays.length) {
            return callback([...current]);
        }
        for (const item of arrays[index]) {
            current.push(item);
            if (generate(index + 1, current)) return true;
            current.pop();
        }
        return false;
    };
    generate(0, []);
};

// Find all valid hands of a specific type that can beat the current hand
// Added limit parameter to optimize "check existence" calls
export const findEligibleHands = (playerHand, lastPlayedHand, handType, limit = Infinity, requiredCard = null) => {
    if (!playerHand || playerHand.length === 0) return [];

    // Generation order must not depend on how the player has manually sorted
    // their cards. This also makes limited existence searches deterministic.
    const handWithValues = sortCards(ensureCardValues(playerHand));
    const eligibleHands = [];
    const optionPriorities = new WeakMap();

    // Helper to add hand if valid and beats lastPlayedHand
    // Returns true if added, false otherwise
    const addIfValid = (cards, type, optionPriority = 0) => {
        if (eligibleHands.length >= limit) return false;
        if (requiredCard && !cards.some(card =>
            card.rank === requiredCard.rank && card.suit === requiredCard.suit
        )) return false;

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
        optionPriorities.set(handObj, optionPriority);

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
            const groups = Object.values(rankGroups);
            const quads = groups.filter(group => group.length === 4);

            for (const quad of quads) {
                const kickers = groups
                    .filter(group => group !== quad)
                    .flatMap(group => group.map(card => ({
                        card,
                        optionPriority: kickerOptionPriority(
                            card.rank,
                            group.length > 1
                        ),
                    })));

                for (const { card: kicker, optionPriority } of kickers) {
                    if (addIfValid(
                        [...quad, kicker],
                        HAND_TYPES.QUADS,
                        optionPriority
                    ) && eligibleHands.length >= limit) break;
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
                    combinations(group, 2).forEach(c => pairs.push({
                        cards: c,
                        rank: group[0].rank,
                        optionPriority: kickerOptionPriority(group[0].rank, true),
                    }));
                } else if (group.length === 2) {
                    pairs.push({
                        cards: group,
                        rank: group[0].rank,
                        optionPriority: kickerOptionPriority(group[0].rank, false),
                    });
                }
            });

            pairs.sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));

            for (const triple of triples) {
                for (const pair of pairs) {
                    if (triple.rank !== pair.rank) {
                        if (addIfValid(
                            [...triple.cards, ...pair.cards],
                            HAND_TYPES.FULL_HOUSE,
                            pair.optionPriority
                        ) && eligibleHands.length >= limit) break;
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
                    // Use lazy generation to avoid creating all combinations at once
                    generateCombinations(group, 5, (combo) => {
                        addIfValid(combo, HAND_TYPES.FLUSH);
                        return eligibleHands.length >= limit;
                    });
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
                 // Use lazy generation for Cartesian product
                 generateCartesianProduct(groups, (combo) => {
                     addIfValid(combo, HAND_TYPES.STRAIGHT);
                     return eligibleHands.length >= limit;
                 });
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

    eligibleHands.sort((a, b) =>
        compareHandsLowestFirst(a, b, optionPriorities)
    );
    return eligibleHands;
};

const handIdentity = (hand) => hand.cards.map(card => `${card.rank}-${card.suit}`).join(',');

// Return every combination for a Quick Select chip, putting the lowest
// currently playable combinations first. Non-playable combinations remain at
// the end so the chip can still cycle through them as a hand browser.
export const findQuickSelectHands = (playerHand, lastPlayedHand, handType, requiredCard = null) => {
    const allHands = findEligibleHands(playerHand, null, handType);

    if (!lastPlayedHand && !requiredCard) {
        return allHands.map(hand => ({ hand, canPlay: true }));
    }

    const playableKeys = new Set(
        findEligibleHands(
            playerHand,
            lastPlayedHand,
            handType,
            Infinity,
            requiredCard
        ).map(handIdentity)
    );
    const options = allHands.map(hand => ({
        hand,
        canPlay: playableKeys.has(handIdentity(hand)),
    }));

    return [
        ...options.filter(option => option.canPlay),
        ...options.filter(option => !option.canPlay),
    ];
};

// Find all hand types that have at least one eligible hand
export const findAvailableHandTypes = (playerHand, lastPlayedHand, requiredCard = null) => {
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
        const hands = findEligibleHands(
            handWithValues,
            lastPlayedHand,
            type,
            limit,
            requiredCard
        );

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
export default { findEligibleHands, findQuickSelectHands, findAvailableHandTypes, HAND_TYPES };
