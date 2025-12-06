// server/game/Scoring.js

/**
 * Calculate round scores based on cards remaining.
 * Losers get points equal to their card count (higher = worse).
 * Penalty multiplier: 2x for 10-12 cards, 3x for 13 cards.
 * Winner gets 0 points for the round.
 */
const calculateRoundScores = (winner, players) => {
    const scores = [];

    players.forEach(p => {
        if (p.id === winner.id) {
            scores.push({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
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
                roundPoints,
                cardsLeft: count,
                isRoundWinner: false
            });
        }
    });

    return scores;
};

module.exports = { calculateRoundScores };
