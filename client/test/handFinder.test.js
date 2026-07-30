import test from 'node:test';
import assert from 'node:assert/strict';

import {
    findAvailableHandTypes,
    findEligibleHands,
    findQuickSelectHands,
    HAND_TYPES,
} from '../src/utils/handFinder.js';

const card = (notation) => ({
    rank: notation.slice(0, -1),
    suit: notation.slice(-1),
});

const hand = (...notations) => notations.map(card);
const ids = (cards) => cards.map(({ rank, suit }) => `${rank}${suit}`);
const ranks = (cards) => cards.map(({ rank }) => rank);

test('full house uses the lowest triple and lowest intact pair', () => {
    const cards = hand('5S', '4H', '3S', '5D', '4D', '3D', '4S', '3H');

    const [lowest] = findEligibleHands(cards, null, HAND_TYPES.FULL_HOUSE);

    assert.deepEqual(ranks(lowest.cards), ['3', '3', '3', '5', '5']);
});

test('full house pair does not break another triple when an intact pair is available', () => {
    const cards = hand('3D', '3C', '3H', '5D', '5C', '6D', '6C', '6H');
    const lastPlayedHand = {
        type: HAND_TYPES.FULL_HOUSE,
        value: 11,
        cards: hand('5D', '5C', '5H', '4D', '4C'),
    };

    const [lowest] = findEligibleHands(cards, lastPlayedHand, HAND_TYPES.FULL_HOUSE);

    assert.deepEqual(ids(lowest.cards), ['5D', '5C', '6D', '6C', '6H']);
});

test('full house cycles intact-pair options before borrowed-pair options', () => {
    const options = findQuickSelectHands(
        hand('3D', '3C', '3H', '4D', '4C', '4H', '5D', '5C'),
        null,
        HAND_TYPES.FULL_HOUSE
    );

    const usesIntactPair = options.map(({ hand: option }) =>
        option.cards.filter(({ rank }) => rank === '5').length === 2
    );

    assert.deepEqual(usesIntactPair, [
        true, true,
        false, false, false, false, false, false,
    ]);
});

test('full house borrows a low pair before spending a pair of aces', () => {
    const options = findQuickSelectHands(
        hand('3D', '3C', '3H', '4D', '4C', '4H', 'AD', 'AC'),
        null,
        HAND_TYPES.FULL_HOUSE
    );

    const usesAces = options.map(({ hand: option }) =>
        option.cards.filter(({ rank }) => rank === 'A').length === 2
    );

    assert.deepEqual(usesAces, [
        false, false, false, false, false, false,
        true, true,
    ]);
});

test('quad kicker uses the lowest singleton before breaking a set', () => {
    const cards = hand('3D', '3C', '5H', '6D', '6C', '6H', '6S');

    const [lowest] = findEligibleHands(cards, null, HAND_TYPES.QUADS);

    assert.deepEqual(ids(lowest.cards), ['5H', '6D', '6C', '6H', '6S']);
});

test('quad cycles singleton kickers before kickers borrowed from a set', () => {
    const options = findQuickSelectHands(
        hand('3D', '3C', '5H', '6D', '6C', '6H', '6S'),
        null,
        HAND_TYPES.QUADS
    );

    assert.deepEqual(
        options.map(({ hand: option }) =>
            ids(option.cards).find(id => !id.startsWith('6'))
        ),
        ['5H', '3D', '3C']
    );
});

test('quad borrows a low kicker before spending a loose two', () => {
    const options = findQuickSelectHands(
        hand('3D', '3C', '6D', '6C', '6H', '6S', '2S'),
        null,
        HAND_TYPES.QUADS
    );

    assert.deepEqual(
        options.map(({ hand: option }) =>
            ids(option.cards).find(id => !id.startsWith('6'))
        ),
        ['3D', '3C', '2S']
    );
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

    assert.deepEqual(ranks(lowest.cards), ['4', '4', '4', '5', '5']);
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

test('opening quick select only marks combinations containing 3D playable', () => {
    const options = findQuickSelectHands(
        hand('3D', '3C', '4D', '4C'),
        null,
        HAND_TYPES.PAIR,
        card('3D')
    );

    assert.deepEqual(
        options.map(({ hand: option, canPlay }) => ({ cards: ids(option.cards), canPlay })),
        [
            { cards: ['3D', '3C'], canPlay: true },
            { cards: ['4D', '4C'], canPlay: false },
        ]
    );
});

test('opening hand helpers only light types with a combination containing 3D', () => {
    const cards = hand('3D', '4D', '4C', '5H', '6S', '7D');

    assert.deepEqual(
        findAvailableHandTypes(cards, null, card('3D')).map(({ type }) => type),
        [HAND_TYPES.SINGLE, HAND_TYPES.STRAIGHT]
    );
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
