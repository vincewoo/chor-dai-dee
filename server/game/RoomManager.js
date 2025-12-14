// server/game/RoomManager.js
const { Deck } = require('./Deck');
const { Big2Rules } = require('./Big2Rules');
const { BotLogic } = require('./BotLogic');
const { calculateDisplayRating, DEFAULT_MU, DEFAULT_SIGMA } = require('./RatingSystem');
const { getPointThreshold } = require('./GameModes');

class Room {
    constructor(roomId, gameMode = 'standard') {
        this.id = roomId;
        this.players = []; // Array of { id, name, socket, hand, isBot, isDisconnected }
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
        this.playedCards = []; // Track all cards played this round for card counting
        this.debugMode = false; // Enable bot reasoning capture
        this.lastBotReasoning = null; // Store the most recent bot decision reasoning
        this.playersByUsername = {}; // Map username -> player for reconnection
        this.settings = { useAdvancedBots: false }; // Room settings
        this.gameMode = gameMode; // Game mode: 'short' or 'standard'
        this.pointThreshold = getPointThreshold(gameMode); // Point threshold for game over
        this.roundPlayStats = {}; // Track plays/passes per round for advanced stats
        this.gameId = `game_${Date.now()}_${Math.random().toString(36).substring(7)}`; // Unique game ID for round tracking
    }

    addPlayer(player) {
        if (this.players.length >= 4) return false;
        player.isDisconnected = false;
        this.players.push(player);
        // Track by username for reconnection
        if (player.name && !player.isBot) {
            this.playersByUsername[player.name] = player;
        }
        return true;
    }

    // Check if a username can reconnect to this room
    canReconnect(username) {
        const existingPlayer = this.playersByUsername[username];
        return existingPlayer && existingPlayer.isDisconnected;
    }

    // Reconnect a player with a new socket
    reconnectPlayer(username, newSocketId, newSocket) {
        const existingPlayer = this.playersByUsername[username];
        if (!existingPlayer) return null;

        const oldId = existingPlayer.id;
        console.log(`Reconnecting ${username}: old ID=${oldId}, new ID=${newSocketId}, hand size=${existingPlayer.hand ? existingPlayer.hand.length : 0}`);

        // Update player's socket info
        existingPlayer.id = newSocketId;
        existingPlayer.socket = newSocket;
        existingPlayer.isDisconnected = false;

        // Update references that use the old socket ID
        if (this.cumulativeScores[oldId] !== undefined) {
            this.cumulativeScores[newSocketId] = this.cumulativeScores[oldId];
            delete this.cumulativeScores[oldId];
        }

        if (this.playerLastPlayed[oldId]) {
            this.playerLastPlayed[newSocketId] = this.playerLastPlayed[oldId];
            this.playerLastPlayed[newSocketId].playerId = newSocketId;
            delete this.playerLastPlayed[oldId];
        }

        if (this.passedPlayers.has(oldId)) {
            this.passedPlayers.delete(oldId);
            this.passedPlayers.add(newSocketId);
        }

        if (this.lastPlayedHand && this.lastPlayedHand.playerId === oldId) {
            this.lastPlayedHand.playerId = newSocketId;
        }

        if (this.lastRoundWinnerId === oldId) {
            this.lastRoundWinnerId = newSocketId;
        }

        // Update playersByUsername reference
        this.playersByUsername[username] = existingPlayer;

        // Verify the player in the players array was updated
        const playerInArray = this.players.find(p => p.id === newSocketId);
        console.log(`After reconnect - player in array: ${playerInArray ? 'found' : 'NOT FOUND'}, hand: ${playerInArray?.hand?.length || 0} cards`);

        return existingPlayer;
    }

    // Mark a player as disconnected
    markDisconnected(socketId) {
        const player = this.players.find(p => p.id === socketId);
        if (player && !player.isBot) {
            player.isDisconnected = true;
            return player;
        }
        return null;
    }

    // Check if a player slot is available (including disconnected slots for new players)
    hasAvailableSlot() {
        return this.players.length < 4;
    }

    // Get disconnected player by socket ID
    getDisconnectedPlayer(socketId) {
        return this.players.find(p => p.id === socketId && p.isDisconnected);
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    getLastBotReasoning() {
        return this.lastBotReasoning;
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

    startGame(useAdvancedBots = false) {
        this.settings.useAdvancedBots = useAdvancedBots;

        if (this.players.length < 4) {
            // Auto-fill with bots if < 4
            while (this.players.length < 4) {
                const botId = `bot_${Date.now()}_${this.players.length}`;

                // Set ratings based on bot type
                // Regular bot: Default rating (conservatively 0 -> 1200)
                // Advanced bot: Higher rating. mu=35, sigma=3 -> conservative 26 -> 2240

                let mu, sigma;
                if (useAdvancedBots) {
                    mu = 35;
                    sigma = 3;
                } else {
                    mu = DEFAULT_MU;
                    sigma = DEFAULT_SIGMA;
                }

                const displayRating = calculateDisplayRating(mu, sigma);

                this.players.push({
                    id: botId,
                    name: `${useAdvancedBots ? 'Advanced ' : ''}Bot ${this.players.length + 1}`,
                    isBot: true,
                    difficulty: useAdvancedBots ? 'advanced' : 'easy',
                    rating_mu: mu,
                    rating_sigma: sigma,
                    rating: displayRating
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
        this.playedCards = []; // Reset card tracking for new round

        // Initialize round play stats for advanced stats tracking
        this.roundPlayStats = {};
        this.players.forEach(p => {
            this.roundPlayStats[p.id] = {
                plays: 0,
                passes: 0,
                leadsWon: 0, // Count of times player won control of table
                handTypes: {
                    SINGLE: 0,
                    PAIR: 0,
                    TRIPLE: 0,
                    STRAIGHT: 0,
                    FLUSH: 0,
                    FULL_HOUSE: 0,
                    QUADS: 0,
                    STRAIGHT_FLUSH: 0
                }
            };
        });

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

        // Check if anyone hit the point threshold
        const gameOver = Object.values(this.cumulativeScores).some(score => score >= this.pointThreshold);
        return gameOver;
    }

    setGameMode(gameMode) {
        if (this.gameState !== 'waiting') {
            return { error: 'Cannot change mode during game' };
        }
        this.gameMode = gameMode;
        this.pointThreshold = getPointThreshold(gameMode);
        return { success: true };
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

        // Track played cards for card counting
        for (const card of handToPlay) {
            this.playedCards.push({ rank: card.rank, suit: card.suit, value: card.value });
        }

        // Track play stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            this.roundPlayStats[playerId].plays++;
            this.roundPlayStats[playerId].handTypes[validatedHand.type]++;
        }

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

        // Track pass stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            this.roundPlayStats[playerId].passes++;
        }

        this.passes++;

        // Check if all other players (except the one who played last) have passed
        const lastPlayerId = this.lastPlayedHand.playerId;
        const activePlayers = this.players.filter(p => p.id !== lastPlayerId);
        const allOthersPassed = activePlayers.every(p => this.passedPlayers.has(p.id));

        if (allOthersPassed) {
            // Round won - last player who played gets control
            // Track lead success for advanced stats
            if (this.roundPlayStats[lastPlayerId]) {
                this.roundPlayStats[lastPlayerId].leadsWon++;
            }

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
                passCount: this.passes,
                // All cards played this round (for card counting)
                playedCards: [...this.playedCards]
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

            const handleBotMove = (move, reasoning) => {
                // Store reasoning if in debug mode
                if (this.debugMode && reasoning) {
                    this.lastBotReasoning = {
                        botId: currentPlayer.id,
                        botName: currentPlayer.name,
                        timestamp: Date.now(),
                        ...reasoning
                    };
                }

                setTimeout(() => {
                    if (move) {
                        // Play
                        const res = this.playHand(currentPlayer.id, move);
                        if (res.success) {
                            if (res.roundOver) {
                                callback({ type: 'roundOver', roundWinner: res.roundWinner, reasoning: this.lastBotReasoning });
                            } else {
                                callback({ type: 'play', playerId: currentPlayer.id, reasoning: this.lastBotReasoning });
                            }
                        }
                    } else {
                        // Pass
                        this.passTurn(currentPlayer.id);
                        callback({ type: 'pass', playerId: currentPlayer.id, reasoning: this.lastBotReasoning });
                    }
                }, 1000); // 1s delay for realism
            };

            // Choose bot logic based on settings
            if (this.settings.useAdvancedBots) {
                BotLogic.getAdvancedBotMove(
                    currentPlayer.hand,
                    this.lastPlayedHand,
                    isFirstTurn,
                    gameContext
                ).then(move => {
                    // Advanced bot currently doesn't return detailed reasoning structure in the same way
                    handleBotMove(move, { model: 'PPO-Big2', note: 'Advanced Bot Decision' });
                }).catch(err => {
                    console.error('Error getting advanced bot move:', err);
                    // Fallback to basic bot
                    const result = BotLogic.getBotMove(currentPlayer.hand, this.lastPlayedHand, isFirstTurn, gameContext, this.debugMode);
                    const move = this.debugMode ? result.cards : result;
                    const reasoning = this.debugMode ? result.reasoning : null;
                    handleBotMove(move, reasoning);
                });
            } else {
                // Legacy Bot
                const result = BotLogic.getBotMove(
                    currentPlayer.hand,
                    this.lastPlayedHand,
                    isFirstTurn,
                    gameContext,
                    this.debugMode // Pass debug mode flag
                );

                // Extract move and reasoning based on debug mode
                const move = this.debugMode ? result.cards : result;
                const reasoning = this.debugMode ? result.reasoning : null;
                handleBotMove(move, reasoning);
            }
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
                isDisconnected: p.isDisconnected || false,
                lastPlayed: this.playerLastPlayed[p.id] || null,
                cumulativeScore: this.cumulativeScores[p.id] || 0,
                rating: p.rating
            })),
            currentTurn: this.players[this.currentTurnIndex]?.id,
            lastPlayedHand: this.lastPlayedHand,
            gameState: this.gameState,
            roundNumber: this.roundNumber,
            cumulativeScores: this.cumulativeScores,
            debugMode: this.debugMode,
            gameMode: this.gameMode,
            pointThreshold: this.pointThreshold
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

    // Find a room where this username can reconnect
    findRoomForReconnect(username) {
        for (const [roomId, room] of this.rooms) {
            if (room.canReconnect(username)) {
                return { roomId, room };
            }
        }
        return null;
    }

    // Find which room a socket is in
    findRoomBySocketId(socketId) {
        for (const [roomId, room] of this.rooms) {
            const player = room.players.find(p => p.id === socketId);
            if (player) {
                return { roomId, room, player };
            }
        }
        return null;
    }
}

module.exports = { RoomManager, Room };
