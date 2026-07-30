import test from 'node:test';
import assert from 'node:assert/strict';

import { AVATAR_NAMES, PICKER_ANIMALS } from '../src/utils/avatars.js';

test('every picker animal has one unique display name', () => {
    const names = PICKER_ANIMALS.map((animal) => AVATAR_NAMES[animal]);

    assert.ok(names.every((name) => typeof name === 'string' && name.length > 0));
    assert.equal(new Set(names).size, PICKER_ANIMALS.length);
    assert.deepEqual(Object.keys(AVATAR_NAMES), PICKER_ANIMALS);
});
