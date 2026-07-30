// Coarse player-facing ranks backed by the existing continuous OpenSkill
// estimate. `rating_mu` and `rating_sigma` remain server-only shadow values;
// this module is the only translation into something a player sees.

const { calculateDisplayRating } = require('./RatingSystem');

const PROMOTION_RESULTS = 3;
const DEMOTION_RESULTS = 3;
const DEMOTION_BUFFER = 75;

// Entry scores are expressed in the old continuous display scale only because
// that gives us stable migration thresholds. The score itself is never sent to
// a client. A promotion series makes the visible rank intentionally lag it.
const PUBLIC_RANKS = [
    { id: 'bronze', label: 'Bronze', entryScore: -Infinity },
    { id: 'silver', label: 'Silver', entryScore: 1300 },
    { id: 'gold', label: 'Gold', entryScore: 1450 },
    { id: 'platinum', label: 'Platinum', entryScore: 1600 }
];

const clampIndex = value => Math.max(
    0,
    Math.min(
        PUBLIC_RANKS.length - 1,
        Number.isInteger(Number(value)) ? Math.trunc(Number(value)) : 0
    )
);

function rankForIndex(index) {
    return PUBLIC_RANKS[clampIndex(index)];
}

function rankIndexForShadow(mu, sigma) {
    const score = calculateDisplayRating(mu, sigma);
    let result = 0;
    for (let index = 1; index < PUBLIC_RANKS.length; index++) {
        if (score < PUBLIC_RANKS[index].entryScore) break;
        result = index;
    }
    return result;
}

function updatePublicRank(current = {}, {
    mu,
    sigma,
    placement
} = {}) {
    let rankIndex = clampIndex(
        current.publicRank ?? current.public_rank);
    let promotionProgress = Math.max(0, Math.trunc(Number(
        current.promotionProgress ?? current.promotion_progress) || 0));
    let demotionProgress = Math.max(0, Math.trunc(Number(
        current.demotionProgress ?? current.demotion_progress) || 0));
    const score = calculateDisplayRating(mu, sigma);
    const validPlacement = Number.isInteger(Number(placement)) &&
        Number(placement) >= 1 && Number(placement) <= 4
        ? Number(placement)
        : null;

    let change = null;
    const nextRank = PUBLIC_RANKS[rankIndex + 1];
    if (nextRank && score >= nextRank.entryScore) {
        demotionProgress = 0;
        if (validPlacement !== null) {
            promotionProgress = validPlacement <= 2
                ? promotionProgress + 1
                : Math.max(0, promotionProgress - 1);
        }
        if (promotionProgress >= PROMOTION_RESULTS) {
            rankIndex++;
            promotionProgress = 0;
            demotionProgress = 0;
            change = 'promoted';
        }
    } else {
        promotionProgress = 0;
        const currentRank = PUBLIC_RANKS[rankIndex];
        const belowDemotionLine = rankIndex > 0 &&
            score < currentRank.entryScore - DEMOTION_BUFFER;
        if (belowDemotionLine && validPlacement !== null) {
            demotionProgress = validPlacement >= 3
                ? demotionProgress + 1
                : Math.max(0, demotionProgress - 1);
            if (demotionProgress >= DEMOTION_RESULTS) {
                rankIndex--;
                promotionProgress = 0;
                demotionProgress = 0;
                change = 'demoted';
            }
        } else {
            demotionProgress = 0;
        }
    }

    return {
        publicRank: rankIndex,
        promotionProgress,
        demotionProgress,
        change,
        rank: rankForIndex(rankIndex)
    };
}

function publicRankPayload(index) {
    const rank = rankForIndex(index);
    return { id: rank.id, label: rank.label };
}

function publicStatsView(row) {
    if (!row) return row;
    const {
        rating_mu: _mu,
        rating_sigma: _sigma,
        promotion_progress: _promotion,
        demotion_progress: _demotion,
        public_rank: publicRank,
        ...visible
    } = row;
    return {
        ...visible,
        public_rank: publicRankPayload(publicRank)
    };
}

module.exports = {
    PUBLIC_RANKS,
    PROMOTION_RESULTS,
    DEMOTION_RESULTS,
    DEMOTION_BUFFER,
    rankForIndex,
    rankIndexForShadow,
    updatePublicRank,
    publicRankPayload,
    publicStatsView
};
