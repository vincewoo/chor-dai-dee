// server/game/BotLogic.js
const { Big2Rules, HAND_TYPES } = require('./Big2Rules');

const BotLogic = {
    getBotMove: (hand, lastPlayedHand, isFirstTurn) => {
        // Find all possible valid moves
        // If lastPlayedHand is null, we can play anything.
        // If lastPlayedHand exists, we must beat it.

        const validMoves = BotLogic.getAllValidMoves(hand);

        // Filter by what can beat the current hand
        let candidates = [];
        if (!lastPlayedHand) {
            candidates = validMoves;
            // If first turn, MUST include 3D
            if (isFirstTurn) {
                candidates = candidates.filter(move =>
                    move.cards.some(c => c.rank === '3' && c.suit === 'D')
                );
            }
        } else {
            candidates = validMoves.filter(move => Big2Rules.canBeat(move, lastPlayedHand));
        }

        if (candidates.length === 0) return null; // Pass

        // Strategy: Lowest value first
        candidates.sort((a, b) => a.value - b.value);

        return candidates[0].cards;
    },

    getAllValidMoves: (hand) => {
        const moves = [];
        // Singles
        for (let card of hand) {
            moves.push(Big2Rules.validateHand([card]));
        }

        // Pairs
        const ranks = {};
        hand.forEach(c => {
            if (!ranks[c.rank]) ranks[c.rank] = [];
            ranks[c.rank].push(c);
        });

        for (let rank in ranks) {
            const cards = ranks[rank];
            if (cards.length >= 2) {
                // All pair combinations
                for (let i = 0; i < cards.length; i++) {
                    for (let j = i + 1; j < cards.length; j++) {
                        moves.push(Big2Rules.validateHand([cards[i], cards[j]]));
                    }
                }
            }
            if (cards.length >= 3) {
                 moves.push(Big2Rules.validateHand([cards[0], cards[1], cards[2]]));
                 if (cards.length === 4) {
                     // Triples from 4?
                     moves.push(Big2Rules.validateHand([cards[0], cards[1], cards[3]]));
                     moves.push(Big2Rules.validateHand([cards[0], cards[2], cards[3]]));
                     moves.push(Big2Rules.validateHand([cards[1], cards[2], cards[3]]));
                 }
            }
        }

        // 5 Card hands - Complex to generate all.
        // For MVP Bot, maybe just check for Straights and Flushes simply?
        // Or simplified hard bot: Just Singles/Pairs/Triples is often enough to test.
        // Let's add simple Straight detection.
        // Sort hand by rank index (not value)
        // This is getting complex for "Easy/Hard" bot in limited time.
        // Let's stick to Singles, Pairs, Triples for now.
        // If the bot has a Full House it won't know, but that's "Easy" bot behavior.

        return moves.filter(m => m !== null);
    }
};

module.exports = { BotLogic };
