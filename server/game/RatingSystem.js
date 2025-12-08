// server/game/RatingSystem.js
const { rate, rating, ordinal } = require('openskill');

// Constants
const DEFAULT_MU = 25;
const DEFAULT_SIGMA = 25 / 3;

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

module.exports = { calculateNewRatings };
