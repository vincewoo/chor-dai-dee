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
