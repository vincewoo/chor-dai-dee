// server/game/Deck.js

const SUITS = ['D', 'C', 'H', 'S']; // Diamonds < Clubs < Hearts < Spades
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']; // 3 < ... < 2

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    reset() {
        this.cards = [];
        for (let suit of SUITS) {
            for (let rank of RANKS) {
                this.cards.push({ suit, rank, value: this.getCardValue(rank, suit) });
            }
        }
    }

    getCardValue(rank, suit) {
        // Calculate a unique value for comparison
        // Ranks: 3=0, 4=1, ... 2=12
        // Suits: D=0, C=1, H=2, S=3
        // Value = RankIndex * 4 + SuitIndex
        const rankIndex = RANKS.indexOf(rank);
        const suitIndex = SUITS.indexOf(suit);
        return rankIndex * 4 + suitIndex;
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal() {
        return this.cards.pop();
    }
}

module.exports = { Deck, SUITS, RANKS };
