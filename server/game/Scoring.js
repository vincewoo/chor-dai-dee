// server/game/Scoring.js

/**
 * Calculate round scores based on cards remaining.
 * Losers get points equal to their card count (higher = worse).
 * Penalty multiplier: 2x for 10-12 cards, 3x for 13 cards.
 * Winner gets 0 points for the round.
 *
 * isGuest and joinedMidGame ride along because the persistence layer filters
 * on them. They used to be dropped here, so the round-stats guard that reads
 * `scoreData.isGuest` was checking a field that was never set.
 */
const calculateRoundScores = (winner, players) => {
    const scores = [];

    players.forEach(p => {
        if (p.id === winner.id) {
            scores.push({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                isGuest: !!p.isGuest,
                joinedMidGame: !!p.joinedMidGame,
                roundPoints: 0,
                cardsLeft: 0,
                isRoundWinner: true
            });
        } else {
            const count = p.hand.length;
            let multiplier = 1;
            if (count >= 13) multiplier = 3;
            else if (count >= 10) multiplier = 2;

            const roundPoints = count * multiplier;
            scores.push({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                isGuest: !!p.isGuest,
                joinedMidGame: !!p.joinedMidGame,
                roundPoints,
                cardsLeft: count,
                isRoundWinner: false
            });
        }
    });

    return scores;
};

/**
 * Calculate scores for dragon win (Hong Kong variation).
 * Dragon winner gets 0 points.
 * All other players get 39 points (13 cards * 3x multiplier - as if they lost without playing).
 */
const calculateDragonScores = (dragonWinner, players) => {
    const scores = [];
    const dragonPenalty = 39; // 13 cards with 3x multiplier

    players.forEach(p => {
        if (p.id === dragonWinner.id) {
            scores.push({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                roundPoints: 0,
                cardsLeft: 0,
                isRoundWinner: true,
                isDragonWinner: true
            });
        } else {
            scores.push({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                roundPoints: dragonPenalty,
                cardsLeft: 13,
                isRoundWinner: false
            });
        }
    });

    return scores;
};

module.exports = { calculateRoundScores, calculateDragonScores };
