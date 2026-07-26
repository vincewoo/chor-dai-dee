import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSOY_DISPLAY_SUIT, displaySuit, lensServerMessage } from '../src/utils/suitLens.js';

// The two total orders the lens aligns, both ascending.
const UNDERLYING = ['D', 'C', 'H', 'S'];
const PUSOY = ['C', 'S', 'H', 'D'];

test('lens off is the identity', () => {
    for (const suit of UNDERLYING) {
        assert.equal(displaySuit(suit, false), suit);
        assert.equal(displaySuit(suit, undefined), suit);
    }
});

test('the mapping is a bijection over the four suits', () => {
    assert.deepEqual(Object.values(PUSOY_DISPLAY_SUIT).sort(), ['C', 'D', 'H', 'S']);
});

test('the mapping preserves order', () => {
    // Position i in the underlying order must land on position i in the Pusoy
    // order — that is what keeps every comparison and flush check correct.
    UNDERLYING.forEach((suit, i) => {
        assert.equal(PUSOY.indexOf(displaySuit(suit, true)), i);
    });
});

test('each suit maps to its Pusoy Dos counterpart', () => {
    assert.equal(displaySuit('D', true), 'C');
    assert.equal(displaySuit('C', true), 'S');
    assert.equal(displaySuit('H', true), 'H');
    assert.equal(displaySuit('S', true), 'D');
});

test('an unknown suit passes through unchanged', () => {
    assert.equal(displaySuit('X', true), 'X');
    assert.equal(displaySuit(undefined, true), undefined);
});

test('the first-turn error is reworded only under the lens', () => {
    const raw = 'Must play 3 of Diamonds on first turn';
    assert.equal(lensServerMessage(raw, true), 'Must play 3 of Clubs on first turn');
    assert.equal(lensServerMessage(raw, false), raw);
});

test('unknown server messages are returned verbatim', () => {
    const msg = 'Room not found';
    assert.equal(lensServerMessage(msg, true), msg);
    assert.equal(lensServerMessage(msg, false), msg);
});
