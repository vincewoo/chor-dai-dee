const test = require('node:test');
const assert = require('node:assert');

const {
    PUBLIC_RANKS,
    PLACEMENT_RANK_CAP,
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
        assert.strictEqual(state.rank.label, 'Iron');
    }

    state = updatePublicRank(state, {
        mu: 28,
        sigma: 25 / 3,
        placement: 1
    });
    assert.strictEqual(state.rank.label, 'Bronze');
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
        assert.strictEqual(state.rank.label, 'Bronze');
    }

    state = updatePublicRank(state, {
        mu: 25,
        sigma: 25 / 3,
        placement: 4
    });
    assert.strictEqual(state.rank.label, 'Iron');
    assert.strictEqual(state.change, 'demoted');
});

test('the seven-tier ladder has Gold in the middle and Champ at the top', () => {
    assert.deepStrictEqual(
        PUBLIC_RANKS.map(rank => rank.label),
        [
            'Iron',
            'Bronze',
            'Silver',
            'Gold',
            'Platinum',
            'Diamond',
            'Champ'
        ]
    );
    assert.strictEqual(PUBLIC_RANKS[PLACEMENT_RANK_CAP].label, 'Platinum');

    let state = {
        publicRank: 5,
        promotionProgress: 0,
        demotionProgress: 0
    };
    for (let game = 0; game < 3; game++) {
        state = updatePublicRank(state, {
            mu: 34,
            sigma: 4,
            placement: 1
        });
    }
    assert.strictEqual(state.publicRank, 6);
    assert.strictEqual(state.rank.label, 'Champ');
    assert.strictEqual(state.change, 'promoted');
});

test('placement stays Unranked and can place no higher than Platinum', () => {
    const unplaced = updatePublicRank({
        publicRank: 6,
        promotionProgress: 2,
        demotionProgress: 1,
        rankPlacementComplete: false
    }, {
        mu: 40,
        sigma: 4,
        placement: 1,
        placementMatchesComplete: false
    });

    assert.strictEqual(unplaced.publicRank, 0);
    assert.strictEqual(unplaced.rank.label, 'Unranked');
    assert.strictEqual(unplaced.rankPlacementComplete, false);
    assert.strictEqual(unplaced.promotionProgress, 0);

    const placed = updatePublicRank(unplaced, {
        mu: 40,
        sigma: 4,
        placement: 1,
        placementMatchesComplete: true
    });

    assert.strictEqual(placed.publicRank, PLACEMENT_RANK_CAP);
    assert.strictEqual(placed.rank.label, 'Platinum');
    assert.strictEqual(placed.rankPlacementComplete, true);
    assert.strictEqual(placed.change, 'placed');
});

test('every result reports the rank it moved away from', () => {
    // The promotion splash animates from previousRank to rank, so a wrong (or
    // missing) previousRank is a wrong animation, not a cosmetic detail.
    let state = {
        publicRank: 3,
        promotionProgress: 2,
        demotionProgress: 0
    };

    // A game that changes nothing still reports where the player stands.
    const held = updatePublicRank(state, {
        mu: 25,
        sigma: 25 / 3,
        placement: 3
    });
    assert.strictEqual(held.change, null);
    assert.strictEqual(held.previousRank.label, 'Gold');
    assert.strictEqual(held.rank.label, 'Gold');

    state = updatePublicRank(state, {
        mu: 32,
        sigma: 4,
        placement: 1
    });
    assert.strictEqual(state.change, 'promoted');
    assert.strictEqual(state.previousRank.label, 'Gold');
    assert.strictEqual(state.rank.label, 'Platinum');

    // Placing comes from Unranked, which is off the ladder entirely.
    const placed = updatePublicRank({
        publicRank: 0,
        promotionProgress: 0,
        demotionProgress: 0,
        rankPlacementComplete: false
    }, {
        mu: 30,
        sigma: 5,
        placement: 1,
        placementMatchesComplete: true
    });
    assert.strictEqual(placed.change, 'placed');
    assert.strictEqual(placed.previousRank.label, 'Unranked');

    // And a demotion reports the tier it fell out of.
    let falling = {
        publicRank: 2,
        promotionProgress: 0,
        demotionProgress: 2
    };
    falling = updatePublicRank(falling, {
        mu: 25,
        sigma: 25 / 3,
        placement: 4
    });
    assert.strictEqual(falling.change, 'demoted');
    assert.strictEqual(falling.previousRank.label, 'Silver');
    assert.strictEqual(falling.rank.label, 'Bronze');
});

test('the public stats view removes every shadow-rating field', () => {
    const visible = publicStatsView({
        username: 'Alice',
        wins: 4,
        rating_mu: 31,
        rating_sigma: 4,
        public_rank: 2,
        promotion_progress: 2,
        demotion_progress: 1,
        rank_placement_complete: 1
    });

    assert.deepStrictEqual(visible, {
        username: 'Alice',
        wins: 4,
        public_rank: { id: 'silver', label: 'Silver' }
    });
});

test('the public stats view hides unfinished placement behind Unranked', () => {
    const visible = publicStatsView({
        username: 'Bob',
        public_rank: 0,
        rank_placement_complete: 0
    });

    assert.deepStrictEqual(visible, {
        username: 'Bob',
        public_rank: { id: 'unranked', label: 'Unranked' }
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
