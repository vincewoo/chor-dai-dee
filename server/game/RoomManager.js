// server/game/RoomManager.js
const { Deck } = require('./Deck');
const { Big2Rules } = require('./Big2Rules');
const { BotLogic } = require('./BotLogic');

class Room {
    constructor(roomId) {
        this.id = roomId;
        this.players = []; // Array of { id, name, socket, hand, isBot }
        this.gameState = 'waiting'; // waiting, playing, round_over, finished
        this.deck = new Deck();
        this.currentTurnIndex = 0;
        this.lastPlayedHand = null; // { cards, type, value, playerId }
        this.playerLastPlayed = {}; // Track each player's last played hand in current round
        this.passedPlayers = new Set(); // Track players who have passed this round
        this.passes = 0; // Count consecutive passes
        this.winners = []; // Order of finishing
        this.cumulativeScores = {}; // Track cumulative scores: { playerId: totalPoints }
        this.roundNumber = 0; // Current round number
        this.lastRoundWinnerId = null; // Winner of last round starts next
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
            // Auto-fill with bots if < 4
            while (this.players.length < 4) {
                const botId = `bot_${Date.now()}_${this.players.length}`;
                this.players.push({
                    id: botId,
                    name: `Bot ${this.players.length + 1}`,
                    isBot: true,
                    difficulty: 'easy'
                });
            }
        }

        // Initialize cumulative scores for all players (only on first game start)
        if (this.roundNumber === 0) {
            this.players.forEach(p => {
                this.cumulativeScores[p.id] = 0;
            });
        }

        this.roundNumber++;
        this.startRound();
        return this.getGameState();
    }

    startRound() {
        this.deck.reset();
        this.deck.shuffle();

        // Deal 13 cards to each
        for (let player of this.players) {
            player.hand = [];
            for (let i = 0; i < 13; i++) {
                player.hand.push(this.deck.deal());
            }
            player.hand = Big2Rules.sortCards(player.hand);
        }

        this.gameState = 'playing';
        this.lastPlayedHand = null;
        this.playerLastPlayed = {};
        this.passedPlayers = new Set();
        this.passes = 0;
        this.winners = [];

        // Determine who starts: first round = 3 of Diamonds, later rounds = last winner
        if (this.roundNumber === 1) {
            // Find who has 3 of Diamonds
            for (let i = 0; i < 4; i++) {
                const has3D = this.players[i].hand.some(c => c.rank === '3' && c.suit === 'D');
                if (has3D) {
                    this.currentTurnIndex = i;
                    break;
                }
            }
        } else if (this.lastRoundWinnerId) {
            // Last round winner starts
            const winnerIndex = this.players.findIndex(p => p.id === this.lastRoundWinnerId);
            this.currentTurnIndex = winnerIndex >= 0 ? winnerIndex : 0;
        }
    }

    updateScores(roundScores) {
        // Add round scores to cumulative scores
        roundScores.forEach(s => {
            this.cumulativeScores[s.id] = (this.cumulativeScores[s.id] || 0) + s.roundPoints;
        });

        // Check if anyone hit 100 points
        const gameOver = Object.values(this.cumulativeScores).some(score => score >= 100);
        return gameOver;
    }

    getGameWinner() {
        // Winner is the player with the lowest score
        let minScore = Infinity;
        let winner = null;
        this.players.forEach(p => {
            const score = this.cumulativeScores[p.id] || 0;
            if (score < minScore) {
                minScore = score;
                winner = p;
            }
        });
        return winner;
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

        // 3 of Diamonds check - only required on the very first turn of round 1
        const everyoneFull = this.players.every(p => p.hand.length === 13);
        const isFirstTurnOfGame = this.roundNumber === 1 && everyoneFull && this.winners.length === 0;

        if (isFirstTurnOfGame) {
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

        // Check if player finished round
        if (player.hand.length === 0) {
            this.winners.push(player);
            this.gameState = 'round_over';
            this.lastRoundWinnerId = player.id;
            return { success: true, roundOver: true, roundWinner: player };
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
            // Determine if first turn of the entire game (round 1 only)
            const everyoneFull = this.players.every(p => p.hand.length === 13);
            const isFirstTurn = this.roundNumber === 1 && everyoneFull && this.winners.length === 0;

            // Build game context for strategic decisions
            const gameContext = {
                // Card counts in turn order starting from next player
                playerCardCounts: [],
                // Index of the player who played last (relative: 1=next, 2=across, 3=previous)
                lastPlayedByRelative: null,
                // Which players have passed this round
                passedPlayers: [],
                // Total passes this round
                passCount: this.passes
            };

            // Build player info in turn order (next player first)
            for (let i = 1; i <= 3; i++) {
                const idx = (this.currentTurnIndex + i) % 4;
                const player = this.players[idx];
                gameContext.playerCardCounts.push(player.hand ? player.hand.length : 0);
                if (this.passedPlayers.has(player.id)) {
                    gameContext.passedPlayers.push(i - 1); // 0=next, 1=across, 2=previous
                }
            }

            // Find who played last (relative position)
            if (this.lastPlayedHand && this.lastPlayedHand.playerId) {
                const lastPlayerIdx = this.players.findIndex(p => p.id === this.lastPlayedHand.playerId);
                if (lastPlayerIdx !== -1) {
                    // Calculate relative position (1-3, where 1=next player, 3=previous player)
                    let relative = (lastPlayerIdx - this.currentTurnIndex + 4) % 4;
                    if (relative === 0) relative = 4; // Shouldn't happen, but just in case
                    gameContext.lastPlayedByRelative = relative;
                }
            }

            const move = BotLogic.getBotMove(
                currentPlayer.hand,
                this.lastPlayedHand,
                isFirstTurn,
                gameContext
            );

            setTimeout(() => {
                if (move) {
                    // Play
                    const res = this.playHand(currentPlayer.id, move);
                    if (res.success) {
                        if (res.roundOver) {
                            callback({ type: 'roundOver', roundWinner: res.roundWinner });
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
                lastPlayed: this.playerLastPlayed[p.id] || null,
                cumulativeScore: this.cumulativeScores[p.id] || 0
            })),
            currentTurn: this.players[this.currentTurnIndex]?.id,
            lastPlayedHand: this.lastPlayedHand,
            gameState: this.gameState,
            roundNumber: this.roundNumber,
            cumulativeScores: this.cumulativeScores
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
