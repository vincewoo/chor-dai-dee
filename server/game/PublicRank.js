// Coarse player-facing ranks backed by the existing continuous OpenSkill
// estimate. `rating_mu` and `rating_sigma` remain server-only shadow values;
// this module is the only translation into something a player sees.

const { calculateDisplayRating } = require('./RatingSystem');
const { MIN_PLACEMENT_GAMES } = require('./AdaptiveBotController');

const PROMOTION_RESULTS = 3;
const DEMOTION_RESULTS = 3;
const DEMOTION_BUFFER = 75;
const PLACEMENT_RANK_CAP = 4;
const UNRANKED_PUBLIC_RANK = { id: 'unranked', label: 'Unranked' };

// A rank is per game mode, because the shadow rating is. Adaptive calibration
// is not - it is one row per player - so calibration completing in Short used
// to place the player in Standard as well, off whatever their untouched
// Standard row said. That row is one game old at most, and one game vs the
// cold-start bots tops out at 1296 against a 1300 Bronze line: every player's
// second mode was a guaranteed Iron. Placement therefore needs its own
// per-mode evidence, and the controller's floor is the natural amount.
const MIN_PLACEMENT_MODE_GAMES = MIN_PLACEMENT_GAMES;

// Entry scores are expressed in the old continuous display scale only because
// that gives us stable migration thresholds. The score itself is never sent to
// a client. A promotion series makes the visible rank intentionally lag it.
const PUBLIC_RANKS = [
    { id: 'iron', label: 'Iron', entryScore: -Infinity },
    { id: 'bronze', label: 'Bronze', entryScore: 1300 },
    { id: 'silver', label: 'Silver', entryScore: 1450 },
    { id: 'gold', label: 'Gold', entryScore: 1600 },
    { id: 'platinum', label: 'Platinum', entryScore: 1750 },
    { id: 'diamond', label: 'Diamond', entryScore: 1900 },
    { id: 'champ', label: 'Champ', entryScore: 2050 }
];
const DEFAULT_PUBLIC_RANK_LABEL = UNRANKED_PUBLIC_RANK.label;

// Placement is scored on its own ladder, and has to be: PUBLIC_RANKS' entry
// scores are fitted to the settled regime, where sigma has decayed to ~4 after
// 50-100 games. Placement fires after 5-10 (AdaptiveBotController), with sigma
// still at 7.5-7.9, and `mu - 3 * sigma` charges the difference as a flat
// ~420-point tax - three whole tiers - on nothing but being new. Measured, that
// put a player winning 55% of their games (more than double the 25% a seat wins
// by chance) in Iron half the time, and made Platinum unreachable despite
// PLACEMENT_RANK_CAP naming it.
//
// So the placement snapshot evaluates mu at the sigma a settled player
// converges to, against thresholds fitted to what mu actually looks like at
// that point. Using a fixed sigma rather than the player's own also stops the
// tier depending on whether calibration happened to take 5 games or 10 - a
// 48-point swing that says nothing about how they played.
//
// After placement, nothing here applies: the promotion and demotion series run
// on the real conservative `mu - 3 * sigma` against PUBLIC_RANKS, so an
// optimistic placement is corrected by results rather than left standing.
const PLACEMENT_REFERENCE_SIGMA = 4;

// Index-aligned with PUBLIC_RANKS. Fitted from 3000 simulated placement runs
// per skill cohort with the Adaptive controller in the loop, so the bots each
// cohort faces track their measured skill the way they do live. Targets: the
// median chance-level player lands on the Iron/Bronze line, the median
// 45%-win player on Bronze/Silver, 70% on Gold, 85% on Platinum. Diamond and
// Champ are absent because PLACEMENT_RANK_CAP reserves them for promotion.
// Re-fit these together with PLACEMENT_REFERENCE_SIGMA, never one alone.
const PLACEMENT_ENTRY_SCORES = [-Infinity, 1450, 1620, 1800, 1990];

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

/**
 * The tier a player is placed into at the end of calibration. Reads mu only -
 * see PLACEMENT_ENTRY_SCORES for why the player's own sigma is deliberately
 * not consulted here - and never returns above PLACEMENT_RANK_CAP.
 *
 * @param {number} mu - shadow skill mean
 * @returns {number} rank index
 */
function placementRankIndex(mu) {
    const score = calculateDisplayRating(mu, PLACEMENT_REFERENCE_SIGMA);
    let result = 0;
    for (let index = 1; index < PLACEMENT_ENTRY_SCORES.length; index++) {
        if (score < PLACEMENT_ENTRY_SCORES[index]) break;
        result = index;
    }
    return Math.min(result, PLACEMENT_RANK_CAP);
}

function updatePublicRank(current = {}, {
    mu,
    sigma,
    placement,
    placementMatchesComplete = true,
    // Completed games in *this* mode, counting the one being recorded. Absent
    // (an older caller, or a test that only cares about the promotion series)
    // means the mode gate is not consulted.
    modeGamesPlayed = null
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
    const storedPlacementState =
        current.rankPlacementComplete ?? current.rank_placement_complete;
    let rankPlacementComplete = storedPlacementState === undefined
        ? true
        : Boolean(storedPlacementState);

    // Public rank stays Unranked during placement matches. Once calibration
    // completes, place from the placement ladder but never above Platinum:
    // Diamond and Champ remain available to earn through play.
    // What the player saw before this update. The promotion splash animates
    // from it, so it has to be captured before rankIndex moves.
    const previousRank = rankPlacementComplete
        ? rankForIndex(rankIndex)
        : { ...UNRANKED_PUBLIC_RANK };
    const modeEvidenceComplete = modeGamesPlayed === null ||
        Number(modeGamesPlayed) >= MIN_PLACEMENT_MODE_GAMES;

    if (!rankPlacementComplete) {
        if (!placementMatchesComplete || !modeEvidenceComplete) {
            return {
                publicRank: 0,
                promotionProgress: 0,
                demotionProgress: 0,
                rankPlacementComplete: false,
                change: null,
                previousRank,
                rank: { ...UNRANKED_PUBLIC_RANK }
            };
        }

        rankIndex = placementRankIndex(mu);
        rankPlacementComplete = true;
        return {
            publicRank: rankIndex,
            promotionProgress: 0,
            demotionProgress: 0,
            rankPlacementComplete,
            change: 'placed',
            previousRank,
            rank: rankForIndex(rankIndex)
        };
    }

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
        rankPlacementComplete,
        change,
        previousRank,
        rank: rankForIndex(rankIndex)
    };
}

function publicRankPayload(index, placementComplete = true) {
    if (!placementComplete) return { ...UNRANKED_PUBLIC_RANK };
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
        rank_placement_complete: rankPlacementComplete,
        public_rank: publicRank,
        ...visible
    } = row;
    return {
        ...visible,
        public_rank: publicRankPayload(
            publicRank,
            rankPlacementComplete === undefined
                ? true
                : Boolean(rankPlacementComplete)
        )
    };
}

module.exports = {
    PUBLIC_RANKS,
    DEFAULT_PUBLIC_RANK_LABEL,
    PROMOTION_RESULTS,
    DEMOTION_RESULTS,
    DEMOTION_BUFFER,
    PLACEMENT_RANK_CAP,
    PLACEMENT_REFERENCE_SIGMA,
    PLACEMENT_ENTRY_SCORES,
    MIN_PLACEMENT_MODE_GAMES,
    rankForIndex,
    rankIndexForShadow,
    placementRankIndex,
    updatePublicRank,
    publicRankPayload,
    publicStatsView
};
