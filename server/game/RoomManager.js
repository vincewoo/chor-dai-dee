// server/game/RoomManager.js
const { Deck } = require('./Deck');
const { Big2Rules } = require('./Big2Rules');
const { BotLogic } = require('./BotLogic');

class Room {
    constructor(roomId) {
        this.id = roomId;
        this.players = []; // Array of { id, name, socket, hand, isBot }
        this.gameState = 'waiting'; // waiting, playing, finished
        this.deck = new Deck();
        this.currentTurnIndex = 0;
        this.lastPlayedHand = null; // { cards, type, value, playerId }
        this.playerLastPlayed = {}; // Track each player's last played hand in current round
        this.passedPlayers = new Set(); // Track players who have passed this round
        this.passes = 0; // Count consecutive passes
        this.winners = []; // Order of finishing
    }

    addPlayer(player) {
        if (this.players.length >= 4) return false;
        this.players.push(player);
        return true;
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.id !== socketId);
        // If game is playing, this is tricky. For MVP, maybe end game or replace with bot?
        // Simpler: Reset room if someone leaves during waiting.
        if (this.gameState === 'waiting') {
             // Fine
        } else {
            // Player left mid-game.
            // Mark as disconnected or auto-play?
            // For now, let's just keep them in array but maybe mark disconnected.
        }
    }

    startGame() {
        if (this.players.length < 4) {
            // Auto-fill with bots if < 4? Or require 4?
            // "Add some AI bots so players can practice offline"
            // We should fill with bots.
            while (this.players.length < 4) {
                const botId = `bot_${Date.now()}_${this.players.length}`;
                this.players.push({
                    id: botId,
                    name: `Bot ${this.players.length + 1}`,
                    isBot: true,
                    difficulty: 'easy' // Default to easy for now
                });
            }
        }

        this.deck.reset();
        this.deck.shuffle();

        // Deal 13 cards to each
        for (let player of this.players) {
            player.hand = [];
            for (let i = 0; i < 13; i++) {
                player.hand.push(this.deck.deal());
            }
            // Sort hand
            player.hand = Big2Rules.sortCards(player.hand);
        }

        this.gameState = 'playing';
        this.lastPlayedHand = null;
        this.playerLastPlayed = {}; // Reset player played hands
        this.passedPlayers = new Set(); // Reset passed players
        this.passes = 0;
        this.winners = [];

        // Find who has 3 of Diamonds
        for (let i = 0; i < 4; i++) {
            const has3D = this.players[i].hand.some(c => c.rank === '3' && c.suit === 'D');
            if (has3D) {
                this.currentTurnIndex = i;
                break;
            }
        }

        return this.getGameState();
    }

    playHand(playerId, cards) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.currentTurnIndex) return { error: 'Not your turn' };

        const player = this.players[playerIndex];

        // Validate that player actually has these cards
        // cards is usually just an array of card objects or indices?
        // Let's assume input is array of card objects sent from client.
        // We need to verify ownership strictly.
        // Better to send indices? Or match by value?
        // Match by rank/suit.

        const handToPlay = [];
        const newPlayerHand = [...player.hand];

        for (let card of cards) {
            const idx = newPlayerHand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
            if (idx === -1) return { error: 'You do not have these cards' };
            handToPlay.push(newPlayerHand[idx]);
            newPlayerHand.splice(idx, 1); // Remove momentarily
        }

        // Validate Rules
        // Send full card objects to validation, just in case
        const validatedHand = Big2Rules.validateHand(handToPlay);
        if (!validatedHand) return { error: 'Invalid hand combination' };

        // 3 of Diamonds check for first turn
        // If it's the very first turn of the game
        // Logic: if winners is empty AND everyone has 13 cards?
        // Or simpler: if this.players.every(p => p.hand.length === 13)
        // BUT, what if someone disconnected?
        // Better: Use a flag "firstTurn" in room state? Or check if 3D is in someone's hand.
        // If 3D is in THIS player's hand, they MUST play it.
        // Wait, the rule is "The player with 3D starts".
        // If it is the first turn, 3D MUST be part of the played hand.
        const anyoneHas13 = this.players.some(p => p.hand.length === 13);
        const everyoneFull = this.players.every(p => p.hand.length === 13);

        // This is imperfect for reconnection, but fine for fresh games.
        if (everyoneFull && this.winners.length === 0) {
             const has3D = handToPlay.some(c => c.rank === '3' && c.suit === 'D');
             if (!has3D) return { error: 'Must play 3 of Diamonds on first turn' };
        }

        // Compare with last played hand
        if (this.lastPlayedHand) {
             // If we are not in a "free play" state (everyone passed)
             if (!Big2Rules.canBeat(validatedHand, this.lastPlayedHand)) {
                 return { error: 'Hand does not beat the current table' };
             }
        }

        // Move is valid
        player.hand = newPlayerHand; // Update hand
        this.lastPlayedHand = { ...validatedHand, playerId };
        // Record this player's played hand (visible until round ends)
        this.playerLastPlayed[playerId] = { type: 'play', ...validatedHand, playerId };
        // Note: Don't clear passedPlayers here - players who passed stay out until round is won
        this.passes = 0; // Reset consecutive pass counter

        // Check Win
        if (player.hand.length === 0) {
            this.winners.push(player);
            this.gameState = 'finished'; // Or continue for 2nd/3rd/4th? usually continue.
            // Requirement says "Winner takes the win" usually implies game over?
            // "Multiplayer Big 2" usually plays until 3 people finish or just 1.
            // Let's stop at 1 winner for MVP simplicity, or continue.
            // Let's Stop at 1 for now.
            return { success: true, gameOver: true, winner: player };
        }

        this.advanceTurn();
        return { success: true };
    }

    passTurn(playerId) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.currentTurnIndex) return { error: 'Not your turn' };

        if (!this.lastPlayedHand) return { error: 'Cannot pass on free turn' }; // Can't pass if you are leading

        // Record that this player passed
        this.playerLastPlayed[playerId] = { type: 'pass', playerId };
        this.passedPlayers.add(playerId); // Mark player as passed for this round

        this.passes++;

        // Check if all other players (except the one who played last) have passed
        const lastPlayerId = this.lastPlayedHand.playerId;
        const activePlayers = this.players.filter(p => p.id !== lastPlayerId);
        const allOthersPassed = activePlayers.every(p => this.passedPlayers.has(p.id));

        if (allOthersPassed) {
            // Round won - last player who played gets control
            this.lastPlayedHand = null;
            this.playerLastPlayed = {}; // Clear all displayed hands
            this.passedPlayers = new Set(); // Clear passed players
            this.passes = 0;
            // Set turn to the player who won the round
            this.currentTurnIndex = this.players.findIndex(p => p.id === lastPlayerId);
        } else {
            this.advanceTurn();
        }

        return { success: true };
    }

    advanceTurn() {
        // Move to next player, skipping those who have passed
        let attempts = 0;
        do {
            this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
            attempts++;
        } while (
            this.passedPlayers.has(this.players[this.currentTurnIndex]?.id) &&
            attempts < 4
        );
    }

    // New method to check if current player is bot and play
    checkBotTurn(callback) {
        const currentPlayer = this.players[this.currentTurnIndex];
        if (currentPlayer && currentPlayer.isBot && this.gameState === 'playing') {
            // Determine if first turn
            const everyoneFull = this.players.every(p => p.hand.length === 13);
            const isFirstTurn = everyoneFull && this.winners.length === 0;

            const move = BotLogic.getBotMove(currentPlayer.hand, this.lastPlayedHand, isFirstTurn);

            setTimeout(() => {
                if (move) {
                    // Play
                    const res = this.playHand(currentPlayer.id, move);
                    if (res.success) {
                        if (res.gameOver) {
                            callback({ type: 'gameOver', winner: res.winner });
                        } else {
                            callback({ type: 'play', playerId: currentPlayer.id });
                        }
                    }
                } else {
                    // Pass
                    this.passTurn(currentPlayer.id);
                    callback({ type: 'pass', playerId: currentPlayer.id });
                }
            }, 1000); // 1s delay for realism
        }
    }

    getGameState() {
        return {
            roomId: this.id,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand ? p.hand.length : 0,
                isBot: p.isBot,
                lastPlayed: this.playerLastPlayed[p.id] || null
            })),
            currentTurn: this.players[this.currentTurnIndex]?.id,
            lastPlayedHand: this.lastPlayedHand,
            gameState: this.gameState
        };
    }

    getPlayerHand(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player ? player.hand : [];
    }
}

class RoomManager {
    constructor() {
        this.rooms = new Map();
    }

    createRoom() {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        const room = new Room(roomId);
        this.rooms.set(roomId, room);
        return roomId;
    }

    joinRoom(roomId, player) {
        const room = this.rooms.get(roomId);
        if (!room) return { error: 'Room not found' };
        if (room.addPlayer(player)) {
            return { success: true, room };
        }
        return { error: 'Room full' };
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
}

module.exports = { RoomManager, Room };
