// server/game/RatingSystem.js
const { rate, rating, ordinal } = require('openskill');

// Constants
const DEFAULT_MU = 25;
const DEFAULT_SIGMA = 25 / 3;

// Constants for display rating calculation
const RATING_OFFSET = 1200;
const RATING_MULTIPLIER = 40;

// What a bot seat is worth to beat, by difficulty tier.
//
// Bots never receive rating updates, but they are rated *opponents*: their mu
// is what calculateNewRatings weighs a human's placement against. Leaving a
// deliberately weakened bot at DEFAULT_MU would pay a human the same for
// beating a casual table as for beating a full-strength one, which is a
// farmable rating.
//
// These are fitted, not chosen. For each tier, mu is the value at which
// openskill's predictWin gives a DEFAULT_MU player against three such bots the
// win rate that scripts/bench-bot-difficulty.js actually measured for that tier
// (25% / 32% / 40%; neutral is 25%). Re-fit them if the bench numbers move -
// there is a test pinning the relationship. `competitive` must stay exactly
// DEFAULT_MU so the default table's rating math is unchanged.
//
// Sigma is deliberately left at DEFAULT_SIGMA: it expresses uncertainty about
// the opponent, which a difficulty tier says nothing about.
const BOT_RATING_BY_DIFFICULTY = {
    competitive: DEFAULT_MU,
    balanced: 19.83,
    casual: 12.85
};

// Hidden opponent rating for the continuous Adaptive temperature. The two
// shipped tier anchors (T=4.5 and T=8) retain their measured fitted values;
// the remaining monotone anchors are a version-1 extrapolation to be re-fitted
// from the exact temperatures now written to game logs.
const BOT_RATING_BY_TEMPERATURE = [
    { temperature: 1, mu: DEFAULT_MU },
    { temperature: 3, mu: 22.5 },
    { temperature: 4.5, mu: 19.83 },
    { temperature: 6, mu: 17.3 },
    { temperature: 8, mu: 12.85 },
    { temperature: 9, mu: 10 },
    { temperature: 12, mu: 5 },
    { temperature: 20, mu: -5 }
];

function botMuForTemperature(temperature) {
    const value = Number(temperature);
    if (!Number.isFinite(value)) return DEFAULT_MU;
    if (value <= BOT_RATING_BY_TEMPERATURE[0].temperature) {
        return BOT_RATING_BY_TEMPERATURE[0].mu;
    }

    const last = BOT_RATING_BY_TEMPERATURE[
        BOT_RATING_BY_TEMPERATURE.length - 1];
    if (value >= last.temperature) return last.mu;

    for (let index = 1; index < BOT_RATING_BY_TEMPERATURE.length; index++) {
        const right = BOT_RATING_BY_TEMPERATURE[index];
        if (value > right.temperature) continue;
        const left = BOT_RATING_BY_TEMPERATURE[index - 1];
        const fraction = (value - left.temperature) /
            (right.temperature - left.temperature);
        return left.mu + fraction * (right.mu - left.mu);
    }
    return DEFAULT_MU;
}

/**
 * The rating a bot seat is created with, given the room's difficulty tier.
 * Unknown or absent tiers fall back to full strength - an unrecognised setting
 * must never be a way to earn cheap rating.
 *
 * @param {string} difficulty - tier id
 * @returns {{mu: number, sigma: number}}
 */
function botRatingForDifficulty(difficulty, temperature) {
    const mu = difficulty === 'adaptive'
        ? botMuForTemperature(temperature)
        : Object.prototype.hasOwnProperty.call(
            BOT_RATING_BY_DIFFICULTY, difficulty)
            ? BOT_RATING_BY_DIFFICULTY[difficulty]
            : DEFAULT_MU;
    return { mu, sigma: DEFAULT_SIGMA };
}

/**
 * Calculates the display rating from OpenSkill mu and sigma.
 * Formula: 1200 + (mu - 3*sigma) * 40
 * This maps a new player (0 conservative rating) to 1200.
 *
 * @param {number} mu - Skill mean
 * @param {number} sigma - Uncertainty
 * @returns {number} - The display rating (rounded integer)
 */
function calculateDisplayRating(mu, sigma) {
    if (mu === undefined || mu === null) mu = DEFAULT_MU;
    if (sigma === undefined || sigma === null) sigma = DEFAULT_SIGMA;

    // We use the raw values directly instead of ordinal() from openskill
    // because ordinal() might have its own implementation details we want to control,
    // although ordinal() is typically mu - 3*sigma.
    // Let's stick to the formula explicitly agreed upon.
    const conservativeRating = mu - 3 * sigma;
    return Math.round((conservativeRating * RATING_MULTIPLIER) + RATING_OFFSET);
}

/**
 * Calculates new ratings for a game of Big 2 using OpenSkill.
 *
 * @param {Array} players - Array of player objects.
 *                          Each object must have: { id, name, isBot, rating_mu, rating_sigma }
 *                          (For bots or new players, mu/sigma can be undefined/null, defaults will be used)
 * @param {Object} finalScores - Map of { playerId: score }. Big 2 scores are penalties (lower is better).
 * @returns {Array} - Array of objects { id, name, mu, sigma, ordinal } for HUMAN players only.
 */
function calculateNewRatings(players, finalScores) {
    // 1. Prepare teams for OpenSkill
    // OpenSkill expects an array of teams. Each team is an array of ratings.
    // In Big 2, it's Free-For-All, so each player is a team of 1.

    const teams = [];
    const scores = []; // OpenSkill scores (higher is better)
    const playerOrder = []; // To track which result corresponds to which player

    players.forEach(p => {
        // Use current rating or defaults
        const mu = (p.rating_mu !== undefined && p.rating_mu !== null) ? p.rating_mu : DEFAULT_MU;
        const sigma = (p.rating_sigma !== undefined && p.rating_sigma !== null) ? p.rating_sigma : DEFAULT_SIGMA;

        const r = rating({ mu, sigma });
        teams.push([r]);
        playerOrder.push(p);

        // Calculate score for OpenSkill to determine RANK.
        // Big 2: Lower points = Better.
        // OpenSkill: Higher score = Better (for sorting ranks).
        // By passing these scores, OpenSkill will correctly identify that:
        // Winner (0 pts) > 2nd (8 pts) > 3rd (15 pts) > 4th (30 pts)
        // because -0 > -8 > -15 > -30.
        // This implicitly handles the "magnitude" of the loss by placing
        // players in the correct strict order (1, 2, 3, 4) rather than just "Winner vs Losers".
        const penalty = finalScores[p.id] || 0;
        scores.push(-penalty);
    });

    // 2. Calculate new ratings
    // We pass 'score' to determine rank.
    // The library uses these scores to sort teams and assign ranks 1..N.
    const newRatings = rate(teams, { score: scores });

    // 3. Map results back to players and filter out bots
    const updates = [];

    newRatings.forEach((teamRating, index) => {
        const player = playerOrder[index];
        const newRating = teamRating[0]; // Since team size is 1

        // Only return updates for humans
        if (!player.isBot) {
            updates.push({
                id: player.id,
                name: player.name,
                mu: newRating.mu,
                sigma: newRating.sigma,
                ordinal: ordinal(newRating) // Display rating (mu - 3*sigma)
            });
        }
    });

    return updates;
}

module.exports = {
    calculateNewRatings,
    calculateDisplayRating,
    botRatingForDifficulty,
    botMuForTemperature,
    BOT_RATING_BY_DIFFICULTY,
    BOT_RATING_BY_TEMPERATURE,
    DEFAULT_MU,
    DEFAULT_SIGMA
};
