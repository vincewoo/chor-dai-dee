import test from 'node:test';
import assert from 'node:assert/strict';

import { findEligibleHands, findQuickSelectHands, HAND_TYPES } from '../src/utils/handFinder.js';

const card = (notation) => ({
    rank: notation.slice(0, -1),
    suit: notation.slice(-1),
});

const hand = (...notations) => notations.map(card);
const ids = (cards) => cards.map(({ rank, suit }) => `${rank}${suit}`);
const ranks = (cards) => cards.map(({ rank }) => rank);

test('full house uses the lowest triple and lowest available pair', () => {
    const cards = hand('5S', '4H', '3S', '5D', '4D', '3D', '4S', '3H');

    const [lowest] = findEligibleHands(cards, null, HAND_TYPES.FULL_HOUSE);

    assert.deepEqual(ranks(lowest.cards), ['3', '3', '3', '4', '4']);
});

test('quick-select hand types return their lowest combination first', () => {
    const cases = [
        {
            type: HAND_TYPES.PAIR,
            cards: hand('4S', '3H', '4D', '3D', '3C'),
            expected: ['3D', '3C'],
        },
        {
            type: HAND_TYPES.TRIPLE,
            cards: hand('4S', '3S', '4D', '3H', '3D', '3C'),
            expected: ['3D', '3C', '3H'],
        },
        {
            type: HAND_TYPES.STRAIGHT,
            cards: hand('7S', '6D', '5H', '4C', '3S', '3D'),
            expected: ['3D', '4C', '5H', '6D', '7S'],
        },
        {
            type: HAND_TYPES.FLUSH,
            cards: hand('8D', '5D', '3D', '7D', '4D', '6D'),
            expected: ['3D', '4D', '5D', '6D', '7D'],
        },
        {
            type: HAND_TYPES.QUADS,
            cards: hand('6S', '4D', '6D', '3S', '6H', '6C'),
            expected: ['3S', '6D', '6C', '6H', '6S'],
        },
        {
            type: HAND_TYPES.STRAIGHT_FLUSH,
            cards: hand('8C', '5C', '3C', '7C', '4C', '6C'),
            expected: ['3C', '4C', '5C', '6C', '7C'],
        },
    ];

    for (const { type, cards, expected } of cases) {
        const [lowest] = findEligibleHands(cards, null, type);
        assert.deepEqual(ids(lowest.cards), expected, type);
    }
});

test('quick select returns the lowest combination that beats the pile', () => {
    const cards = hand('5S', '4H', '3S', '5D', '4D', '3D', '4S', '3H', '6D', '6C');
    const lastPlayedHand = {
        type: HAND_TYPES.FULL_HOUSE,
        value: 3,
        cards: hand('3D', '3C', '3S', '6D', '6C'),
    };

    const [lowest] = findEligibleHands(cards, lastPlayedHand, HAND_TYPES.FULL_HOUSE);

    assert.deepEqual(ranks(lowest.cards), ['3', '3', '4', '4', '4']);
});

test('quick select puts playable responses first and retains lower previews', () => {
    const cards = hand('5D', '5C', '4D', '4C', '3D', '3C');
    const lastPlayedHand = {
        type: HAND_TYPES.PAIR,
        value: 1,
        cards: hand('3D', '3C'),
    };

    const options = findQuickSelectHands(cards, lastPlayedHand, HAND_TYPES.PAIR);

    assert.deepEqual(
        options.map(({ hand: option, canPlay }) => ({ cards: ids(option.cards), canPlay })),
        [
            { cards: ['4D', '4C'], canPlay: true },
            { cards: ['5D', '5C'], canPlay: true },
            { cards: ['3D', '3C'], canPlay: false },
        ]
    );
});

test('quick select marks every valid combination playable on a free lead', () => {
    const options = findQuickSelectHands(
        hand('4D', '4C', '3D', '3C'),
        null,
        HAND_TYPES.PAIR
    );

    assert.deepEqual(ids(options[0].hand.cards), ['3D', '3C']);
    assert.ok(options.every(option => option.canPlay));
});

test('quick select retains an unplayable hand type as a greyable preview', () => {
    const options = findQuickSelectHands(
        hand('4D', '4C', '4H', '3D', '3C', '3H'),
        { type: HAND_TYPES.PAIR, value: 1, cards: hand('3D', '3C') },
        HAND_TYPES.TRIPLE
    );

    assert.deepEqual(ids(options[0].hand.cards), ['3D', '3C', '3H']);
    assert.ok(options.every(option => !option.canPlay));
});
