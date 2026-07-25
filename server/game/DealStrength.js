// server/game/DealStrength.js
//
// Scores a freshly dealt 13-card hand, before a single card is played.
//
// The point is to separate luck from skill in the stats: if we know how good
// the cards were, we can subtract the expected result and leave the part the
// player is responsible for. See docs/HAND-STRENGTH-STATS.md for the
// measurements behind every constant in this file.
//
// Deliberately NOT merged with DecisionAnalyzer.calculateHandStrength. That one
// scores a *partial* hand mid-round to judge one decision, and subtracts a
// penalty proportional to hand size - which entangles it with round progress,
// exactly the property a deal score must not have. The two answer different
// questions and share no code.

const { RANKS } = require('./Deck');

/**
 * Baseline generation. Bump when the formula, the tier cutoffs, or the
 * baseline table below change, so rows recorded under an old baseline stay
 * interpretable instead of being silently re-interpreted under a new one.
 *
 * Changelog:
 *   1 - initial: 2*control - playsNeeded, five tiers, bot self-play baseline
 */
const BASELINE_VERSION = 1;

/**
 * Tier cutoffs on the raw score, and the outcome baseline for each tier.
 *
 * `winRate` and `avgPoints` come from 12,000 rounds of bot self-play
 * (48,000 player-rounds) via test/dealStrength.bench.js. They describe what a
 * competent player gets from a deal of this quality; a human table will differ
 * somewhat, which is why rows store the raw score and the baseline version so
 * this table can be recalibrated from real rounds later without a backfill.
 *
 * `share` is the fraction of random deals landing in the tier, from 200k deals.
 */
const TIERS = [
    { key: 'rough',   label: 'Rough',         min: -Infinity, winRate: 0.096, avgPoints: 4.83, share: 0.185 },
    { key: 'weak',    label: 'Below average', min: -3,        winRate: 0.172, avgPoints: 3.53, share: 0.289 },
    { key: 'average', label: 'Average',       min: 0,         winRate: 0.246, avgPoints: 2.85, share: 0.180 },
    { key: 'strong',  label: 'Strong',        min: 2,         winRate: 0.340, avgPoints: 2.22, share: 0.207 },
    { key: 'premium', label: 'Premium',       min: 5,         winRate: 0.484, avgPoints: 1.50, share: 0.140 }
];

/**
 * Standard deviation of a single round's outcome *after* removing the deal
 * expectation, measured over the same 48,000 player-rounds. This is the noise
 * floor Edge has to clear, and it is large: +/-10pp on win rate needs ~67
 * rounds, +/-5pp needs ~265, +/-3pp needs ~735.
 */
const RESIDUAL_SD_WIN = 0.415;
const RESIDUAL_SD_POINTS = 4.25;

/**
 * Below this many rounds, Edge is noise and should not be shown as a skill
 * verdict - only the descriptive stats (deal luck, steals) are meaningful.
 * Corresponds to a 95% interval of roughly +/-10pp.
 */
const MIN_ROUNDS_FOR_EDGE = 50;

/**
 * Raw-score quantiles over 200,000 random deals, as 99 breakpoints: index i
 * holds the (i+1)th percentile. Used only to turn a raw score into the
 * friendlier "stronger than N% of deals" figure for display.
 *
 * The raw score is integer-valued and coarse (it spans -9..19), so many
 * adjacent percentiles share a value. That is inherent to the metric, and is
 * why tiers - not deciles - are the unit everything else aggregates on.
 */
const PERCENTILE_BREAKPOINTS = [
    -7, -7, -6, -6, -6, -6, -5, -5, -5, -5, -5, -4, -4, -4, -4, -4, -4, -4, -3, -3,
    -3, -3, -3, -3, -3, -3, -3, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  1,  1,  1,
     1,  1,  1,  1,  1,  2,  2,  2,  2,  2,  2,  2,  2,  3,  3,  3,  3,  3,  3,  3,
     4,  4,  4,  4,  4,  4,  5,  5,  5,  5,  6,  6,  6,  7,  7,  8,  8,  9, 11
];

/**
 * Minimum number of plays needed to shed a hand, approximated greedily:
 * take 5-card combinations while any exist, then one play per remaining rank
 * group (a pair, triple or quad all leave in a single play).
 *
 * Greedy rather than an exact partition search. Exact costs a search over
 * combinations and did not move the correlation with winning, so it is not
 * worth paying for on every deal.
 *
 * @param {Array<Object>} hand - cards as { rank, suit }
 * @returns {number} plays needed
 */
function playsNeeded(hand) {
    let remaining = [...hand];
    let plays = 0;

    let found = true;
    while (remaining.length >= 5 && found) {
        const combo = findFiveCardHand(remaining);
        found = Boolean(combo);
        if (combo) {
            remaining = removeCards(remaining, combo);
            plays++;
        }
    }

    // Everything left goes out one rank group at a time.
    const ranksLeft = new Set(remaining.map(c => c.rank));
    return plays + ranksLeft.size;
}

/** Remove specific cards (by rank+suit identity) from a list. */
function removeCards(cards, toRemove) {
    const out = [...cards];
    for (const card of toRemove) {
        const idx = out.findIndex(c => c.rank === card.rank && c.suit === card.suit);
        if (idx !== -1) out.splice(idx, 1);
    }
    return out;
}

/**
 * Find any one legal 5-card combination in the given cards, preferring the
 * shapes that consume the most otherwise-awkward cards. Returns null if none.
 */
function findFiveCardHand(cards) {
    const bySuit = groupBy(cards, c => c.suit);
    for (const group of Object.values(bySuit)) {
        if (group.length >= 5) return group.slice(0, 5);   // flush
    }

    const byRank = groupBy(cards, c => c.rank);
    for (let i = 0; i <= RANKS.length - 5; i++) {
        const window = RANKS.slice(i, i + 5);
        if (window.every(r => byRank[r])) {
            return window.map(r => byRank[r][0]);           // straight
        }
    }

    const triples = Object.values(byRank).filter(g => g.length >= 3);
    const pairs = Object.values(byRank).filter(g => g.length >= 2);
    if (triples.length > 0 && pairs.length > 1) {
        const triple = triples[0];
        const pair = pairs.find(g => g[0].rank !== triple[0].rank);
        if (pair) return [...triple.slice(0, 3), ...pair.slice(0, 2)];  // full house
    }

    return null;
}

function groupBy(items, keyFn) {
    const out = {};
    for (const item of items) {
        const key = keyFn(item);
        if (!out[key]) out[key] = [];
        out[key].push(item);
    }
    return out;
}

/**
 * Raw deal strength. Two properties matter and they pull against each other:
 * control (cards that take a trick outright) and how many turns the hand needs
 * to empty. A hand full of 2s that sheds in ten plays loses to three tidy
 * combinations.
 *
 * The 2:1 weighting of control against plays is a plateau, not a knife edge -
 * sweeping control weights 1..3 against play weights 0.5..2 moved correlation
 * with winning only between 0.235 and 0.284. The metric is robust to its own
 * constants, so these numbers do not need defending to the last decimal.
 *
 * @param {Array<Object>} hand - 13 cards as { rank, suit }
 * @returns {number} raw score, roughly -9..19, mean ~0.2
 */
function rawDealStrength(hand) {
    if (!hand || hand.length === 0) return 0;

    const count = rank => hand.filter(c => c.rank === rank).length;
    const control =
        2 * count('2') +
        1 * count('A') +
        0.5 * count('K') +
        (hand.some(c => c.rank === '2' && c.suit === 'S') ? 0.5 : 0);

    return 2 * control - playsNeeded(hand);
}

/** Index into TIERS for a raw score. */
function tierIndexFor(raw) {
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) {
        if (raw >= TIERS[i].min) idx = i;
    }
    return idx;
}

/**
 * Where a raw score sits among random deals, 0-100.
 *
 * Uses the mid-rank convention - percent strictly below, plus half the percent
 * tied - because the raw score is coarse and integer-valued. Counting only
 * "strictly below" would report an exactly average deal (raw 0, which nine
 * percent of deals share) as the 55th percentile rather than the ~51st.
 *
 * Fractional inputs, which arise when averaging a player's deals over many
 * rounds, interpolate between the neighbouring integers for the same reason.
 */
function percentileFor(raw) {
    const midRank = (value) => {
        let below = 0, equal = 0;
        for (const bp of PERCENTILE_BREAKPOINTS) {
            if (bp < value) below++;
            else if (bp === value) equal++;
        }
        return below + equal / 2;
    };

    const low = Math.floor(raw);
    if (low === raw) return midRank(raw);
    return midRank(low) + (raw - low) * (midRank(low + 1) - midRank(low));
}

/**
 * Score a dealt hand.
 * @param {Array<Object>} hand - 13 cards as { rank, suit }
 * @returns {Object} { raw, tier, tierKey, tierLabel, percentile, expectedWinRate, expectedPoints }
 */
function calculateDealStrength(hand) {
    const raw = rawDealStrength(hand);
    const tier = tierIndexFor(raw);
    return {
        raw,
        tier,
        tierKey: TIERS[tier].key,
        tierLabel: TIERS[tier].label,
        percentile: percentileFor(raw),
        expectedWinRate: TIERS[tier].winRate,
        expectedPoints: TIERS[tier].avgPoints
    };
}

/**
 * Score every hand at the table and rank them against each other.
 *
 * Rank is the most legible form of this whole feature - "you won holding the
 * worst hand at the table" needs no statistical literacy - and unlike the
 * absolute tiers it needs no calibration, since it compares the four hands
 * actually in play.
 *
 * SECURITY: rank is derived from all four hands and therefore leaks
 * information about opponents' holdings. It must never reach a client while
 * the round is in progress. Persist it at round end; surface it only through
 * the stats API afterwards.
 *
 * @param {Array<Array<Object>>} hands - one 13-card hand per seat
 * @returns {Array<Object>} per-seat strength objects, each with a `rank` of 1-4
 */
function rankTable(hands) {
    const scored = hands.map(calculateDealStrength);
    const order = scored
        .map((s, seat) => ({ seat, raw: s.raw }))
        .sort((a, b) => b.raw - a.raw);

    order.forEach((entry, i) => {
        // Ties share the better rank, so two identical deals are not
        // arbitrarily declared stronger and weaker than each other.
        const tiedWithPrevious = i > 0 && entry.raw === order[i - 1].raw;
        scored[entry.seat].rank = tiedWithPrevious ? scored[order[i - 1].seat].rank : i + 1;
    });

    return scored;
}

module.exports = {
    BASELINE_VERSION,
    TIERS,
    RESIDUAL_SD_WIN,
    RESIDUAL_SD_POINTS,
    MIN_ROUNDS_FOR_EDGE,
    calculateDealStrength,
    rankTable,
    rawDealStrength,
    playsNeeded,
    percentileFor
};
