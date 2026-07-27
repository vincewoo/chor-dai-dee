// server/game/RoomManager.js
const { Deck } = require('./Deck');
const { Big2Rules } = require('./Big2Rules');
const { BotLogic, BOT_LOGIC_VERSION } = require('./BotLogic');
const { calculateDisplayRating, DEFAULT_MU, DEFAULT_SIGMA } = require('./RatingSystem');
const { getPointThreshold } = require('./GameModes');
const { DecisionAnalyzer } = require('./DecisionAnalyzer');
const { rankTable, playsNeeded, BASELINE_VERSION } = require('./DealStrength');
const { buildGameContext } = require('./BotContext');
const { evaluateMove } = require('./MoveQuality');
const Coach = require('./Coach');
const { GameTape } = require('./GameTape');
const { SOURCE, FLAG, clampThinkMs } = require('./TapeCodec');

// Praise notes the coach may hand one player in one round. Corrections are
// unlimited - a mistake is worth hearing about whenever it happens - but an owl
// that applauds every good move stops being read after the second one.
const COACH_CREDITS_PER_ROUND = 1;

// Aces and 2s: the cards that buy tricks. BotLogic's retention model prices
// them far above everything else, so where a player's copies end up is the
// clearest read available on control-card management.
const CONTROL_RANKS = new Set(['A', '2']);
const countControls = (cards) => cards.filter(c => CONTROL_RANKS.has(c.rank)).length;

class Room {
    constructor(roomId, gameMode = 'short') {
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
        this.trickHistory = []; // Ordered plays/passes this round, for bot opponent modelling
        this.debugMode = false; // Enable bot reasoning capture
        this.lastBotReasoning = null; // Store the most recent bot decision reasoning
        // Players with the coach turned on, by player id. Held per-room rather
        // than read from the account preference so it follows the socket: the
        // preference says what a player wants, this says which live seats are
        // currently paying for the extra evaluation.
        this.coachSeats = new Set();
        // Praise notes still in budget this round, by player id. Errors are
        // always worth a word; congratulation repeated every few turns is
        // noise, so credit kinds are rationed. See Coach.react.
        this.coachCredits = {};
        this.playersByUsername = {}; // Map username -> player for reconnection
        this.gameMode = gameMode; // Game mode: 'short' or 'standard'
        this.pointThreshold = getPointThreshold(gameMode); // Point threshold for game over
        this.roundPlayStats = {}; // Track plays/passes per round for advanced stats
        // Rounds won so far in the current GAME. Keyed by name, not player id:
        // roundPlayStats is rebuilt every round and ids change on reconnect and
        // on bot/human swaps, whereas a name is stable and unique in a room.
        this.roundsWonByName = {};
        // Deal strength per player for the current round, keyed by player id.
        // Server-side only while the round is live: `rank` is derived from all
        // four hands and would leak opponents' holdings. See DealStrength.js.
        this.roundDealStrength = {};
        this.gameId = `game_${Date.now()}_${Math.random().toString(36).substring(7)}`; // Unique game ID for round tracking
        this.turnNumber = 0; // Track turn number within each round for decision tracking
        this.tier3DecisionTracking = {}; // Track Tier 3 decision data per player
        // Risky plays awaiting an outcome, keyed by player id. A risky play
        // succeeded if nobody beat it before the trick resolved. Holds
        // references into tier3DecisionTracking, so resolving one writes
        // through to the decision record itself.
        this.pendingRiskyDecisions = {};
        // Control cards riding on an unresolved trick, keyed by player id.
        this.pendingControlPlays = {};
        this.playOrder = 0; // Incrementing counter for z-index stacking order
        this.isPrivate = false; // Whether room is private (prevents random joins)
        this.lastActivityTimestamp = Date.now(); // Track last activity for cleanup
        this.createdAt = Date.now(); // Track when room was created
        this.trickWinPending = false; // Flag to indicate a trick win is pending (delay before clearing)
        this.trickWinner = null; // The player who won the current trick
        this.trickIndex = 0; // Tricks resolved this round, for tricks-contested counting
        this.lastRoundResults = null; // Store round results for reconnection handling
        this.lastGameResults = null; // Store game over results for reconnection handling

        // Spectators watch the game read-only. Keyed by username (not socket id) so a
        // spectator survives a reconnect without the socket-id migration that players
        // need in reconnectPlayer() - spectators own no game state to migrate.
        this.spectators = new Map(); // username -> { username, socketId, socket, isGuest, forcedMute }
        this.spectatorsMutedAll = false; // Host toggle: mute every spectator's mic

        // Post-game state for rematch/lobby flow
        this.postGameReadyPlayers = new Set(); // Players who clicked "Ready" after game ends

        // Timeout management to prevent race conditions
        this.pendingTimeouts = new Map(); // Map of timeout type -> timeout ID
        this.trickWinGeneration = 0; // Generation counter for trick win timeouts
        this.isBotThinking = false; // Flag to prevent multiple bot turn calculations
        this.roundTransitionInProgress = false; // Flag to prevent multiple next_round calls

        // ---- Game-log recording ----
        // Pure in-memory buffer. RoomManager stays free of persistence; index.js
        // drains this and owns every gamelog call, matching how db.js is used.
        this.tape = new GameTape();
        this.gameKey = null;          // surrogate key assigned by the store
        this.previousGameId = null;   // set before gameId is regenerated, to link chains
        this.chainKind = null;        // 'rematch' | 'lobby_restart'

        // Turn timing for think_ms. Reset wherever a seat acquires the turn.
        this.turnStartedAt = Date.now();
        this.turnDisconnectBaseline = 0;
        this.turnStartedDisconnected = false;
    }

    /**
     * Marks the moment the current seat acquired the turn.
     *
     * think_ms is measured from here, and the disconnect baseline is snapshotted
     * here so a drop during the turn can be detected directly rather than
     * inferred from a suspiciously long duration.
     */
    markTurnStart() {
        this.turnStartedAt = Date.now();
        const player = this.players[this.currentTurnIndex];
        this.turnDisconnectBaseline = player ? (player.disconnectCount || 0) : 0;
        this.turnStartedDisconnected = Boolean(player && player.isDisconnected);
    }

    /**
     * think_ms and flags for the acting player.
     *
     * Bots get null rather than 0: they run on a fixed 250 ms timer, so any
     * number would be a property of the server, not of a decision. Zero would
     * be a real trainable value; null means "not applicable".
     */
    turnTiming(player) {
        if (!player || player.isBot) return { thinkMs: null, flags: 0 };

        const { thinkMs, clamped } = clampThinkMs(Date.now() - this.turnStartedAt);
        let flags = clamped ? FLAG.THINK_CLAMPED : 0;

        const dropped = (player.disconnectCount || 0) !== this.turnDisconnectBaseline;
        if (this.turnStartedDisconnected || dropped) flags |= FLAG.TURN_DISCONNECTED;

        return { thinkMs, flags };
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
        // Only migrate if the ID actually changed (avoid deleting score when oldId === newSocketId)
        if (oldId !== newSocketId) {
            this.cumulativeScores[newSocketId] = this.cumulativeScores[oldId] || 0;
            if (this.cumulativeScores[oldId] !== undefined) {
                delete this.cumulativeScores[oldId];
            }
        }

        if (oldId !== newSocketId) {
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
            // Monotonic, so a turn can detect a drop-and-reconnect that resolved
            // before the player acted. isDisconnected alone would read false by
            // then and the turn would look like ordinary slow thinking.
            player.disconnectCount = (player.disconnectCount || 0) + 1;
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

    // ============ Spectator Methods ============

    // Add (or refresh) a spectator. Upserts by username so repeated spectate_room
    // emits (socket reconnect, double-fire) are idempotent, and so a reconnecting
    // spectator keeps any host-applied mute.
    addSpectator({ username, socketId, socket, isGuest }) {
        if (!username) return { error: 'Missing username' };

        // Can't spectate a room you're seated in. A disconnected player still holds
        // their seat, but letting them watch while disconnected is harmless and
        // useful, so only block currently-connected players.
        const seated = this.playersByUsername[username];
        if (seated && !seated.isDisconnected) {
            return { error: 'You are already playing in this room' };
        }

        const existing = this.spectators.get(username);
        this.spectators.set(username, {
            username,
            socketId,
            socket,
            isGuest: isGuest || false,
            // Preserve mute across reconnect so toggling the connection isn't a bypass
            forcedMute: existing ? existing.forcedMute : false
        });

        this.updateActivity();
        return { success: true, previousSocketId: existing ? existing.socketId : null };
    }

    removeSpectator(username) {
        return this.spectators.delete(username);
    }

    getSpectatorBySocketId(socketId) {
        for (const spec of this.spectators.values()) {
            if (spec.socketId === socketId) return spec;
        }
        return null;
    }

    isSpectator(socketId) {
        return this.getSpectatorBySocketId(socketId) !== null;
    }

    // Public roster - safe to broadcast, contains no hand data.
    getSpectatorList() {
        return Array.from(this.spectators.values()).map(s => ({
            username: s.username,
            isGuest: s.isGuest,
            forcedMute: s.forcedMute || false
        }));
    }

    // Every player's hand, keyed by player id so clients can join against
    // getGameState().players[].id. ONLY for delivery to spectators.
    getAllHands() {
        const hands = {};
        for (const p of this.players) {
            hands[p.id] = p.hand || [];
        }
        return hands;
    }

    // A spectator's effective mute state (global toggle OR individual mute).
    isSpectatorMuted(username) {
        const spec = this.spectators.get(username);
        if (!spec) return false;
        return this.spectatorsMutedAll || spec.forcedMute;
    }

    shouldPreserveForSpectators() {
        return this.spectators.size > 0;
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

        const botId = `bot_${Date.now()}_replacement`;

        const botPlayer = {
            id: botId,
            name: `Bot (${oldPlayer.name})`,
            isBot: true,
            rating_mu: DEFAULT_MU,
            rating_sigma: DEFAULT_SIGMA,
            rating: calculateDisplayRating(DEFAULT_MU, DEFAULT_SIGMA),
            hand: oldPlayer.hand, // Keep the same hand
            isDisconnected: false
        };

        // Replace the player in the array
        this.players[playerIndex] = botPlayer;

        // Update all references from old player ID to bot ID
        // Always initialize score for the new bot ID (default to 0 if old score doesn't exist)
        this.cumulativeScores[botId] = this.cumulativeScores[socketId] || 0;
        if (this.cumulativeScores[socketId] !== undefined) {
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
        // Clear any pending bot move timeout to prevent race conditions
        this.clearTimeout('botMove');
        this.isBotThinking = false;

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
        // Always initialize score for the new player ID (default to 0 if bot score doesn't exist)
        this.cumulativeScores[newPlayer.id] = this.cumulativeScores[botId] || 0;
        if (this.cumulativeScores[botId] !== undefined) {
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

        // Update cached round/game results to reflect the new player name
        // This fixes the scoreboard showing stale bot names after replacement
        if (this.lastRoundResults && this.lastRoundResults.scores) {
            this.lastRoundResults.scores = this.lastRoundResults.scores.map(s => {
                if (s.id === botId) {
                    return { ...s, id: newPlayer.id, name: newPlayer.name, isBot: false };
                }
                return s;
            });
            // Update round winner if it was the replaced bot
            if (this.lastRoundResults.roundWinner && this.lastRoundResults.roundWinner.id === botId) {
                this.lastRoundResults.roundWinner = {
                    ...this.lastRoundResults.roundWinner,
                    id: newPlayer.id,
                    name: newPlayer.name,
                    isBot: false
                };
            }
        }

        if (this.lastGameResults && this.lastGameResults.scores) {
            this.lastGameResults.scores = this.lastGameResults.scores.map(s => {
                if (s.id === botId) {
                    return { ...s, id: newPlayer.id, name: newPlayer.name, isBot: false };
                }
                return s;
            });
            // Update game winner if it was the replaced bot
            if (this.lastGameResults.winner && this.lastGameResults.winner.id === botId) {
                this.lastGameResults.winner = {
                    ...this.lastGameResults.winner,
                    id: newPlayer.id,
                    name: newPlayer.name,
                    isBot: false
                };
            }
            // Update finalScores mapping (keyed by player ID)
            if (this.lastGameResults.finalScores && this.lastGameResults.finalScores[botId] !== undefined) {
                this.lastGameResults.finalScores[newPlayer.id] = this.lastGameResults.finalScores[botId];
                delete this.lastGameResults.finalScores[botId];
            }
        }

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

    startGame() {
        // Update activity timestamp
        this.updateActivity();

        if (this.players.length < 4) {
            // Auto-fill with bots if < 4
            while (this.players.length < 4) {
                const botId = `bot_${Date.now()}_${this.players.length}`;

                this.players.push({
                    id: botId,
                    // The bot's name is a policy parameter, not a label:
                    // BotLogic.getBotProfile derives its temperament from it.
                    name: `Bot ${this.players.length + 1}`,
                    isBot: true,
                    rating_mu: DEFAULT_MU,
                    rating_sigma: DEFAULT_SIGMA,
                    rating: calculateDisplayRating(DEFAULT_MU, DEFAULT_SIGMA)
                });
            }
        }

        // Initialize cumulative scores for all players (only on first game start)
        if (this.roundNumber === 0) {
            this.players.forEach(p => {
                this.cumulativeScores[p.id] = 0;
            });
            // Per-game counters. roundNumber === 0 is the only "a new game is
            // starting" signal a room gets -- both startRematch() and the lobby
            // restart come back through here.
            this.roundsWonByName = {};
            // Decisions accumulate across the rounds of one game and are
            // flushed at game end. Nothing cleared them between games, so a
            // rematch re-counted the previous game's decisions and re-inserted
            // them under the new game id.
            this.tier3DecisionTracking = {};
            this.pendingRiskyDecisions = {};
            this.pendingControlPlays = {};
        }

        this.roundNumber++;
        this.startRound();
        return this.getGameState();
    }

    startRound() {
        // Update activity timestamp
        this.updateActivity();

        // Reset bot thinking flag and round transition flag for new round
        this.isBotThinking = false;
        this.roundTransitionInProgress = false;

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

        // Score the deal before anything is played. Deliberately ahead of the
        // dragon check below, which returns early: a dragon is by definition
        // the strongest possible deal, and dropping those rounds would bias the
        // top tier of the baseline.
        this.recordDealStrength();

        // Check for Hong Kong Dragon rule - player with all 13 different ranks wins immediately
        for (let player of this.players) {
            if (Big2Rules.isDragon(player.hand)) {
                // Dragon detected! This player wins the entire game immediately
                this.dragonWinner = player;
                this.gameState = 'dragon_win';
                // Record the deal anyway. A 13-distinct-rank hand is a genuine
                // ~1-in-millions datum, it explains an otherwise inexplicable
                // game outcome, and omitting it would bias the deal
                // distribution in the corpus.
                this.tape.beginRound({
                    roundNumber: this.roundNumber,
                    hands: this.players.map(p => p.hand),
                    startSeat: this.players.indexOf(player)
                });
                this.tape.endRound({
                    endReason: 'dragon',
                    winnerSeat: this.players.indexOf(player),
                    cardsLeft: this.players.map(p => p.hand.length)
                });
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
        // Every play and pass this round, in order. Unlike lastPlayedHand and
        // passedPlayers this survives trick boundaries, so a bot taking the
        // lead can still see what each opponent declined to beat - the single
        // most useful read available and previously discarded at trick end.
        this.trickHistory = [];
        this.turnNumber = 0; // Reset turn counter for new round
        // Praise budget is per round, so a long game does not accumulate one
        // silent owl who used its only compliment in round one.
        this.coachCredits = {};
        this.playOrder = 0; // Reset play order for z-index stacking
        // DON'T reset tier3DecisionTracking - accumulate across all rounds in the game

        // A new deal starts no trick, so nothing can still be pending.
        this.pendingRiskyDecisions = {};
        this.pendingControlPlays = {};
        this.trickIndex = 0;

        // Initialize round play stats for advanced stats tracking
        this.roundPlayStats = {};
        this.players.forEach(p => {
            this.roundPlayStats[p.id] = {
                plays: 0,
                passes: 0,
                leadsWon: 0, // Count of times player won control of table
                // Tricks this player played into at least once -- the
                // denominator leadsWon is a share of. Counting every play
                // instead would ask "how often does a card win the trick",
                // which is a different (and much smaller) number.
                tricksContested: 0,
                lastTrickCounted: -1,
                // Aces and 2s committed, and how many of them actually bought
                // the trick they were spent on.
                controlsPlayed: 0,
                controlsWon: 0,
                // Fewest cards held at any point this round. Reaching the
                // endgame and not converting is a different failure from never
                // getting there.
                minHandSize: 13,
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

        // Record the deal now that the opening seat is known. Everything else
        // about this round is re-derivable from the deal plus the plies below.
        this.tape.beginRound({
            roundNumber: this.roundNumber,
            hands: this.players.map(p => p.hand),
            startSeat: this.currentTurnIndex
        });
        this.markTurnStart();
    }

    /**
     * Score every dealt hand and rank them against each other, for the
     * deal-strength stats. Called once per round, immediately after the deal.
     *
     * Also captures how many human opponents were at the table, because a round
     * against three bots is not the same test as a round against three humans -
     * the stats layer reports the two separately rather than mixing them.
     */
    recordDealStrength() {
        this.roundDealStrength = {};
        const humanCount = this.players.filter(p => !p.isBot).length;
        const scored = rankTable(this.players.map(p => p.hand));

        this.players.forEach((player, seat) => {
            this.roundDealStrength[player.id] = {
                ...scored[seat],
                // Opponents only, so a player's own seat never counts itself.
                humanOpponents: humanCount - (player.isBot ? 0 : 1),
                // Fewest plays this hand could ever go out in. Compared against
                // the plays actually used, it says whether the hand was kept
                // together or broken up.
                playsNeeded: playsNeeded(player.hand),
                // Aces and 2s dealt. Where they end up - taking a trick, spent
                // without taking one, or still in hand - is the control economy.
                controls: countControls(player.hand),
                baselineVersion: BASELINE_VERSION
            };
        });
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

    setPrivacy(isPrivate, requesterUsername) {
        // Only host can change privacy
        if (requesterUsername !== this.hostUsername) {
            return { error: 'Only the host can change privacy settings' };
        }

        this.isPrivate = isPrivate;
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

        // Block actions during trick win delays for players who didn't win the trick
        if (this.trickWinPending) {
            // Only the trick winner can play during the delay (free play)
            if (this.trickWinner !== playerId) {
                console.log(`[DEBUG playHand] Blocking play from ${playerId} during trick win delay. Winner is ${this.trickWinner}`);
                return { error: 'Wait for current trick to clear' };
            }

            // Trick winner is playing - clear the trick state immediately
            console.log(`[DEBUG playHand] Trick winner ${playerId} playing during delay. Clearing trick state immediately.`);

            // Cancel the pending timeout
            this.clearTimeout('trickWin');

            // Clear the trick state
            this.lastPlayedHand = null;
            this.playerLastPlayed = {}; // Clear all displayed hands
            this.passedPlayers = new Set(); // Clear passed players
            this.passes = 0;
            this.playOrder = 0; // Reset play order for new trick
            this.trickWinPending = false;
            this.trickWinner = null;
            this.trickWinGeneration++; // Increment generation to invalidate pending timeout
        }

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
        console.log(`[DEBUG playHand] Player ${player.name} attempting ${validatedHand.type}. lastPlayedHand=${this.lastPlayedHand ? `${this.lastPlayedHand.type}(value=${this.lastPlayedHand.value})` : 'null'}, trickWinPending=${this.trickWinPending}`);
        if (this.lastPlayedHand) {
            // If we are not in a "free play" state (everyone passed)
            if (!Big2Rules.canBeat(validatedHand, this.lastPlayedHand)) {
                console.log(`Hand comparison failed: Attempted ${validatedHand.type}(value=${validatedHand.value}, cards=[${validatedHand.cards?.map(c => `${c.rank}${c.suit}(${c.value})`).join(', ')}]) vs lastPlayedHand ${this.lastPlayedHand.type}(value=${this.lastPlayedHand.value}, cards=[${this.lastPlayedHand.cards?.map(c => `${c.rank}${c.suit}(${c.value})`).join(', ')}])`);
                return { error: 'Hand does not beat the current table' };
            }
        }

        // Move is valid
        const timing = this.turnTiming(player);
        this.tape.recordPlay({
            seat: playerIndex,
            validated: validatedHand,
            thinkMs: timing.thinkMs,
            flags: timing.flags,
            source: player.isBot ? SOURCE.BOT : SOURCE.HUMAN
        });

        // Grade the decision BEFORE anything is mutated. The hand, the pile,
        // the played cards and the trick history all change below, and a move
        // has to be judged against the position it was made in.
        const moveQuality = player.isBot
            ? null
            : this.gradeDecision(playerIndex, {
                action: 'play',
                cards: validatedHand.cards,
                isFirstTurn: isFirstTurnOfGame
            });

        // Same constraint, same reason: the coach re-reads this position to
        // explain itself, so it has to run while the position still exists.
        const coachNote = this.coachReaction(playerIndex, moveQuality, {
            action: 'play',
            cards: validatedHand.cards,
            isFirstTurn: isFirstTurnOfGame,
            handSize: player.hand.length,
            playedOut: newPlayerHand.length === 0
        });

        player.hand = newPlayerHand; // Update hand

        // This play beats whatever was on the pile, so if its owner was
        // sitting on an unresolved risky play, it just failed.
        if (this.lastPlayedHand && this.lastPlayedHand.playerId !== playerId) {
            this.resolveRiskyDecision(this.lastPlayedHand.playerId, 'failed');
        }

        this.lastPlayedHand = { ...validatedHand, playerId };
        console.log(`Play accepted: ${player.name} played ${validatedHand.type}(value=${validatedHand.value}, cards=[${validatedHand.cards?.map(c => `${c.rank}${c.suit}(${c.value})`).join(', ')}])`);
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
            this.players.forEach((p, idx) => {
                if (p.id !== playerId) {
                    this.passedPlayers.add(p.id);
                    this.playOrder++;
                    this.playerLastPlayed[p.id] = { type: 'pass', playerId: p.id, timestamp: Date.now(), playOrder: this.playOrder };
                    // Recorded explicitly rather than left for replay to
                    // re-derive: this is a house rule that may change, and old
                    // tapes must keep replaying as they were played. The
                    // distinct action code also keeps these out of any pass
                    // policy - nobody chose them.
                    this.tape.recordPass({
                        seat: idx, thinkMs: null, source: SOURCE.SERVER_RULE, auto: true
                    });
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

        // Record for opponent modelling (survives trick boundaries). Keyed by
        // seat, not player id: socket ids change on reconnect and are not
        // migrated here, which previously made a reconnecting player's earlier
        // plays vanish from every bot's opponent model for the rest of the round.
        this.trickHistory.push({ seat: playerIndex, action: 'play', hand: validatedHand });

        // Track play stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            const stats = this.roundPlayStats[playerId];
            stats.plays++;
            stats.handTypes[validatedHand.type]++;

            // Once per trick, however many times the player plays into it.
            if (stats.lastTrickCounted !== this.trickIndex) {
                stats.tricksContested++;
                stats.lastTrickCounted = this.trickIndex;
            }

            stats.minHandSize = Math.min(stats.minHandSize, player.hand.length);

            // Control cards ride on the pile until the trick resolves. Playing
            // again in the same trick means the earlier ones were beaten, so
            // the pending count is replaced rather than added to.
            const controls = countControls(validatedHand.cards);
            stats.controlsPlayed += controls;
            this.pendingControlPlays[playerId] = controls;
        }

        // Track Tier 3 decision quality (for human players only)
        if (!player.isBot && moveQuality) {
            const record = this.recordDecision(playerId, 'play', moveQuality, {
                handSize: player.hand.length,
                handStrength: DecisionAnalyzer.calculateHandStrength(player.hand.map(c => c.value)),
                pileStrength: DecisionAnalyzer.calculatePileStrength(this.lastPlayedHand)
            });

            if (moveQuality.isRisky) {
                this.pendingRiskyDecisions[playerId] = record;
            }
        }

        this.turnNumber++;

        // Check if player finished round
        if (player.hand.length === 0) {
            // The play that empties a hand ends the round: nothing can beat it.
            this.resolveRiskyDecision(playerId, 'success');
            this.clearPendingRiskyDecisions();
            this.resolveControlPlays(playerId);

            this.winners.push(player);
            this.roundsWonByName[player.name] = (this.roundsWonByName[player.name] || 0) + 1;
            this.gameState = 'round_over';
            this.lastRoundWinnerId = player.id;
            // Don't clear cards immediately - let them be visible during delay
            // Cards will be cleared when handleRoundOver is called after delay
            return { success: true, roundOver: true, roundWinner: player, roundWinDelay: true, coachNote };
        }

        // If Big 2 was played, all others auto-passed, so give control back to this player
        if (isSingleBig2) {
            // Track lead success for advanced stats
            if (this.roundPlayStats[playerId]) {
                this.roundPlayStats[playerId].leadsWon++;
            }

            // Unbeatable as a single, so the trick is already resolved.
            this.resolveRiskyDecision(playerId, 'success');
            this.clearPendingRiskyDecisions();
            this.resolveControlPlays(playerId);
            this.trickIndex++;

            // Don't clear state immediately - set pending flag for delayed clear
            // This allows clients to see the Big 2 play and all the auto-passes before clearing
            this.trickWinPending = true;
            this.trickWinner = playerId;
            // Turn stays with the current player (they won the trick), but it is
            // a new turn, so think_ms restarts from here rather than measuring
            // back to whenever they last acquired the turn.
            this.markTurnStart();
            return { success: true, wonTrick: true, trickWinDelay: true, coachNote };
        }

        this.advanceTurn();
        return { success: true, coachNote };
    }

    /**
     * The observation for a seat about to act, in the shape BotContext defines.
     * Used both to drive live bot play and to grade human decisions, so a
     * player is measured against exactly the position a bot would have faced.
     */
    buildSeatContext(seat, profile = null) {
        const lastPlayerIdx = this.lastPlayedHand && this.lastPlayedHand.playerId
            ? this.players.findIndex(p => p.id === this.lastPlayedHand.playerId)
            : -1;

        return buildGameContext({
            hands: this.players.map(p => p.hand),
            seat,
            passedSeats: this.players.reduce((seats, p, idx) => {
                if (this.passedPlayers.has(p.id)) seats.push(idx);
                return seats;
            }, []),
            passCount: this.passes,
            playedCards: this.playedCards,
            trickHistory: this.trickHistory,
            lastPlayedHand: this.lastPlayedHand,
            lastPlayedSeat: lastPlayerIdx === -1 ? undefined : lastPlayerIdx,
            profile
        });
    }

    /**
     * Grade a human decision against the bot's evaluation of the position.
     *
     * MUST be called before the move is applied - the hand, pile, played cards
     * and trick history all move on, and a decision is only meaningful against
     * the position it was taken in.
     *
     * Stats must never cost a player their turn, so any failure here degrades
     * to an ungraded decision rather than propagating.
     */
    gradeDecision(seat, { action, cards = null, isFirstTurn = false }) {
        try {
            return evaluateMove({
                hand: this.players[seat].hand,
                lastPlayedHand: this.lastPlayedHand,
                isFirstTurn,
                // Profile-free: the yardstick has to be the same for everyone.
                gameContext: this.buildSeatContext(seat, null),
                action,
                cards
            });
        } catch (err) {
            console.error('Move quality evaluation failed:', err.message);
            return null;
        }
    }

    /** Turn the coach on or off for one seat. */
    setCoachEnabled(playerId, enabled) {
        if (enabled) this.coachSeats.add(playerId);
        else this.coachSeats.delete(playerId);
    }

    /**
     * What the coach would play right now, for the player asking.
     *
     * Read-only: it grades the position and mutates nothing, so asking twice
     * costs nothing but CPU and never affects the game. The observation is
     * built for the asking seat, which carries opponents' card counts and no
     * card of theirs (see BotContext), so a hint can only ever be derived from
     * what the player can already see.
     */
    coachSuggestion(playerId) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };
        if (this.trickWinPending) return { error: 'Wait for current trick to clear' };

        const seat = this.players.findIndex(p => p.id === playerId);
        if (seat === -1) return { error: 'You are not in this room' };
        if (seat !== this.currentTurnIndex) return { error: 'Not your turn' };

        const everyoneFull = this.players.every(p => p.hand.length === 13);
        const isFirstTurn = this.roundNumber === 1 && everyoneFull && this.winners.length === 0;

        try {
            return {
                suggestion: Coach.suggest({
                    hand: this.players[seat].hand,
                    lastPlayedHand: this.lastPlayedHand,
                    isFirstTurn,
                    // Profile-free, exactly as gradeDecision does it: the hint
                    // and the grade that follows it have to be the same opinion.
                    gameContext: this.buildSeatContext(seat, null)
                })
            };
        } catch (err) {
            console.error('Coach suggestion failed:', err.message);
            return { error: 'The coach is stumped right now' };
        }
    }

    /**
     * The coach's reaction to a move that was just made, or null.
     *
     * MUST be handed the grade taken BEFORE the move was applied - it is the
     * same `moveQuality` the Tier 3 tracking already computes, so a note costs
     * nothing extra unless it actually fires, at which point the decision is
     * re-graded once with reasoning on.
     *
     * Never allowed to break a turn: a coach that throws must cost the player
     * nothing, so failures degrade to silence.
     */
    coachReaction(seat, quality, { action, cards = null, isFirstTurn = false, handSize, playedOut = false }) {
        const player = this.players[seat];
        if (!player || player.isBot || !this.coachSeats.has(player.id)) return null;

        try {
            const spent = this.coachCredits[player.id] || 0;
            const note = Coach.react({
                quality,
                action,
                handSize,
                playedOut,
                allowCredit: spent < COACH_CREDITS_PER_ROUND,
                explainer: () => evaluateMove({
                    hand: this.players[seat].hand,
                    lastPlayedHand: this.lastPlayedHand,
                    isFirstTurn,
                    gameContext: this.buildSeatContext(seat, null),
                    action,
                    cards,
                    explain: true
                })
            });
            if (note && note.tone === 'good') this.coachCredits[player.id] = spent + 1;
            return note;
        } catch (err) {
            console.error('Coach reaction failed:', err.message);
            return null;
        }
    }

    /**
     * Append a graded decision to the player's game-long tape and keep the
     * running counters in step. Returns the record so callers can hold a
     * reference to it - the risky-play resolution writes through to it later.
     */
    recordDecision(playerId, action, quality, { handSize, handStrength, pileStrength }) {
        if (!this.tier3DecisionTracking[playerId]) {
            this.tier3DecisionTracking[playerId] = {
                decisions: [],
                riskyPlays: 0,
                optimalPlays: 0
            };
        }

        const record = {
            round: this.roundNumber,
            turn: this.turnNumber,
            action,
            // Null when the decision carried no choice, and excluded from every
            // accuracy figure rather than counted as a free success.
            quality: quality.quality,
            scored: quality.scored,
            forced: quality.forced,
            lossFraction: quality.lossFraction,
            rank: quality.rank,
            optionCount: quality.optionCount,
            isRisky: quality.isRisky,
            minOpponentCards: quality.minOpponentCards,
            // Filled in when the trick resolves: 'success' if nobody beat this
            // play, 'failed' if somebody did. Stays null if the round ended
            // first, and an unresolved play counts as neither.
            riskOutcome: null,
            handSize,
            cardsInDeck: 52 - this.playedCards.length,
            handStrength,
            pileStrength
        };

        this.tier3DecisionTracking[playerId].decisions.push(record);
        if (quality.quality === 'optimal') this.tier3DecisionTracking[playerId].optimalPlays++;
        if (quality.isRisky) this.tier3DecisionTracking[playerId].riskyPlays++;

        return record;
    }

    /**
     * Settle a player's outstanding risky play. Writes through to the decision
     * record held in tier3DecisionTracking, which is what the game-end
     * aggregation reads. A no-op when the player has nothing pending, so it is
     * safe to call at every trick boundary.
     */
    resolveRiskyDecision(playerId, outcome) {
        const pending = this.pendingRiskyDecisions[playerId];
        if (!pending) return;
        pending.riskOutcome = outcome;
        delete this.pendingRiskyDecisions[playerId];
    }

    /**
     * Drop anything still pending at a trick boundary. Those plays were neither
     * beaten nor victorious (the round ended around them), and are counted as
     * neither rather than guessed at.
     */
    clearPendingRiskyDecisions() {
        this.pendingRiskyDecisions = {};
    }

    /**
     * Credit the trick winner with the control cards their winning play
     * committed, then clear the board. Called at the same three points as the
     * risky-play resolution: a trick taken by passes, an unbeatable 2S, and a
     * play that empties the hand.
     */
    resolveControlPlays(winnerId) {
        const won = this.pendingControlPlays[winnerId] || 0;
        if (won && this.roundPlayStats[winnerId]) {
            this.roundPlayStats[winnerId].controlsWon += won;
        }
        this.pendingControlPlays = {};
    }

    passTurn(playerId, { auto = false } = {}) {
        if (this.gameState !== 'playing') return { error: 'Game not active' };

        // Block all passes during trick win delays
        if (this.trickWinPending) {
            console.log(`[DEBUG passTurn] Blocking pass from ${playerId} during trick win delay`);
            return { error: 'Wait for current trick to clear' };
        }

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.currentTurnIndex) return { error: 'Not your turn' };

        if (!this.lastPlayedHand) return { error: 'Cannot pass on free turn' }; // Can't pass if you are leading

        // Update activity timestamp
        this.updateActivity();

        // Graded before passedPlayers and trickHistory record this pass, so the
        // observation is the one the decision was actually taken against.
        const passQuality = this.players[playerIndex].isBot
            ? null
            : this.gradeDecision(playerIndex, { action: 'pass' });

        // Also before the mutations below, for the same reason. An auto-pass is
        // the preference acting, not the player, so there is nobody to coach.
        const coachNote = auto ? null : this.coachReaction(playerIndex, passQuality, {
            action: 'pass',
            handSize: this.players[playerIndex].hand.length
        });

        // Record that this player passed
        const passingPlayer = this.players[playerIndex];
        const passTiming = this.turnTiming(passingPlayer);
        this.tape.recordPass({
            seat: playerIndex,
            // An auto-pass carries a deliberately randomized 1-3s client delay
            // (so opponents cannot distinguish it), which would otherwise land
            // in the middle of the plausible human deliberation band and
            // silently poison any timing model. It is not a think time.
            thinkMs: auto ? null : passTiming.thinkMs,
            flags: passTiming.flags,
            source: passingPlayer.isBot
                ? SOURCE.BOT
                : (auto ? SOURCE.AUTO_PASS_PREF : SOURCE.HUMAN)
        });

        this.playOrder++; // Increment play order for z-index stacking
        this.playerLastPlayed[playerId] = { type: 'pass', playerId, timestamp: Date.now(), playOrder: this.playOrder };
        this.passedPlayers.add(playerId); // Mark player as passed for this round

        // Record what this player declined to beat, for opponent modelling.
        // The pile is stripped of its playerId: identity belongs on the entry,
        // which already carries `seat`. Play entries above always pushed a clean
        // validatedHand, so without this the two entry kinds carried different
        // shapes, and the replayer - which has no playerId concept by design -
        // could not reproduce the observation exactly.
        const { playerId: _pileOwner, ...pileHand } = this.lastPlayedHand;
        this.trickHistory.push({ seat: playerIndex, action: 'pass', hand: pileHand });

        // Track pass stats for advanced stats
        if (this.roundPlayStats[playerId]) {
            this.roundPlayStats[playerId].passes++;
        }

        // Track Tier 3 decision quality (for human players only)
        const player = this.players[playerIndex];
        if (!player.isBot && passQuality) {
            this.recordDecision(playerId, 'pass', passQuality, {
                handSize: player.hand.length,
                handStrength: DecisionAnalyzer.calculateHandStrength(player.hand.map(c => c.value)),
                pileStrength: DecisionAnalyzer.calculatePileStrength(this.lastPlayedHand)
            });
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

            // Nobody beat the pile, so its owner's risky play paid off.
            this.resolveRiskyDecision(lastPlayerId, 'success');
            this.clearPendingRiskyDecisions();
            this.resolveControlPlays(lastPlayerId);
            this.trickIndex++;

            // Don't clear state immediately - set pending flag for delayed clear
            // This allows clients to see all the passes and the winning hand before clearing
            this.trickWinPending = true;
            this.trickWinner = lastPlayerId;
            // Set turn to the player who won the trick
            this.currentTurnIndex = this.players.findIndex(p => p.id === lastPlayerId);
            this.markTurnStart();
            return { success: true, trickWon: true, trickWinDelay: true, coachNote };
        } else {
            this.advanceTurn();
        }

        return { success: true, coachNote };
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
        this.markTurnStart();
    }

    // Register a timeout and track it to prevent race conditions
    registerTimeout(type, timeoutId) {
        // Clear any existing timeout of the same type
        this.clearTimeout(type);
        this.pendingTimeouts.set(type, timeoutId);
    }

    // Clear a specific timeout
    clearTimeout(type) {
        const timeoutId = this.pendingTimeouts.get(type);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.pendingTimeouts.delete(type);
        }
    }

    // Clear all pending timeouts
    clearAllTimeouts() {
        for (const [type, timeoutId] of this.pendingTimeouts) {
            clearTimeout(timeoutId);
        }
        this.pendingTimeouts.clear();
    }

    // Clear trick state after a delay - called by server after showing the trick win
    clearTrickState(generation = null) {
        console.log(`[DEBUG clearTrickState] Called with generation=${generation}, current=${this.trickWinGeneration}. trickWinPending=${this.trickWinPending}, lastPlayedHand=${this.lastPlayedHand ? `${this.lastPlayedHand.type}(value=${this.lastPlayedHand.value})` : 'null'}`);

        // If generation is provided, validate it matches current generation
        if (generation !== null && generation !== this.trickWinGeneration) {
            console.log(`[DEBUG clearTrickState] Skipping stale clear (generation ${generation} !== ${this.trickWinGeneration})`);
            return false;
        }

        if (!this.trickWinPending) return false;

        this.lastPlayedHand = null;
        this.playerLastPlayed = {}; // Clear all displayed hands
        this.passedPlayers = new Set(); // Clear passed players
        this.passes = 0;
        this.playOrder = 0; // Reset play order for new trick
        this.trickWinPending = false;
        this.trickWinner = null;
        this.trickWinGeneration++; // Increment generation after clearing

        // The turn only becomes actionable now: nobody may play while
        // trickWinPending. Without this reset the 1.5s display delay would be
        // baked into the think_ms of every play that follows a won trick.
        this.markTurnStart();

        // Clear the timeout from our tracking
        this.clearTimeout('trickWin');

        return true;
    }

    // Clear cards after round ends - called after delay
    clearRoundEndCards() {
        this.playerLastPlayed = {};
        this.lastPlayedHand = null;
    }

    // New method to check if current player is bot and play
    checkBotTurn(callback) {
        // Prevent multiple simultaneous bot turn calculations
        if (this.isBotThinking) return;

        const currentPlayer = this.players[this.currentTurnIndex];
        if (currentPlayer && currentPlayer.isBot && this.gameState === 'playing') {
            // Set flag to indicate bot is calculating/playing
            this.isBotThinking = true;

            // Determine if first turn of the entire game (round 1 only)
            const everyoneFull = this.players.every(p => p.hand.length === 13);
            const isFirstTurn = this.roundNumber === 1 && everyoneFull && this.winners.length === 0;

            // Build the bot's observation. Shared with the self-play harness,
            // the game-log replayer and the move-quality evaluator so all of
            // them see identical features - see BotContext.js.
            //
            // Per-bot temperament, so four bots at one table do not all play
            // identically. Grading passes null here instead.
            const gameContext = this.buildSeatContext(
                this.currentTurnIndex,
                BotLogic.getBotProfile(currentPlayer.name)
            );

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

                // Use registerTimeout to ensure we can cancel if needed and don't double-queue
                const timeoutId = setTimeout(() => {
                    // Reset thinking flag so next turn can proceed
                    this.isBotThinking = false;

                    // Double-check it's still this bot's turn and game is playing
                    // (State might have changed during delay)
                    if (this.players[this.currentTurnIndex]?.id !== currentPlayer.id || this.gameState !== 'playing') {
                        return;
                    }

                    if (move) {
                        // Play
                        const res = this.playHand(currentPlayer.id, move);
                        if (res.success) {
                            if (res.roundOver) {
                                callback({ type: 'roundOver', roundWinner: res.roundWinner, reasoning: this.lastBotReasoning, roundWinDelay: res.roundWinDelay || false });
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
                        if (res.success) {
                            callback({
                                type: 'pass',
                                playerId: currentPlayer.id,
                                reasoning: this.lastBotReasoning,
                                trickWinDelay: res.trickWinDelay || false
                            });
                        }
                    }
                }, 250); // 250ms delay for realism (reduced from 500ms for better responsiveness)

                this.registerTimeout('botMove', timeoutId);
            };

            try {
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
            } catch (e) {
                console.error('Error getting bot move:', e);
                this.isBotThinking = false;
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
            // Monotonic within a round, incremented on every play and pass.
            // `currentTurn` is a player id and so repeats each time the turn
            // comes back around; this is what a client needs to tell one
            // decision point from the next.
            turnNumber: this.turnNumber,
            cumulativeScores: this.cumulativeScores,
            debugMode: this.debugMode,
            gameMode: this.gameMode,
            pointThreshold: this.pointThreshold,
            isPrivate: this.isPrivate,
            trickWinPending: this.trickWinPending || false,
            trickWinner: this.trickWinner,
            // Public spectator roster (usernames + mute flags only - never hands).
            // Hands reach spectators exclusively via the spectator_hands event.
            spectators: this.getSpectatorList(),
            spectatorsMutedAll: this.spectatorsMutedAll
        };
    }

    /**
     * Describes each seat for the game log.
     *
     * Every bot seat is the heuristic policy: it is the only one there is.
     * `bot_ppo` survives in the store's occupant vocabulary for games logged
     * while the PPO bot existed, but nothing writes it any more.
     */
    describeSeats(fromRound = this.roundNumber) {
        return this.players.map((p, seat) => {
            if (p.isBot) {
                return {
                    seat,
                    fromRound,
                    occupant: 'bot_heuristic',
                    // The bot's name is a policy parameter, not a label:
                    // getBotProfile derives temperament from it, so two bots at
                    // one table play measurably differently.
                    subjectKey: p.name,
                    policyGen: BOT_LOGIC_VERSION,
                    policyRef: null
                };
            }
            return {
                seat,
                fromRound,
                occupant: p.isGuest ? 'guest' : 'human',
                subjectKey: p.isGuest ? null : p.name,
                userId: p.userId ?? null,
                ratingMu: p.rating_mu ?? null,
                ratingSigma: p.rating_sigma ?? null,
                joinedMidGame: Boolean(p.joinedMidGame)
            };
        });
    }

    /** Seat index for a socket id, or -1. */
    seatOf(playerId) {
        return this.players.findIndex(p => p.id === playerId);
    }

    getPlayerHand(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player ? player.hand : [];
    }

    // ============ Post-Game Flow Methods ============

    // Mark a non-host player as ready for rematch
    setPlayerReady(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player.isBot) return { error: 'Player not found' };

        // Don't allow host to use this (they have different buttons)
        if (player.name === this.hostUsername) {
            return { error: 'Host should use rematch or back to lobby' };
        }

        this.postGameReadyPlayers.add(playerId);
        return { success: true };
    }

    // Get current ready status for post-game screen
    getReadyStatus() {
        const humanPlayers = this.players.filter(p => !p.isBot);
        const ready = [];
        const notReady = [];

        for (const player of humanPlayers) {
            if (player.name === this.hostUsername) {
                // Host is always considered "ready" since they control the flow
                continue;
            }
            if (this.postGameReadyPlayers.has(player.id)) {
                ready.push(player.name);
            } else {
                notReady.push(player.name);
            }
        }

        return {
            ready,
            notReady,
            host: this.hostUsername,
            allReady: notReady.length === 0
        };
    }

    // Check if all non-host human players are ready
    allPlayersReady() {
        const humanPlayers = this.players.filter(p => !p.isBot && p.name !== this.hostUsername);
        return humanPlayers.every(p => this.postGameReadyPlayers.has(p.id));
    }

    // Transition room back to waiting (lobby) state - removes bots, keeps humans
    transitionToLobby() {
        // Only allow transition from finished state
        if (this.gameState !== 'finished') {
            return { error: 'Can only transition to lobby from finished state' };
        }

        // Remove all bots
        this.players = this.players.filter(p => !p.isBot);

        // Reset game state
        this.gameState = 'waiting';
        this.roundNumber = 0;
        this.lastRoundWinnerId = null;
        this.cumulativeScores = {};
        this.lastGameResults = null;
        this.lastRoundResults = null;
        this.postGameReadyPlayers.clear();

        this.clearAllTimeouts();
        this.isBotThinking = false;

        // Clear player hands
        this.players.forEach(p => {
            p.hand = [];
        });

        // Stash the outgoing id before it is overwritten, so the next game in
        // this room can link back to it. A lobby restart is a weaker link than
        // a rematch: the roster can change while the room sits in 'waiting'.
        this.previousGameId = this.gameId;
        this.chainKind = 'lobby_restart';
        this.gameKey = null;

        // Generate new game ID for next game
        this.gameId = `game_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Update activity timestamp
        this.updateActivity();

        return {
            success: true,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                rating: p.rating
            })),
            hostUsername: this.hostUsername,
            roomId: this.id
        };
    }

    // Start a rematch - reset game state and start new game immediately
    startRematch() {
        // Only allow from finished state
        if (this.gameState !== 'finished') {
            return { error: 'Can only start rematch from finished state' };
        }

        // Remove all bots (new ones will be added)
        this.players = this.players.filter(p => !p.isBot);

        // Reset game state
        this.roundNumber = 0;
        this.lastRoundWinnerId = null;
        this.cumulativeScores = {};
        this.lastGameResults = null;
        this.lastRoundResults = null;
        this.postGameReadyPlayers.clear();

        // Clear player hands
        this.players.forEach(p => {
            p.hand = [];
        });

        // Stash the outgoing id before overwriting it. A rematch is the stronger
        // chain link: these players explicitly chose to face each other again.
        this.previousGameId = this.gameId;
        this.chainKind = 'rematch';
        this.gameKey = null;

        // Generate new game ID
        this.gameId = `game_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Start the game (this will auto-fill bots)
        return this.startGame();
    }

    // Transfer host to another player
    transferHost(newHostUsername) {
        const newHost = this.players.find(p => p.name === newHostUsername && !p.isBot);
        if (!newHost) {
            return { error: 'New host not found' };
        }

        const oldHost = this.hostUsername;
        this.hostUsername = newHostUsername;
        console.log(`Room ${this.id}: Host transferred from ${oldHost} to ${newHostUsername}`);

        return { success: true, oldHost, newHost: newHostUsername };
    }

    // Remove a player and handle host transfer if needed
    removePlayerPostGame(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return { error: 'Player not found' };

        const wasHost = player.name === this.hostUsername;
        const playerName = player.name;

        // Remove from players array
        this.players = this.players.filter(p => p.id !== playerId);

        // Remove from reconnection tracking
        if (player.name && !player.isBot) {
            delete this.playersByUsername[player.name];
        }

        // Remove from ready set
        this.postGameReadyPlayers.delete(playerId);

        // Count remaining humans
        const remainingHumans = this.players.filter(p => !p.isBot);

        // Handle host transfer if needed
        let newHost = null;
        if (wasHost && remainingHumans.length > 0) {
            newHost = remainingHumans[0].name;
            this.hostUsername = newHost;
            console.log(`Room ${this.id}: Host transferred to ${newHost} after ${playerName} left`);
        } else if (remainingHumans.length === 0) {
            this.hostUsername = null;
        }

        return {
            success: true,
            removedPlayer: playerName,
            wasHost,
            newHost,
            remainingHumans: remainingHumans.length
        };
    }

    // Get count of human players
    getHumanPlayerCount() {
        return this.players.filter(p => !p.isBot).length;
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
            // Null unless a game was actually in progress: a waiting room or an
            // already-finished game was not abandoned mid-play.
            let abandonReason = null;

            // Rule 1: All bots - delete immediately
            if (room.hasOnlyBots()) {
                shouldDelete = true;
                reason = 'all bots';
                abandonReason = 'all_bots';
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
                abandonReason = 'single_player_timeout';
            }
            // Rule 5: Multiplayer games - delete after 30 minutes
            else if (!room.isSinglePlayer() && (room.gameState === 'playing' || room.gameState === 'round_over') && inactiveDuration > MULTIPLAYER_TIMEOUT) {
                shouldDelete = true;
                reason = 'multiplayer timeout (30min)';
                abandonReason = 'multiplayer_timeout';
            }

            if (shouldDelete) {
                roomsToDelete.push({ roomId, reason, room, abandonReason });
            }
        }

        // Delete marked rooms
        for (const { roomId, reason, room } of roomsToDelete) {
            this.deleteRoom(roomId);
            console.log(`[Cleanup] Deleted room ${roomId}: ${reason} (inactive for ${Math.round(room.getInactiveDuration() / 60000)}min)`);
        }

        // Returns the reaped rooms rather than a count so the caller can flush
        // their in-flight state before it is lost. abandonReason distinguishes
        // an all-bot room (no behavioural bias) from a human walking out
        // mid-game (the strongest bias), which is what makes abandoned games
        // reweightable rather than merely discardable.
        return roomsToDelete;
    }
}


module.exports = { RoomManager, Room };
