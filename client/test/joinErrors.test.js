import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowJoinError } from '../src/utils/joinErrors.js';

test('a probe miss ("Room not found" with no join in flight) is suppressed', () => {
    assert.equal(shouldShowJoinError('Room not found', false), false);
});

test('"Room not found" during a user-initiated join is shown', () => {
    assert.equal(shouldShowJoinError('Room not found', true), true);
});

test('every other error is shown regardless of join state', () => {
    assert.equal(shouldShowJoinError('Room is full', false), true);
    assert.equal(shouldShowJoinError('Room is full', true), true);
    assert.equal(shouldShowJoinError('Username already taken', false), true);
});

test('truthy non-boolean in-flight values behave like booleans', () => {
    // The caller passes a ref's current value; make sure loose values can't
    // flip the decision.
    assert.equal(shouldShowJoinError('Room not found', undefined), false);
    assert.equal(shouldShowJoinError('Room not found', null), false);
    assert.equal(shouldShowJoinError('Room not found', 1), true);
});
