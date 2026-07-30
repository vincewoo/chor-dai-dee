const test = require('node:test');
const assert = require('node:assert');

const {
    updatePublicRank,
    publicStatsView
} = require('../game/PublicRank');
const {
    botMuForTemperature,
    botRatingForDifficulty
} = require('../game/RatingSystem');

test('public rank changes only after three qualifying results', () => {
    let state = {
        publicRank: 0,
        promotionProgress: 0,
        demotionProgress: 0
    };

    for (let game = 0; game < 2; game++) {
        state = updatePublicRank(state, {
            mu: 28,
            sigma: 25 / 3,
            placement: 2
        });
        assert.strictEqual(state.rank.label, 'Bronze');
    }

    state = updatePublicRank(state, {
        mu: 28,
        sigma: 25 / 3,
        placement: 1
    });
    assert.strictEqual(state.rank.label, 'Silver');
    assert.strictEqual(state.change, 'promoted');
});

test('demotion has both a rating buffer and a three-result confirmation', () => {
    let state = {
        publicRank: 1,
        promotionProgress: 0,
        demotionProgress: 0
    };

    for (let game = 0; game < 2; game++) {
        state = updatePublicRank(state, {
            mu: 25,
            sigma: 25 / 3,
            placement: 3
        });
        assert.strictEqual(state.rank.label, 'Silver');
    }

    state = updatePublicRank(state, {
        mu: 25,
        sigma: 25 / 3,
        placement: 4
    });
    assert.strictEqual(state.rank.label, 'Bronze');
    assert.strictEqual(state.change, 'demoted');
});

test('the public stats view removes every shadow-rating field', () => {
    const visible = publicStatsView({
        username: 'Alice',
        wins: 4,
        rating_mu: 31,
        rating_sigma: 4,
        public_rank: 2,
        promotion_progress: 2,
        demotion_progress: 1
    });

    assert.deepStrictEqual(visible, {
        username: 'Alice',
        wins: 4,
        public_rank: { id: 'gold', label: 'Gold' }
    });
});

test('Adaptive opponent rating follows its frozen temperature', () => {
    assert.ok(botMuForTemperature(3) > botMuForTemperature(8));
    assert.ok(botMuForTemperature(8) > botMuForTemperature(12));
    assert.strictEqual(
        botRatingForDifficulty('adaptive', 8).mu,
        botRatingForDifficulty('casual').mu
    );
});
