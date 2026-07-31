import test from 'node:test';
import assert from 'node:assert/strict';

import { MOBILE_LAYOUT, MOBILE_COMPACT_LAYOUT } from '../src/components/tableV2/layout.js';

// The compact tier is safe only while it stays shape-compatible with the
// mainline mobile tier: GameTableMobile reads the same keys from whichever
// tier is active, and a missing key becomes a silent undefined placement.
// These tests pin the parity so a third tier or a non-spread edit can't
// regress the short-viewport path unnoticed.

test('compact tier exposes exactly the mainline keys', () => {
    assert.deepEqual(
        Object.keys(MOBILE_COMPACT_LAYOUT).sort(),
        Object.keys(MOBILE_LAYOUT).sort()
    );
});

test('seats blocks have the same shape per position', () => {
    assert.deepEqual(
        Object.keys(MOBILE_COMPACT_LAYOUT.seats).sort(),
        Object.keys(MOBILE_LAYOUT.seats).sort()
    );
    for (const pos of ['top', 'left', 'right']) {
        assert.ok(MOBILE_COMPACT_LAYOUT.seats[pos], `seats.${pos} present`);
    }
});

test('pile frames are anchored the same way', () => {
    assert.deepEqual(
        Object.keys(MOBILE_COMPACT_LAYOUT.pile.frame).sort(),
        Object.keys(MOBILE_LAYOUT.pile.frame).sort()
    );
    // Both tiers must be top+bottom anchored — a fixed height is what let the
    // pile extend under the controls on short viewports.
    for (const tier of [MOBILE_LAYOUT, MOBILE_COMPACT_LAYOUT]) {
        assert.equal(typeof tier.pile.frame.top, 'number');
        assert.equal(typeof tier.pile.frame.bottom, 'number');
        assert.equal(tier.pile.frame.height, undefined);
    }
});

test('banner and hand geometry are inherited, not forked', () => {
    assert.equal(MOBILE_COMPACT_LAYOUT.banner, MOBILE_LAYOUT.banner);
    assert.equal(MOBILE_COMPACT_LAYOUT.hand, MOBILE_LAYOUT.hand);
});

test('the banner renders in normal flow on mobile', () => {
    // GameTableMobile places StatusBanner inside the bottom stack; a non-null
    // placement here would reintroduce the absolute offset that collided
    // with the pile.
    assert.equal(MOBILE_LAYOUT.banner, null);
});

// Geometry, not just shape. The offsets are hand-tuned literals, and shape
// parity alone cannot catch a retune that puts two elements back on top of one
// another — which is how the pile well ended up too short for its own contents.

// Rendered height of a seat cluster at size 'sm' (avatar tile + card-count
// row). Measured from the running table; a lower bound, so the assertions
// stay true if the seat grows slightly.
const SEAT_HEIGHT_SM = 48;

for (const [name, tier] of [['mainline', MOBILE_LAYOUT], ['compact', MOBILE_COMPACT_LAYOUT]]) {
    test(`${name} tier: side seats clear the top seat`, () => {
        assert.ok(
            tier.seats.left.top >= tier.seats.top.top + SEAT_HEIGHT_SM,
            `left seat (${tier.seats.left.top}) must start below the top seat ` +
            `(${tier.seats.top.top} + ${SEAT_HEIGHT_SM})`
        );
        assert.equal(tier.seats.left.top, tier.seats.right.top, 'side seats are level');
    });

    test(`${name} tier: the pile well clears the side seats`, () => {
        assert.ok(
            tier.pile.frame.top >= tier.seats.left.top + SEAT_HEIGHT_SM,
            `pile top (${tier.pile.frame.top}) must clear the side seats ` +
            `(${tier.seats.left.top} + ${SEAT_HEIGHT_SM})`
        );
    });

    test(`${name} tier: the well fits the card stack at its minimum height`, () => {
        // The fan's older plays drift up to 20px upward (CenterPile's OFF), so
        // the shortest the well may be is the stack plus that drift. When this
        // failed, the cards overflowed the well and slid under the pile label.
        const MAX_FAN_DRIFT = 20;
        const required = tier.pile.stackHeight + Math.round(MAX_FAN_DRIFT * tier.pile.scale);
        assert.ok(
            tier.pile.frame.minHeight >= required,
            `minHeight ${tier.pile.frame.minHeight} must fit stackHeight ` +
            `${tier.pile.stackHeight} + fan drift (needs ${required})`
        );
    });

    test(`${name} tier: the well's max height is not below its min`, () => {
        assert.ok(tier.pile.frame.maxHeight >= tier.pile.frame.minHeight);
    });
}
