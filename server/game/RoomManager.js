// server/game/RoomManager.js
const { Deck } = require('./Deck');
const { Big2Rules } = require('./Big2Rules');
const { BotLogic } = require('./BotLogic');
const { calculateDisplayRating, DEFAULT_MU, DEFAULT_SIGMA } = require('./RatingSystem');
const { getPointThreshold } = require('./GameModes');
const { DecisionAnalyzer } = require('./DecisionAnalyzer');

class Room {
    constructor(roomId, gameMode = 'standard') {
        this.id = roomId;
        this.players = []; // Array of { id, name, socket, hand, isBot, isDisconnected }
        this.hostUsername = null; // The username of the room host (first player to join)
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
        this.turnNumber = 0; // Track turn number within each round for decision tracking
        this.tier3DecisionTracking = {}; // Track Tier 3 decision data per player
        this.playOrder = 0; // Incrementing counter for z-index stacking order
        this.isPrivate = false; // Whether room is private (prevents random joins)
        this.password = null; // Room password for private rooms
        this.lastActivityTimestamp = Date.now(); // Track last activity for cleanup
        this.createdAt = Date.now(); // Track when room was created
        this.trickWinPending = false; // Flag to indicate a trick win is pending (delay before clearing)
        this.trickWinner = null; // The player who won the current trick
    }

    addPlayer(player) {
        if (this.players.length >= 4) return false;
        player.isDisconnected = false;
        this.players.push(player);

        // Update activity timestamp
        this.updateActivity();

        // Track by username for reconnection
        if (player.name && !player.isBot) {
            this.playersByUsername[player.name] = player;
            // Set the first non-bot player as the host
            if (!this.hostUsername) {
                this.hostUsername = player.name;
                console.log(`Room ${this.id}: ${player.name} is now the host`);
            }
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

        // Update activity timestamp
        this.updateActivity();

        // Find the player in the players array first
        const playerIndex = this.players.findIndex(p => p.name === username && !p.isBot);
        if (playerIndex === -1) {
            console.error(`ERROR: Player ${username} not found in players array during reconnect!`);
            return null;
        }

        // Update player's socket info directly in the array to ensure consistency
        this.players[playerIndex].id = newSocketId;
        this.players[playerIndex].socket = newSocket;
        this.players[playerIndex].isDisconnected = false;

        // Also update the reference (should be the same object, but being explicit)
        existingPlayer.id = newSocketId;
        existingPlayer.socket = newSocket;
        existingPlayer.isDisconnected = false;

        // Always update references that use the old socket ID
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

        // Update tier3 decision tracking
        if (this.tier3DecisionTracking && this.tier3DecisionTracking[oldId]) {
            this.tier3DecisionTracking[newSocketId] = this.tier3DecisionTracking[oldId];
            delete this.tier3DecisionTracking[oldId];
        }

        // Update round play stats
        if (this.roundPlayStats && this.roundPlayStats[oldId]) {
            this.roundPlayStats[newSocketId] = this.roundPlayStats[oldId];
            delete this.roundPlayStats[oldId];
        }

        // Update playersByUsername reference
        this.playersByUsername[username] = this.players[playerIndex];

        // Verify the player in the players array was updated
        const playerInArray = this.players.find(p => p.id === newSocketId);
        console.log(`After reconnect - player in array: ${playerInArray ? 'found' : 'NOT FOUND'}, hand: ${playerInArray?.hand?.length || 0} cards`);

        return this.players[playerIndex];
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

    // Remove a player from reconnection tracking (for intentional leaves)
    removeFromReconnectionTracking(socketId) {
        const player = this.players.find(p => p.id === socketId);
        if (player && player.name && !player.isBot) {
            delete this.playersByUsername[player.name];
            return player;
        }
        return null;
    }

    // Kick a player from the room (host only)
    kickPlayer(kickedPlayerId, requesterUsername) {
        // Only host can kick players
        if (requesterUsername !== this.hostUsername) {
            return { error: 'Only the host can kick players' };
        }

        const kickedPlayer = this.players.find(p => p.id === kickedPlayerId);
        if (!kickedPlayer) {
            return { error: 'Player not found' };
        }

        // Cannot kick bots
        if (kickedPlayer.isBot) {
            return { error: 'Cannot kick bots' };
        }

        // Cannot kick yourself
        if (kickedPlayer.name === requesterUsername) {
            return { error: 'Cannot kick yourself' };
        }

        // Remove from reconnection tracking
        this.removeFromReconnectionTracking(kickedPlayerId);

        // Replace with bot if game is in progress
        if (this.gameState === 'playing' || this.gameState === 'round_over') {
            const result = this.replaceWithBot(kickedPlayerId);
            if (result) {
                return {
                    success: true,
                    kickedPlayer: kickedPlayer,
                    replacedWithBot: true,
                    botPlayer: result.botPlayer
                };
            }
        } else {
            // Just remove from room if game hasn't started
            this.players = this.players.filter(p => p.id !== kickedPlayerId);
            return {
                success: true,
                kickedPlayer: kickedPlayer,
                replacedWithBot: false
            };
        }

        return { error: 'Failed to kick player' };
    }

    // Replace a disconnected player with a bot (for intentional leaves)
    replaceWithBot(socketId) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex === -1) return null;

        const oldPlayer = this.players[playerIndex];
        if (oldPlayer.isBot) return null; // Already a bot

        // Create a bot with Advanced difficulty to replace the player
        const botId = `bot_${Date.now()}_replacement`;
        const mu = 35; // Advanced bot rating
        const sigma = 3;
        const displayRating = calculateDisplayRating(mu, sigma);

        const botPlayer = {
            id: botId,
            name: `Bot (${oldPlayer.name})`,
            isBot: true,
            difficulty: 'advanced',
            rating_mu: mu,
            rating_sigma: sigma,
            rating: displayRating,
            hand: oldPlayer.hand, // Keep the same hand
            isDisconnected: false
        };

        // Replace the player in the array
        this.players[playerIndex] = botPlayer;

        // Update all references from old player ID to bot ID
        if (this.cumulativeScores[socketId] !== undefined) {
            this.cumulativeScores[botId] = this.cumulativeScores[socketId];
            delete this.cumulativeScores[socketId];
        }

        if (this.playerLastPlayed[socketId]) {
            this.playerLastPlayed[botId] = this.playerLastPlayed[socketId];
            this.playerLastPlayed[botId].playerId = botId;
            delete this.playerLastPlayed[socketId];
        }

        if (this.passedPlayers.has(socketId)) {
            this.passedPlayers.delete(socketId);
            this.passedPlayers.add(botId);
        }

        if (this.lastPlayedHand && this.lastPlayedHand.playerId === socketId) {
            this.lastPlayedHand.playerId = botId;
        }

        if (this.lastRoundWinnerId === socketId) {
            this.lastRoundWinnerId = botId;
        }

        // Update round play stats
        if (this.roundPlayStats && this.roundPlayStats[socketId]) {
            this.roundPlayStats[botId] = this.roundPlayStats[socketId];
            delete this.roundPlayStats[socketId];
        }

        // Update tier3 decision tracking
        if (this.tier3DecisionTracking && this.tier3DecisionTracking[socketId]) {
            delete this.tier3DecisionTracking[socketId];
        }

        // Remove from playersByUsername if it exists (they explicitly left)
        if (oldPlayer.name && this.playersByUsername[oldPlayer.name]) {
            delete this.playersByUsername[oldPlayer.name];
        }

        // If the host left, transfer host to the next non-bot player
        if (this.hostUsername === oldPlayer.name) {
            const newHost = this.players.find(p => !p.isBot && p !== botPlayer);
            if (newHost) {
                this.hostUsername = newHost.name;
                console.log(`Room ${this.id}: Host transferred to ${newHost.name}`);
            } else {
                // No other human players, host is now null (room will be deleted if all bots)
                this.hostUsername = null;
                console.log(`Room ${this.id}: No host remaining (all bots)`);
            }
        }

        console.log(`Replaced player ${oldPlayer.name} with bot at index ${playerIndex}`);
        return { oldPlayer, botPlayer, wasCurrentTurn: this.currentTurnIndex === playerIndex };
    }

    // Check if a player slot is available (including disconnected slots for new players)
    hasAvailableSlot() {
        return this.players.length < 4;
    }

    // Check if all players are bots
    hasOnlyBots() {
        return this.players.length > 0 && this.players.every(p => p.isBot);
    }

    // Check if room has any bots that can be replaced
    hasReplacableBots() {
        return this.players.some(p => p.isBot);
    }

    // Check if this is a single-player game (only 1 human player)
    isSinglePlayer() {
        const humanPlayers = this.players.filter(p => !p.isBot);
        return humanPlayers.length === 1;
    }

    // Update last activity timestamp
    updateActivity() {
        this.lastActivityTimestamp = Date.now();
    }

    // Get inactive duration in milliseconds
    getInactiveDuration() {
        return Date.now() - this.lastActivityTimestamp;
    }

    // Replace a bot with a human player
    replaceBot(newPlayer) {
        // Find the first bot in the players array
        const botIndex = this.players.findIndex(p => p.isBot);
        if (botIndex === -1) return { error: 'No bots available to replace' };

        const oldBot = this.players[botIndex];
        const botId = oldBot.id;

        // Create human player with bot's hand
        const humanPlayer = {
            id: newPlayer.id,
            name: newPlayer.name,
            socket: newPlayer.socket,
            rating: newPlayer.rating,
            hand: oldBot.hand, // Transfer the bot's hand to the human
            isBot: false,
            isDisconnected: false,
            joinedMidGame: true, // Mark as mid-game joiner (no stats will be recorded)
            joinedAtRound: this.roundNumber,
            joinedWithScore: this.cumulativeScores[botId] || 0
        };

        // Replace the bot in the array
        this.players[botIndex] = humanPlayer;

        // Update all references from bot ID to human player ID
        if (this.cumulativeScores[botId] !== undefined) {
            this.cumulativeScores[newPlayer.id] = this.cumulativeScores[botId];
            delete this.cumulativeScores[botId];
        }

        if (this.playerLastPlayed[botId]) {
            this.playerLastPlayed[newPlayer.id] = this.playerLastPlayed[botId];
            this.playerLastPlayed[newPlayer.id].playerId = newPlayer.id;
            delete this.playerLastPlayed[botId];
        }

        if (this.passedPlayers.has(botId)) {
            this.passedPlayers.delete(botId);
            this.passedPlayers.add(newPlayer.id);
        }

        if (this.lastPlayedHand && this.lastPlayedHand.playerId === botId) {
            this.lastPlayedHand.playerId = newPlayer.id;
        }

        if (this.lastRoundWinnerId === botId) {
            this.lastRoundWinnerId = newPlayer.id;
        }

        // Update round play stats
        if (this.roundPlayStats && this.roundPlayStats[botId]) {
            this.roundPlayStats[newPlayer.id] = this.roundPlayStats[botId];
            delete this.roundPlayStats[botId];
        }

        // Initialize tier3 decision tracking for the new human player
        if (this.tier3DecisionTracking && this.tier3DecisionTracking[botId]) {
            // Don't transfer bot decision tracking to human
            delete this.tier3DecisionTracking[botId];
        }

        // Add to playersByUsername for reconnection tracking
        this.playersByUsername[newPlayer.name] = humanPlayer;

        // Set host if there's none
        if (!this.hostUsername) {
            this.hostUsername = newPlayer.name;
            console.log(`Room ${this.id}: ${newPlayer.name} is now the host (replaced bot)`);
        }

        console.log(`Replaced bot ${oldBot.name} with human player ${newPlayer.name} at index ${botIndex}`);
        return {
            success: true,
            humanPlayer,
            oldBot,
            wasCurrentTurn: this.currentTurnIndex === botIndex
        };
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

        // Update activity timestamp
        this.updateActivity();

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
        // Update activity timestamp
        this.updateActivity();

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

        // Check for Hong Kong Dragon rule - player with all 13 different ranks wins immediately
        for (let player of this.players) {
            if (Big2Rules.isDragon(player.hand)) {
                // Dragon detected! This player wins the entire game immediately
                this.dragonWinner = player;
                this.gameState = 'dragon_win';
                return; // Exit early, don't set up normal round
            }
        }

        this.gameState = 'playing';
        this.lastPlayedHand = null;
        this.playerLastPlayed = {};
        this.passedPlayers = new Set();
        this.passes = 0;
        this.winners = [];
        this.playedCards = []; // Reset card tracking for new round
        this.turnNumber = 0; // Reset turn counter for new round
        this.playOrder = 0; // Reset play order for z-index stacking
        // DON'T reset tier3DecisionTracking - accumulate across all rounds in the game

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
        // Only allow changing mode in 'waiting' state
        if (this.gameState !== 'waiting') {
            return { error: 'Cannot change mode during game' };
        }

        this.gameMode = gameMode;
        this.pointThreshold = getPointThreshold(gameMode);
        return { success: true };
    }

    setPrivacy(isPrivate, password, requesterUsername) {
        // Only host can change privacy
        if (requesterUsername !== this.hostUsername) {
            return { error: 'Only the host can change privacy settings' };
        }

        this.isPrivate = isPrivate;
        // Set password only if room is private
        if (isPrivate && password) {
            this.password = password;
        } else {
            this.password = null;
        }
        return { success: true };
    }

    verifyPassword(password) {
        if (!this.isPrivate) return true; // Public rooms don't need password
        if (!this.password) return true; // Private room without password
        return this.password === password;
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

        // Update activity timestamp
        this.updateActivity();

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
        this.playOrder++; // Increment play order for z-index stacking
        this.playerLastPlayed[playerId] = { type: 'play', ...validatedHand, playerId, timestamp: Date.now(), playOrder: this.playOrder };

        // Check if this is a single Big 2 (2 of Spades) - auto-pass all other players
        const isSingleBig2 = validatedHand.type === 'SINGLE' &&
                             validatedHand.cards.length === 1 &&
                             validatedHand.cards[0].rank === '2' &&
                             validatedHand.cards[0].suit === 'S';

        if (isSingleBig2) {
            // Auto-pass all other players since Big 2 (2 of Spades) cannot be beaten as a single
            this.players.forEach(p => {
                if (p.id !== playerId) {
                    this.passedPlayers.add(p.id);
                    this.playOrder++;
                    this.playerLastPlayed[p.id] = { type: 'pass', playerId: p.id, timestamp: Date.now(), playOrder: this.playOrder };
                }
            });
            this.passes = 3; // All other players passed
        } else {
            this.passedPlayers.clear(); // Clear passed players as new card allows everyone to play
            this.passes = 0; // Reset consecutive pass counter
        }

        // Track played cards for card counting
        for (const card of handToPlay) {
            this.playedCards.push({ rank: card.rank, suit: card.suit, value: card.value });
        }

        // Track play stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            this.roundPlayStats[playerId].plays++;
            this.roundPlayStats[playerId].handTypes[validatedHand.type]++;
        }

        // Track Tier 3 decision quality (for human players only)
        if (!player.isBot) {
            const handValues = player.hand.map(c => c.value);
            const cardsInDeck = 52 - this.playedCards.length;
            const handStrength = DecisionAnalyzer.calculateHandStrength(handValues);
            const pileStrength = DecisionAnalyzer.calculatePileStrength(this.lastPlayedHand);

            const decision = DecisionAnalyzer.evaluateDecision({
                action: 'play',
                hand: handValues,
                pile: this.lastPlayedHand,
                cardsInDeck,
                playedCards: this.playedCards
            });

            if (!this.tier3DecisionTracking[playerId]) {
                this.tier3DecisionTracking[playerId] = {
                    decisions: [],
                    riskyPlays: 0,
                    optimalPlays: 0
                };
            }

            this.tier3DecisionTracking[playerId].decisions.push({
                round: this.roundNumber,
                turn: this.turnNumber,
                action: 'play',
                quality: decision.quality,
                isRisky: decision.isRisky,
                handSize: player.hand.length,
                cardsInDeck: cardsInDeck,
                handStrength: handStrength,
                pileStrength: pileStrength
            });

            if (decision.quality === 'optimal') {
                this.tier3DecisionTracking[playerId].optimalPlays++;
            }
            if (decision.isRisky) {
                this.tier3DecisionTracking[playerId].riskyPlays++;
            }
        }

        this.turnNumber++;

        // Check if player finished round
        if (player.hand.length === 0) {
            this.winners.push(player);
            this.gameState = 'round_over';
            this.lastRoundWinnerId = player.id;
            // Clear all displayed hands when round ends
            this.playerLastPlayed = {};
            this.lastPlayedHand = null;
            return { success: true, roundOver: true, roundWinner: player };
        }

        // If Big 2 was played, all others auto-passed, so give control back to this player
        if (isSingleBig2) {
            // Track lead success for advanced stats
            if (this.roundPlayStats[playerId]) {
                this.roundPlayStats[playerId].leadsWon++;
            }

            // Don't clear state immediately - set pending flag for delayed clear
            // This allows clients to see the Big 2 play and all the auto-passes before clearing
            this.trickWinPending = true;
            this.trickWinner = playerId;
            // Turn stays with the current player (they won the trick)
            return { success: true, wonTrick: true, trickWinDelay: true };
        }

        this.advanceTurn();
        return { success: true };
    }

    passTurn(playerId) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.currentTurnIndex) return { error: 'Not your turn' };

        if (!this.lastPlayedHand) return { error: 'Cannot pass on free turn' }; // Can't pass if you are leading

        // Update activity timestamp
        this.updateActivity();

        // Record that this player passed
        this.playOrder++; // Increment play order for z-index stacking
        this.playerLastPlayed[playerId] = { type: 'pass', playerId, timestamp: Date.now(), playOrder: this.playOrder };
        this.passedPlayers.add(playerId); // Mark player as passed for this round

        // Track pass stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            this.roundPlayStats[playerId].passes++;
        }

        // Track Tier 3 decision quality (for human players only)
        const player = this.players[playerIndex];
        if (!player.isBot) {
            const handValues = player.hand.map(c => c.value);
            const cardsInDeck = 52 - this.playedCards.length;
            const handStrength = DecisionAnalyzer.calculateHandStrength(handValues);
            const pileStrength = DecisionAnalyzer.calculatePileStrength(this.lastPlayedHand);

            const decision = DecisionAnalyzer.evaluateDecision({
                action: 'pass',
                hand: handValues,
                pile: this.lastPlayedHand,
                cardsInDeck,
                playedCards: this.playedCards
            });

            if (!this.tier3DecisionTracking[playerId]) {
                this.tier3DecisionTracking[playerId] = {
                    decisions: [],
                    riskyPlays: 0,
                    optimalPlays: 0
                };
            }

            this.tier3DecisionTracking[playerId].decisions.push({
                round: this.roundNumber,
                turn: this.turnNumber,
                action: 'pass',
                quality: decision.quality,
                isRisky: decision.isRisky,
                handSize: player.hand.length,
                cardsInDeck: cardsInDeck,
                handStrength: handStrength,
                pileStrength: pileStrength
            });

            if (decision.quality === 'optimal') {
                this.tier3DecisionTracking[playerId].optimalPlays++;
            }
        }

        this.turnNumber++;

        this.passes++;

        // Check if all other players (except the one who played last) have passed
        const lastPlayerId = this.lastPlayedHand.playerId;
        const activePlayers = this.players.filter(p => p.id !== lastPlayerId);
        const allOthersPassed = activePlayers.every(p => this.passedPlayers.has(p.id));

        if (allOthersPassed) {
            // Trick won - last player who played gets control
            // Track lead success for advanced stats
            if (this.roundPlayStats[lastPlayerId]) {
                this.roundPlayStats[lastPlayerId].leadsWon++;
            }

            // Don't clear state immediately - set pending flag for delayed clear
            // This allows clients to see all the passes and the winning hand before clearing
            this.trickWinPending = true;
            this.trickWinner = lastPlayerId;
            // Set turn to the player who won the trick
            this.currentTurnIndex = this.players.findIndex(p => p.id === lastPlayerId);
            return { success: true, trickWon: true, trickWinDelay: true };
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

    // Clear trick state after a delay - called by server after showing the trick win
    clearTrickState() {
        if (!this.trickWinPending) return false;

        this.lastPlayedHand = null;
        this.playerLastPlayed = {}; // Clear all displayed hands
        this.passedPlayers = new Set(); // Clear passed players
        this.passes = 0;
        this.playOrder = 0; // Reset play order for new trick
        this.trickWinPending = false;
        this.trickWinner = null;

        return true;
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
                                callback({
                                    type: 'play',
                                    playerId: currentPlayer.id,
                                    reasoning: this.lastBotReasoning,
                                    trickWinDelay: res.trickWinDelay || false
                                });
                            }
                        }
                    } else {
                        // Pass
                        const res = this.passTurn(currentPlayer.id);
                        callback({
                            type: 'pass',
                            playerId: currentPlayer.id,
                            reasoning: this.lastBotReasoning,
                            trickWinDelay: res.trickWinDelay || false
                        });
                    }
                }, 250); // 250ms delay for realism (reduced from 500ms for better responsiveness)
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
            hostUsername: this.hostUsername,
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
            pointThreshold: this.pointThreshold,
            isPrivate: this.isPrivate,
            hasPassword: !!this.password,
            trickWinPending: this.trickWinPending || false,
            trickWinner: this.trickWinner
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

    deleteRoom(roomId) {
        return this.rooms.delete(roomId);
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

    // Find which room a socket is in (ignores disconnected players)
    findRoomBySocketId(socketId) {
        for (const [roomId, room] of this.rooms) {
            const player = room.players.find(p => p.id === socketId && !p.isDisconnected);
            if (player) {
                return { roomId, room, player };
            }
        }
        return null;
    }

    // Find all rooms that a username is in (connected or disconnected)
    findAllRoomsByUsername(username) {
        const foundRooms = [];
        for (const [roomId, room] of this.rooms) {
            const player = room.players.find(p => p.name === username && !p.isBot);
            if (player) {
                foundRooms.push({ roomId, room, player });
            }
        }
        return foundRooms;
    }

    // Get all rooms that can be joined (have bots and are in progress, not private)
    getJoinableRooms() {
        const joinableRooms = [];
        for (const [roomId, room] of this.rooms) {
            if (!room.isPrivate && room.hasReplacableBots() && (room.gameState === 'playing' || room.gameState === 'round_over')) {
                joinableRooms.push({
                    roomId,
                    gameState: room.gameState,
                    playerCount: room.players.length,
                    botCount: room.players.filter(p => p.isBot).length,
                    roundNumber: room.roundNumber,
                    gameMode: room.gameMode,
                    players: room.players.map(p => ({
                        name: p.name,
                        isBot: p.isBot,
                        rating: p.rating
                    }))
                });
            }
        }
        return joinableRooms;
    }

    // Clean up inactive rooms based on type
    cleanupInactiveRooms() {
        const roomsToDelete = [];

        // Timeout constants (in milliseconds)
        const SINGLE_PLAYER_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
        const MULTIPLAYER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        const WAITING_ROOM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        const FINISHED_GAME_TIMEOUT = 5 * 60 * 1000; // 5 minutes

        for (const [roomId, room] of this.rooms) {
            const inactiveDuration = room.getInactiveDuration();
            let shouldDelete = false;
            let reason = '';

            // Rule 1: All bots - delete immediately
            if (room.hasOnlyBots()) {
                shouldDelete = true;
                reason = 'all bots';
            }
            // Rule 2: Finished games - delete after 5 minutes
            else if (room.gameState === 'finished' && inactiveDuration > FINISHED_GAME_TIMEOUT) {
                shouldDelete = true;
                reason = 'finished game timeout';
            }
            // Rule 3: Waiting rooms - delete after 30 minutes
            else if (room.gameState === 'waiting' && inactiveDuration > WAITING_ROOM_TIMEOUT) {
                shouldDelete = true;
                reason = 'waiting room timeout';
            }
            // Rule 4: Single-player games - delete after 24 hours
            else if (room.isSinglePlayer() && inactiveDuration > SINGLE_PLAYER_TIMEOUT) {
                shouldDelete = true;
                reason = 'single-player timeout (24h)';
            }
            // Rule 5: Multiplayer games - delete after 30 minutes
            else if (!room.isSinglePlayer() && (room.gameState === 'playing' || room.gameState === 'round_over') && inactiveDuration > MULTIPLAYER_TIMEOUT) {
                shouldDelete = true;
                reason = 'multiplayer timeout (30min)';
            }

            if (shouldDelete) {
                roomsToDelete.push({ roomId, reason, room });
            }
        }

        // Delete marked rooms
        for (const { roomId, reason, room } of roomsToDelete) {
            this.deleteRoom(roomId);
            console.log(`[Cleanup] Deleted room ${roomId}: ${reason} (inactive for ${Math.round(room.getInactiveDuration() / 60000)}min)`);
        }

        return roomsToDelete.length;
    }
}


module.exports = { RoomManager, Room };
