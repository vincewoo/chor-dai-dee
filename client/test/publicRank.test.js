import test from 'node:test';
import assert from 'node:assert/strict';

import {
    publicRankColor,
    publicRankLabel
} from '../src/constants/publicRank.js';

test('public rank helpers accept API objects and room labels', () => {
    assert.equal(
        publicRankLabel({ id: 'gold', label: 'Gold' }), 'Gold');
    assert.equal(publicRankLabel('Silver'), 'Silver');
    assert.equal(publicRankLabel(null), 'Unranked');
    assert.equal(
        publicRankColor({ id: 'champ', label: 'Champ' }),
        '#d6a8ff');
});
