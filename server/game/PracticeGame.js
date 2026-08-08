// Browser-safe, single-player game authority for offline Practice Mode.
//
// This intentionally owns only the rules needed to play one local human
// against three PPO seats. Online rooms remain authoritative in RoomManager;
// ratings, persistence, spectators, voice, and reconnection never enter this
// module. The legal-move encoder and PPO evaluator are the production ones, so
// a practice bot sees and scores the same position it would on the server.

const { Deck } = require('./Deck');
const { Big2Rules, HAND_TYPES } = require('./Big2Rules');
const { buildGameContext } = require('./BotContext');
const { PPOModel } = require('./PPOModel');
const { PPOBot } = require('./PPOBot');
const { BOT_PERSONA_IDS } = require('./BotStyle');
const {
    calculateRoundScores,
    calculateDragonScores
} = require('./Scoring');
const { getPointThreshold } = require('./GameModes');

const PRACTICE_ROOM_ID = 'PRACTICE';
const PRACTICE_HUMAN_ID = 'practice-human';
const PRACTICE_TEMPERATURE = 4.5;

function publicPlayer(player, lastPlayed, cumulativeScore) {
    return {
        id: player.id,
        name: player.name,
        cardCount: player.hand.length,
        isBot: player.isBot,
        isDisconnected: false,
        lastPlayed: lastPlayed || null,
        cumulativeScore: cumulativeScore || 0,
        publicRank: null
    };
}

class PracticeGame {
    constructor({
        username,
        policyArtifact,
        rng = Math.random,
        roomId = PRACTICE_ROOM_ID,
        temperature = PRACTICE_TEMPERATURE
    }) {
        if (!username) throw new Error('Practice Mode requires a player name');
        this.roomId = roomId;
        this.humanId = PRACTICE_HUMAN_ID;
        this.rng = rng;
        this.temperature = temperature;
        this.model = new PPOModel(policyArtifact);
        this.players = [
            { id: this.humanId, name: username, isBot: false, hand: [] },
            { id: 'practice-bot-1', name: 'Bot 2', isBot: true, hand: [] },
            { id: 'practice-bot-2', name: 'Bot 3', isBot: true, hand: [] },
            { id: 'practice-bot-3', name: 'Bot 4', isBot: true, hand: [] }
        ];
        for (let seat = 1; seat < this.players.length; seat++) {
            this.players[seat].style = BOT_PERSONA_IDS[
                Math.floor(this.rng() * BOT_PERSONA_IDS.length)
            ];
        }
        this.gameMode = 'short';
        this.pointThreshold = getPointThreshold(this.gameMode);
        this.cumulativeScores = Object.fromEntries(
            this.players.map(player => [player.id, 0]));
        this.roundNumber = 1;
        this.lastRoundWinnerId = null;
        this.lastRoundResult = null;
        this.lastGameResult = null;
        this.startRound();
    }

    shuffleDeck() {
        const deck = new Deck();
        for (let index = deck.cards.length - 1; index > 0; index--) {
            const swap = Math.floor(this.rng() * (index + 1));
            [deck.cards[index], deck.cards[swap]] =
                [deck.cards[swap], deck.cards[index]];
        }
        return deck;
    }

    startRound() {
        const deck = this.shuffleDeck();
        for (const player of this.players) {
            player.hand = [];
            for (let count = 0; count < 13; count++) {
                player.hand.push(deck.deal());
            }
            player.hand = Big2Rules.sortCards(player.hand);
        }

        this.gameState = 'playing';
        this.lastPlayedHand = null;
        this.playerLastPlayed = {};
        this.passedSeats = new Set();
        this.passes = 0;
        this.playedCards = [];
        this.trickHistory = [];
        this.playOrder = 0;
        this.turnNumber = 0;
        this.trickWinPending = false;
        this.trickWinner = null;
        this.lastRoundResult = null;

        const dragonSeat = this.players.findIndex(player =>
            Big2Rules.isDragon(player.hand));
        if (dragonSeat !== -1) {
            this.finishDragon(dragonSeat);
            return { dragon: true };
        }

        if (this.roundNumber === 1) {
            this.currentTurnIndex = this.players.findIndex(player =>
                player.hand.some(card =>
                    card.rank === '3' && card.suit === 'D'));
        } else {
            const winnerSeat = this.players.findIndex(
                player => player.id === this.lastRoundWinnerId);
            this.currentTurnIndex = winnerSeat === -1 ? 0 : winnerSeat;
        }
        return { dragon: false };
    }

    nextRound() {
        if (this.gameState !== 'round_over') {
            return { error: 'Round is not over' };
        }
        this.roundNumber++;
        return { success: true, ...this.startRound() };
    }

    isFirstTurn() {
        return this.roundNumber === 1 &&
            this.players.every(player => player.hand.length === 13) &&
            this.playedCards.length === 0;
    }

    nextPlayerCardCount(seat) {
        return this.players[(seat + 1) % 4].hand.length;
    }

    buildContext(seat) {
        const lastPlayedSeat = this.lastPlayedHand
            ? this.players.findIndex(
                player => player.id === this.lastPlayedHand.playerId)
            : undefined;
        return buildGameContext({
            hands: this.players.map(player => player.hand),
            seat,
            passedSeats: this.passedSeats,
            passCount: this.passes,
            playedCards: this.playedCards,
            trickHistory: this.trickHistory,
            lastPlayedHand: this.lastPlayedHand,
            lastPlayedSeat,
            profile: null,
            rng: this.rng
        });
    }

    getBotMove() {
        const player = this.players[this.currentTurnIndex];
        if (!player?.isBot || this.gameState !== 'playing' ||
            this.trickWinPending) {
            return { error: 'It is not a bot turn' };
        }
        const bot = new PPOBot(this.model, {
            sample: true,
            temperature: this.temperature,
            style: player.style,
            rng: this.rng
        });
        return {
            cards: bot.getBotMove(
                player.hand,
                this.lastPlayedHand,
                this.isFirstTurn(),
                this.buildContext(this.currentTurnIndex)
            )
        };
    }

    play(playerId, cards) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };
        if (this.trickWinPending) {
            return { error: 'Wait for current trick to clear' };
        }
        const seat = this.players.findIndex(player => player.id === playerId);
        if (seat !== this.currentTurnIndex) return { error: 'Not your turn' };
        if (!Array.isArray(cards) || !cards.length) {
            return { error: 'Select cards to play' };
        }

        const player = this.players[seat];
        const remaining = [...player.hand];
        const owned = [];
        for (const requested of cards) {
            const index = remaining.findIndex(card =>
                card.rank === requested.rank && card.suit === requested.suit);
            if (index === -1) return { error: 'You do not have these cards' };
            owned.push(remaining[index]);
            remaining.splice(index, 1);
        }

        const validated = Big2Rules.validateHand(owned);
        if (!validated) return { error: 'Invalid hand combination' };
        if (this.isFirstTurn() && !owned.some(card =>
            card.rank === '3' && card.suit === 'D')) {
            return { error: 'Must play 3 of Diamonds on first turn' };
        }
        if (this.lastPlayedHand &&
            !Big2Rules.canBeat(validated, this.lastPlayedHand)) {
            return { error: 'Hand does not beat the current table' };
        }
        if (validated.type === HAND_TYPES.SINGLE &&
            Big2Rules.highestSingleRuleApplies(
                this.nextPlayerCardCount(seat))) {
            const highest = player.hand.reduce((best, card) =>
                card.value > best.value ? card : best);
            if (validated.cards[0].value !== highest.value) {
                return {
                    error: 'The next player is on their last card - a single must be your highest card'
                };
            }
        }

        player.hand = remaining;
        this.lastPlayedHand = { ...validated, playerId };
        this.playOrder++;
        this.playerLastPlayed[playerId] = {
            type: 'play',
            ...validated,
            playerId,
            timestamp: Date.now(),
            playOrder: this.playOrder
        };
        this.passedSeats.clear();
        this.passes = 0;
        this.playedCards.push(...validated.cards.map(card => ({ ...card })));
        this.trickHistory.push({
            seat,
            action: 'play',
            hand: validated
        });
        this.turnNumber++;

        if (player.hand.length === 0) {
            return this.finishRound(seat);
        }

        const singleTwoSpades = validated.type === HAND_TYPES.SINGLE &&
            validated.cards[0].rank === '2' &&
            validated.cards[0].suit === 'S';
        if (singleTwoSpades) {
            for (let other = 0; other < this.players.length; other++) {
                if (other === seat) continue;
                this.passedSeats.add(other);
                const otherPlayer = this.players[other];
                this.playOrder++;
                this.playerLastPlayed[otherPlayer.id] = {
                    type: 'pass',
                    playerId: otherPlayer.id,
                    timestamp: Date.now(),
                    playOrder: this.playOrder
                };
            }
            this.passes = 3;
            this.trickWinPending = true;
            this.trickWinner = playerId;
            this.currentTurnIndex = seat;
            return { success: true, trickWon: true };
        }

        this.advanceTurn();
        return { success: true };
    }

    pass(playerId) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };
        if (this.trickWinPending) {
            return { error: 'Wait for current trick to clear' };
        }
        const seat = this.players.findIndex(player => player.id === playerId);
        if (seat !== this.currentTurnIndex) return { error: 'Not your turn' };
        if (!this.lastPlayedHand) return { error: 'Cannot pass on free turn' };
        if (this.lastPlayedHand.type === HAND_TYPES.SINGLE &&
            Big2Rules.highestSingleRuleApplies(
                this.nextPlayerCardCount(seat)) &&
            this.players[seat].hand.some(card =>
                card.value > this.lastPlayedHand.value)) {
            return {
                error: 'The next player is on their last card - you must beat this single'
            };
        }

        this.playOrder++;
        this.playerLastPlayed[playerId] = {
            type: 'pass',
            playerId,
            timestamp: Date.now(),
            playOrder: this.playOrder
        };
        this.passedSeats.add(seat);
        this.passes++;
        const { playerId: _owner, ...pile } = this.lastPlayedHand;
        this.trickHistory.push({ seat, action: 'pass', hand: pile });
        this.turnNumber++;

        const winnerSeat = this.players.findIndex(
            player => player.id === this.lastPlayedHand.playerId);
        const allOthersPassed = this.players.every((_, index) =>
            index === winnerSeat || this.passedSeats.has(index));
        if (allOthersPassed) {
            this.trickWinPending = true;
            this.trickWinner = this.players[winnerSeat].id;
            this.currentTurnIndex = winnerSeat;
            return { success: true, trickWon: true };
        }

        this.advanceTurn();
        return { success: true };
    }

    advanceTurn() {
        let attempts = 0;
        do {
            this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
            attempts++;
        } while (this.passedSeats.has(this.currentTurnIndex) && attempts < 4);
    }

    clearTrick() {
        if (!this.trickWinPending) return false;
        this.lastPlayedHand = null;
        this.playerLastPlayed = {};
        this.passedSeats.clear();
        this.passes = 0;
        this.playOrder = 0;
        this.trickWinPending = false;
        this.trickWinner = null;
        return true;
    }

    finishRound(winnerSeat) {
        const winner = this.players[winnerSeat];
        this.lastRoundWinnerId = winner.id;
        const scores = calculateRoundScores(winner, this.players);
        for (const score of scores) {
            this.cumulativeScores[score.id] += score.roundPoints;
        }
        const scoresWithCumulative = scores.map(score => ({
            ...score,
            cumulativeScore: this.cumulativeScores[score.id]
        }));
        this.gameState = Object.values(this.cumulativeScores)
            .some(score => score >= this.pointThreshold)
            ? 'finished'
            : 'round_over';
        if (this.gameState === 'finished') {
            const gameWinner = this.players.reduce((best, player) =>
                this.cumulativeScores[player.id] <
                    this.cumulativeScores[best.id]
                    ? player
                    : best);
            this.lastGameResult = {
                winner: this.sanitizePlayer(gameWinner),
                scores: scoresWithCumulative,
                finalScores: { ...this.cumulativeScores },
                roundNumber: this.roundNumber,
                pendingRankFor: []
            };
        } else {
            this.lastRoundResult = {
                roundWinner: this.sanitizePlayer(winner),
                scores: scoresWithCumulative,
                roundNumber: this.roundNumber
            };
        }
        return {
            success: true,
            roundOver: true,
            gameOver: this.gameState === 'finished'
        };
    }

    finishDragon(winnerSeat) {
        const winner = this.players[winnerSeat];
        const scores = calculateDragonScores(winner, this.players);
        for (const score of scores) {
            this.cumulativeScores[score.id] += score.roundPoints;
        }
        const scoresWithCumulative = scores.map(score => ({
            ...score,
            cumulativeScore: this.cumulativeScores[score.id]
        }));
        this.gameState = 'finished';
        this.currentTurnIndex = winnerSeat;
        this.lastGameResult = {
            winner: this.sanitizePlayer(winner),
            scores: scoresWithCumulative,
            finalScores: { ...this.cumulativeScores },
            roundNumber: this.roundNumber,
            pendingRankFor: [],
            isDragonWin: true
        };
    }

    sanitizePlayer(player) {
        return { id: player.id, name: player.name, isBot: player.isBot };
    }

    getHumanHand() {
        return [...this.players[0].hand];
    }

    getGameState() {
        return {
            roomId: this.roomId,
            hostUsername: this.players[0].name,
            players: this.players.map(player => publicPlayer(
                player,
                this.playerLastPlayed[player.id],
                this.cumulativeScores[player.id]
            )),
            currentTurn: this.players[this.currentTurnIndex]?.id || null,
            lastPlayedHand: this.lastPlayedHand,
            gameState: this.gameState,
            roundNumber: this.roundNumber,
            turnNumber: this.turnNumber,
            cumulativeScores: { ...this.cumulativeScores },
            debugMode: false,
            gameMode: this.gameMode,
            botDifficulty: 'balanced',
            forceMaxBots: false,
            adaptiveCalibration: null,
            pointThreshold: this.pointThreshold,
            isPrivate: true,
            trickWinPending: this.trickWinPending,
            trickWinner: this.trickWinner,
            spectators: [],
            spectatorsMutedAll: false,
            practiceMode: true
        };
    }
}

module.exports = {
    PracticeGame,
    PRACTICE_ROOM_ID,
    PRACTICE_HUMAN_ID,
    PRACTICE_TEMPERATURE
};
