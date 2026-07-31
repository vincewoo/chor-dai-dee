import test from 'node:test';
import assert from 'node:assert/strict';

import { timeAgo } from '../src/utils/timeAgo.js';

// Fixed "now" so every case is deterministic.
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const secondsAgo = (s) => new Date(NOW - s * 1000).toISOString();

test('null and invalid inputs return null', () => {
    assert.equal(timeAgo(null, NOW), null);
    assert.equal(timeAgo(undefined, NOW), null);
    assert.equal(timeAgo('', NOW), null);
    assert.equal(timeAgo('not-a-date', NOW), null);
});

test('future timestamps clamp to "just now" rather than going negative', () => {
    assert.equal(timeAgo(secondsAgo(-120), NOW), 'just now');
});

test('unit boundaries roll at exactly the right second', () => {
    assert.equal(timeAgo(secondsAgo(0), NOW), 'just now');
    assert.equal(timeAgo(secondsAgo(59), NOW), 'just now');
    assert.equal(timeAgo(secondsAgo(60), NOW), '1m ago');
    assert.equal(timeAgo(secondsAgo(59 * 60 + 59), NOW), '59m ago');
    assert.equal(timeAgo(secondsAgo(60 * 60), NOW), '1h ago');
    assert.equal(timeAgo(secondsAgo(24 * 3600 - 1), NOW), '23h ago');
    assert.equal(timeAgo(secondsAgo(24 * 3600), NOW), '1d ago');
    assert.equal(timeAgo(secondsAgo(7 * 86400 - 1), NOW), '6d ago');
    assert.equal(timeAgo(secondsAgo(7 * 86400), NOW), '1w ago');
    assert.equal(timeAgo(secondsAgo(30 * 86400 - 1), NOW), '4w ago');
    assert.equal(timeAgo(secondsAgo(30 * 86400), NOW), '1mo ago');
    assert.equal(timeAgo(secondsAgo(365 * 86400 - 1), NOW), '12mo ago');
    assert.equal(timeAgo(secondsAgo(365 * 86400), NOW), '1y ago');
});

test('large hour counts roll up instead of accumulating (the 5042h bug)', () => {
    // ~7 months of hours must never render as "5042h ago".
    const out = timeAgo(secondsAgo(5042 * 3600), NOW);
    assert.equal(out, '7mo ago');
});
