// server/game/Scoring.js
const calculateScores = (winner, players) => {
    // Winner gets +Sum(All penalties)
    // Losers get -Penalty
    // Penalty = Cards * Multiplier
    // Multiplier: 1 (default), 2 (10-12 cards), 3 (13 cards)

    const scores = [];
    let winnerPoints = 0;

    players.forEach(p => {
        if (p.id === winner.id) {
            scores.push({ id: p.id, isWin: true, points: 0, name: p.name, isBot: p.isBot }); // Placeholder
        } else {
            const count = p.hand.length;
            let multiplier = 1;
            if (count >= 13) multiplier = 3;
            else if (count >= 10) multiplier = 2;

            const penalty = count * multiplier;
            winnerPoints += penalty;
            scores.push({ id: p.id, isWin: false, points: -penalty, name: p.name, isBot: p.isBot });
        }
    });

    // Update winner points
    const winnerEntry = scores.find(s => s.id === winner.id);
    winnerEntry.points = winnerPoints;

    return scores;
};

module.exports = { calculateScores };
