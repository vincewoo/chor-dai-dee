const test = require('node:test');
const assert = require('node:assert');

const {
    PUBLIC_RANKS,
    PLACEMENT_RANK_CAP,
    PLACEMENT_REFERENCE_SIGMA,
    PLACEMENT_ENTRY_SCORES,
    MIN_PLACEMENT_MODE_GAMES,
    placementRankIndex,
    rankIndexForShadow,
    updatePublicRank,
    publicStatsView
} = require('../game/PublicRank');
const { DEFAULT_MU, DEFAULT_SIGMA } = require('../game/RatingSystem');
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

test('placement does not charge a player for their own uncertainty', () => {
    // The whole point of the placement ladder. Sigma at placement is whatever
    // 5-10 games happen to have left it at, and under the settled scoring the
    // difference between finishing calibration in 5 games and in 10 was worth
    // ~48 display points - about a third of a tier - on identical play.
    const mu = 26;
    const early = updatePublicRank(
        { rankPlacementComplete: false },
        { mu, sigma: 7.9, placement: 1, placementMatchesComplete: true });
    const late = updatePublicRank(
        { rankPlacementComplete: false },
        { mu, sigma: 7.5, placement: 1, placementMatchesComplete: true });

    assert.strictEqual(early.publicRank, late.publicRank);
    assert.strictEqual(early.publicRank, placementRankIndex(mu));

    // And it is strictly kinder than the settled ladder in that window, which
    // is the bug it was written for: a player with this mu after five games
    // used to place at the very bottom.
    assert.ok(placementRankIndex(mu) > rankIndexForShadow(mu, 7.9));
    assert.strictEqual(rankIndexForShadow(mu, 7.9), 0);
    // The same mu, the same play, one extra calibration game's worth of sigma
    // decay - and under the settled ladder that alone crossed a tier.
    assert.notStrictEqual(
        rankIndexForShadow(mu, 7.9), rankIndexForShadow(mu, 7.5));
});

test('the placement ladder is monotonic in mu and capped', () => {
    let previous = -1;
    for (let mu = 0; mu <= 60; mu += 0.25) {
        const index = placementRankIndex(mu);
        assert.ok(index >= previous, `placement fell at mu ${mu}`);
        assert.ok(index <= PLACEMENT_RANK_CAP);
        previous = index;
    }
    // A brand-new player is at the floor, so placement can only be earned.
    assert.strictEqual(placementRankIndex(DEFAULT_MU - 3 * DEFAULT_SIGMA), 0);
    // The fitted entries stay inside the ladder they are read against.
    assert.strictEqual(PLACEMENT_ENTRY_SCORES.length, PLACEMENT_RANK_CAP + 1);
    for (let index = 2; index < PLACEMENT_ENTRY_SCORES.length; index++) {
        assert.ok(PLACEMENT_ENTRY_SCORES[index] >
            PLACEMENT_ENTRY_SCORES[index - 1]);
    }
    assert.ok(PLACEMENT_REFERENCE_SIGMA < DEFAULT_SIGMA);
});

test('placement waits for evidence in the mode being placed', () => {
    // Calibration is one row per player; a rank is per mode. Completing it in
    // Short must not place anybody in Standard off a single Standard game.
    const args = {
        mu: 34,
        sigma: DEFAULT_SIGMA,
        placement: 1,
        placementMatchesComplete: true
    };
    const firstGame = updatePublicRank(
        { rankPlacementComplete: false },
        { ...args, modeGamesPlayed: 1 });
    assert.strictEqual(firstGame.rankPlacementComplete, false);
    assert.strictEqual(firstGame.rank.label, 'Unranked');
    assert.strictEqual(firstGame.change, null);

    const gatingGame = updatePublicRank(
        firstGame,
        { ...args, modeGamesPlayed: MIN_PLACEMENT_MODE_GAMES });
    assert.strictEqual(gatingGame.rankPlacementComplete, true);
    assert.strictEqual(gatingGame.change, 'placed');
    assert.strictEqual(gatingGame.publicRank, placementRankIndex(args.mu));

    // Omitting the count leaves the gate out of it, so a caller that does not
    // track per-mode games behaves exactly as it did before.
    const ungated = updatePublicRank(
        { rankPlacementComplete: false }, args);
    assert.strictEqual(ungated.rankPlacementComplete, true);
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
