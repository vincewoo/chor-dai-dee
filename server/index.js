const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const { RoomManager } = require('./game/RoomManager');
const { createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName, getUserStatsByMode, updateUserStatsByMode, getUserByUsername, saveRoundStats, getRoundAggregates, getCombinationStats, getRecentRounds, updateAggregateStats, updateHeadToHeadStats, getHeadToHeadStats, updateCardAwarenessStats, updateVarianceStats, updateBehavioralStats, getTier3Stats, getDealStrengthStats, getGameRoundSummary, savePlacementHistory, getPlacementHistory, updateVarianceScores, trackDecision, trackDecisionsBatch, pruneDecisionTracking, DECISION_TRACKING_RETENTION_DAYS, withTransaction, getUserPreferences, updateUserPreferences, getAvatarsByUsernames, saveGameHistory, saveGameParticipant, saveGameEvent, getActivityFeed, getActivityFeedCount, getUserByGoogleId, createGoogleUser, linkGoogleAccount, isUsernameAvailable } = require('./db');
const { OAuth2Client } = require('google-auth-library');
const { calculateRoundScores, calculateDragonScores } = require('./game/Scoring');
const { calculateNewRatings, calculateDisplayRating } = require('./game/RatingSystem');
const { DecisionAnalyzer } = require('./game/DecisionAnalyzer');
const {
    TIERS: DEAL_TIERS,
    BASELINE_VERSION: DEAL_BASELINE_VERSION,
    RESIDUAL_SD_WIN,
    RESIDUAL_SD_POINTS,
    MIN_ROUNDS_FOR_EDGE,
    percentileFor: percentileForRaw
} = require('./game/DealStrength');
const { normalizeAvatar } = require('./avatars');
const gamelog = require('./gamelog');
const gamelogRecorder = require('./gamelogRecorder');

const app = express();

// Determine allowed origins based on environment
const isProduction = process.env.NODE_ENV === 'production';

// In production, allow same-origin requests (no CORS needed when serving from same domain)
// Also allow any fly.dev subdomain for flexibility
const corsOptions = isProduction
    ? {
        origin: true, // Reflect the request origin (allows same-origin)
        methods: ['GET', 'POST']
    }
    : {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or Postman)
            if (!origin) return callback(null, true);

            // Allow localhost and local network IPs
            const allowedPatterns = [
                /^http:\/\/localhost:\d+$/,
                /^http:\/\/127\.0\.0\.1:\d+$/,
                /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // Local network IPs
                /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,     // Local network IPs
                /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/ // Local network IPs
            ];

            const allowed = allowedPatterns.some(pattern => pattern.test(origin));
            callback(null, allowed);
        },
        methods: ['GET', 'POST'],
        credentials: true
    };

app.use(cors(corsOptions));
// gzip static assets and JSON responses. The entry bundle is ~915 KB raw and
// ~276 KB gzipped, so this is the single largest first-load win.
app.use(compression());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions,
    // Balance between responsiveness and stability for mobile connections
    pingTimeout: 20000,     // 20 seconds to wait for pong (allowing for network latency)
    pingInterval: 15000,    // Send ping every 15 seconds (more frequent than default 25s)
    connectTimeout: 45000,  // 45 seconds for initial connection
    // Allow both transports for better compatibility
    transports: ['websocket', 'polling'],
    // Allow upgrade from polling to websocket
    allowUpgrades: true,
    // Increase max HTTP buffer size for larger game states
    maxHttpBufferSize: 1e6,
    // Disable perMessageDeflate to reduce CPU usage and improve stability on mobile
    perMessageDeflate: false
});

const roomManager = new RoomManager();

// Per-invocation memo for getUserByUsername. The round-end and game-end paths
// look the same handful of usernames up over and over (once for game history,
// once per participant, again for Tier 3, then twice per head-to-head pair --
// roughly 20 identical queries for 4 players). Usernames cannot change mid-game,
// so one lookup each is enough.
const createUserLookup = () => {
    const cache = new Map();
    return (username) => {
        if (!cache.has(username)) {
            cache.set(username, getUserByUsername(username));
        }
        return cache.get(username);
    };
};

// Voice Chat WebRTC Signaling - Global voice rooms tracker
const voiceRooms = {}; // Track voice participants by room

// ============ Spectator Helpers ============

// The ONLY place hands are sent to spectators. Every emit here is addressed to an
// individual spectator socket drawn from room.spectators - a collection that
// structurally cannot contain a seated player (addSpectator rejects seated
// usernames, and join_room drops the spectator entry when a username takes a seat).
// It never uses io.to(roomId) or socket.broadcast, so seated players cannot receive
// this event. Keep it that way: this function is the entire hand-leak boundary.
function emitSpectatorHands(room, roomId) {
    if (!room || room.spectators.size === 0) return;
    if (room.gameState === 'waiting') return;

    const hands = room.getAllHands();
    for (const spec of room.spectators.values()) {
        // Executable invariant: never send to a socket that holds a seat.
        if (room.players.some(p => p.id === spec.socketId)) {
            console.error(`BUG: spectator ${spec.username} shares a socket with a seated player in ${roomId}; skipping hand emit`);
            continue;
        }
        io.to(spec.socketId).emit('spectator_hands', { hands });
    }
}

// Bounce every spectator out of a room that is about to be deleted. A room with no
// humans playing isn't worth keeping alive just because someone is watching.
function evictSpectators(room, roomId, reason) {
    if (!room || room.spectators.size === 0) return;
    for (const spec of room.spectators.values()) {
        io.to(spec.socketId).emit('spectator_room_closed', { reason });
        if (spec.socket) {
            spec.socket.leave(roomId);
            delete spec.socket.spectatingRoomId;
            delete spec.socket.spectatorUsername;
        }
    }
    room.spectators.clear();
}

// Drop a username's spectator seat in every room. Called when that username takes a
// real seat somewhere, so nobody is ever both a player and a spectator.
function dropSpectatorEverywhere(username, socket) {
    for (const [rid, room] of roomManager.rooms) {
        if (room.spectators.has(username)) {
            room.removeSpectator(username);
            if (socket) socket.leave(rid);
            io.to(rid).emit('room_update', room.getGameState());
        }
    }
    if (socket) {
        delete socket.spectatingRoomId;
        delete socket.spectatorUsername;
    }
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id} from ${socket.handshake.headers['user-agent']?.substring(0, 50)}`);

    // Handle explicit ping from client (for keep-alive)
    socket.on('ping', () => {
        // Socket.io handles this automatically, but we can log it for debugging
        // Respond with pong to keep connection alive
        socket.emit('pong');
    });

    socket.on('join_room', async ({ roomId, username, isGuest }) => {
        console.log(`join_room event received: roomId=${roomId}, username=${username}, isGuest=${isGuest}`);

        // Reject joins without a username. An empty username would fall through the
        // username-keyed reconnection/dedup logic and stack up duplicate phantom
        // "Player <socketId>" seats on repeated join_room emits.
        if (!username || typeof username !== 'string' || !username.trim()) {
            console.warn(`Rejecting join_room from ${socket.id}: missing username`);
            socket.emit('error', 'You must be signed in to join a room.');
            return;
        }

        // Taking a seat always ends any spectating. Nobody is both a player and a
        // spectator - that would break the hand-emit invariant in emitSpectatorHands.
        dropSpectatorEverywhere(username, socket);

        // Fetch user stats to get rating
        // Skip database lookup for guest users
        let ratingMu, ratingSigma, displayRating;
        if (isGuest) {
            // Guest users get default rating
            displayRating = calculateDisplayRating(undefined, undefined);
        } else if (username) {
            try {
                const stats = await getUserStatsByMode(username, 'standard');
                if (stats) {
                    ratingMu = stats.rating_mu;
                    ratingSigma = stats.rating_sigma;
                    displayRating = calculateDisplayRating(ratingMu, ratingSigma);
                } else {
                    displayRating = calculateDisplayRating(undefined, undefined); // Default
                }
            } catch (e) {
                console.error('Error fetching stats for join_room:', e);
                displayRating = calculateDisplayRating(undefined, undefined);
            }
        } else {
            displayRating = calculateDisplayRating(undefined, undefined);
        }

        // OPTION 2: Auto-leave any previous rooms before joining a new one
        // Find all rooms this username is currently in
        const existingRooms = roomManager.findAllRoomsByUsername(username);

        // Determine the target room ID early to check if it's a different room
        let targetRoomId = roomId;
        if (roomId === 'create') {
            // If this user is already waiting in a room, reuse it instead of minting
            // a new one. Repeated 'create' emits (e.g. socket reconnect, double-fire)
            // would otherwise spawn orphan rooms and bounce the user between them.
            const reusableRoom = existingRooms.find(
                ({ room }) => room.gameState === 'waiting'
            );
            if (reusableRoom) {
                targetRoomId = reusableRoom.roomId;
                console.log(`Reusing existing waiting room ${targetRoomId} for ${username} instead of creating a new one`);
            } else {
                targetRoomId = roomManager.createRoom();
                console.log(`Created new room: ${targetRoomId}`);
            }
        }

        // If player is in other rooms (not the target room), leave them
        for (const { roomId: existingRoomId, room: existingRoom, player: existingPlayer } of existingRooms) {
            if (existingRoomId !== targetRoomId) {
                console.log(`${username} is already in room ${existingRoomId}, leaving it to join ${targetRoomId}`);

                // Handle leaving based on game state
                if (existingRoom.gameState === 'waiting') {
                    // Just remove the player during waiting
                    existingRoom.players = existingRoom.players.filter(p => p.id !== existingPlayer.id);

                    // Remove from reconnection tracking
                    if (existingRoom.playersByUsername[username]) {
                        delete existingRoom.playersByUsername[username];
                    }

                    // Transfer host if needed
                    if (existingRoom.hostUsername === username) {
                        const newHost = existingRoom.players.find(p => !p.isBot);
                        existingRoom.hostUsername = newHost ? newHost.name : null;
                        if (newHost) {
                            console.log(`Room ${existingRoomId}: Host transferred to ${newHost.name}`);
                        }
                    }

                    // Notify others in the old room
                    io.to(existingRoomId).emit('room_update', existingRoom.getGameState());
                    io.to(existingRoomId).emit('player_left', { playerName: username });

                    // Leave the socket room
                    socket.leave(existingRoomId);

                    // Delete room if empty
                    if (existingRoom.players.length === 0) {
                        evictSpectators(existingRoom, existingRoomId, 'The game ended');
                        roomManager.deleteRoom(existingRoomId);
                        console.log(`Room ${existingRoomId} deleted (empty after ${username} left)`);
                    }
                } else {
                    // Game in progress - replace with bot
                    const replacement = existingRoom.replaceWithBot(existingPlayer.id);
                    if (replacement) {
                        gamelogRecorder.recordSeatChange(existingRoom, existingRoom.seatOf(replacement.botPlayer.id));
                    }
                    socket.leave(existingRoomId);

                    if (replacement) {
                        console.log(`${username} left room ${existingRoomId} (game in progress) and was replaced by ${replacement.botPlayer.name}`);

                        // Check if room now has only bots
                        if (existingRoom.hasOnlyBots()) {
                            console.log(`Room ${existingRoomId} now has only bots, deleting room`);
                            evictSpectators(existingRoom, existingRoomId, 'All players left');
                            roomManager.deleteRoom(existingRoomId);
                        } else {
                            // Notify others in the old room
                            io.to(existingRoomId).emit('room_update', existingRoom.getGameState());
                            io.to(existingRoomId).emit('player_left', {
                                playerName: username,
                                replacedWithBot: true,
                                botName: replacement.botPlayer.name
                            });

                            // If it was their turn, trigger bot to play
                            if (replacement.wasCurrentTurn && existingRoom.gameState === 'playing') {
                                processBotTurns(existingRoom, existingRoomId);
                            }
                        }
                    }
                }
            }
        }

        // Check if user is already in a room (either disconnected or still connected)
        const reconnectInfo = roomManager.findRoomForReconnect(username);
        if (reconnectInfo) {
            const { roomId: existingRoomId, room } = reconnectInfo;
            console.log(`Reconnecting ${username} to room ${existingRoomId}`);

            const player = room.reconnectPlayer(username, socket.id, socket);
            if (player) {
                // Update rating on reconnection just in case it changed
                player.rating = displayRating;

                socket.join(existingRoomId);

                console.log(`Room state on reconnect: ${room.gameState}, player hand: ${player.hand ? player.hand.length : 0} cards`);

                // Send reconnection success with full state
                socket.emit('reconnected', {
                    roomId: existingRoomId,
                    playerId: socket.id,
                    gameState: room.getGameState()
                });

                // Send player's hand if game is in progress
                if (room.gameState === 'playing' || room.gameState === 'round_over') {
                    console.log(`Sending hand to ${username} on reconnect: ${player.hand ? player.hand.length : 0} cards`);
                    socket.emit('hand_update', player.hand || []);
                }

                // Send round_over event if the room is in round_over state
                if (room.gameState === 'round_over' && room.lastRoundResults) {
                    console.log(`Sending round_over to ${username} on reconnect`);
                    socket.emit('round_over', room.lastRoundResults);
                }

                // Send game_over event if the game is finished
                if (room.gameState === 'finished' && room.lastGameResults) {
                    console.log(`Sending game_over to ${username} on reconnect`);
                    if (room.lastGameResults.isDragonWin) {
                        socket.emit('dragon_win', room.lastGameResults);
                    } else {
                        socket.emit('game_over', room.lastGameResults);
                    }
                }

                // Notify everyone in room about the reconnection
                io.to(existingRoomId).emit('room_update', room.getGameState());
                io.to(existingRoomId).emit('player_reconnected', { playerName: username });

                console.log(`${username} reconnected successfully to room ${existingRoomId}`);

                // Check if current player is a bot and trigger bot turn processing
                if (room.gameState === 'playing') {
                    processBotTurns(room, existingRoomId);
                }

                return;
            }
        }

        // Check if player already exists in the target room (not disconnected, but socket changed)
        const targetRoom = roomManager.getRoom(targetRoomId);
        if (targetRoom && targetRoom.playersByUsername && targetRoom.playersByUsername[username]) {
            const existingPlayer = targetRoom.playersByUsername[username];
            // Player is already in the room but socket ID changed (e.g., page refresh)
            console.log(`Player ${username} already in room ${targetRoomId}, updating socket from ${existingPlayer.id} to ${socket.id}`);

            const player = targetRoom.reconnectPlayer(username, socket.id, socket);
            if (player) {
                player.rating = displayRating;
                socket.join(targetRoomId);

                socket.emit('joined_room', { roomId: targetRoomId, playerId: socket.id });
                io.to(targetRoomId).emit('room_update', targetRoom.getGameState());

                // Send hand if game is in progress
                if (targetRoom.gameState === 'playing' || targetRoom.gameState === 'round_over') {
                    console.log(`Sending hand to ${username} (already in room): ${player.hand ? player.hand.length : 0} cards`);
                    socket.emit('hand_update', player.hand || []);
                }

                // Send round_over event if the room is in round_over state
                if (targetRoom.gameState === 'round_over' && targetRoom.lastRoundResults) {
                    console.log(`Sending round_over to ${username} (already in room)`);
                    socket.emit('round_over', targetRoom.lastRoundResults);
                }

                // Send game_over event if the game is finished
                if (targetRoom.gameState === 'finished' && targetRoom.lastGameResults) {
                    console.log(`Sending game_over to ${username} (already in room)`);
                    if (targetRoom.lastGameResults.isDragonWin) {
                        socket.emit('dragon_win', targetRoom.lastGameResults);
                    } else {
                        socket.emit('game_over', targetRoom.lastGameResults);
                    }
                }

                // Check if current player is a bot and trigger bot turn processing
                if (targetRoom.gameState === 'playing') {
                    processBotTurns(targetRoom, targetRoomId);
                }

                return;
            }
        }

        // Normal join flow (targetRoomId already set above)

        // Final safety check: Verify player doesn't already exist in target room
        const finalTargetRoom = roomManager.getRoom(targetRoomId);
        if (finalTargetRoom && username) {
            const duplicatePlayer = finalTargetRoom.players.find(p => p.name === username && !p.isBot);
            if (duplicatePlayer) {
                console.error(`ERROR: Player ${username} already exists in room ${targetRoomId} but was not caught by reconnection logic!`);
                console.error(`Existing player ID: ${duplicatePlayer.id}, isDisconnected: ${duplicatePlayer.isDisconnected}`);
                console.error(`Attempting to add with socket ID: ${socket.id}`);
                socket.emit('error', 'You are already in this room. Please refresh the page.');
                return;
            }
        }

        const player = {
            id: socket.id,
            name: username,
            socket,
            rating: displayRating,
            isGuest: isGuest || false
        };

        // Check if room is in-progress and has bots to replace
        if (finalTargetRoom && (finalTargetRoom.gameState === 'playing' || finalTargetRoom.gameState === 'round_over') && finalTargetRoom.hasReplacableBots()) {
            console.log(`Room ${targetRoomId} is in-progress. Attempting to replace a bot with ${username}`);
            const replaceResult = finalTargetRoom.replaceBot(player);
            if (replaceResult && replaceResult.success) {
                gamelogRecorder.recordSeatChange(finalTargetRoom, finalTargetRoom.seatOf(replaceResult.humanPlayer.id));
            }

            if (replaceResult.error) {
                socket.emit('error', replaceResult.error);
                return;
            }

            socket.join(targetRoomId);
            const room = finalTargetRoom;

            console.log(`Successfully replaced bot ${replaceResult.oldBot.name} with ${username}`);

            // Send the player's hand (from the bot)
            if (replaceResult.humanPlayer.hand) {
                socket.emit('hand_update', replaceResult.humanPlayer.hand);
            }

            // Send round_over event if the room is in round_over state
            if (room.gameState === 'round_over' && room.lastRoundResults) {
                console.log(`Sending round_over to ${username} (replaced bot)`);
                socket.emit('round_over', room.lastRoundResults);
            }

            // Send game_over event if the game is finished
            if (room.gameState === 'finished' && room.lastGameResults) {
                console.log(`Sending game_over to ${username} (replaced bot)`);
                if (room.lastGameResults.isDragonWin) {
                    socket.emit('dragon_win', room.lastGameResults);
                } else {
                    socket.emit('game_over', room.lastGameResults);
                }
            }

            // Send joined confirmation
            socket.emit('joined_room', { roomId: targetRoomId, playerId: socket.id });

            // Notify the joining player that stats won't be recorded for mid-game joins
            socket.emit('mid_game_join_info', {
                message: 'You joined mid-game. Stats will not be recorded for this game.',
                joinedAtRound: replaceResult.humanPlayer.joinedAtRound,
                inheritedScore: replaceResult.humanPlayer.joinedWithScore
            });

            // Notify everyone in room about the replacement
            io.to(targetRoomId).emit('room_update', room.getGameState());
            io.to(targetRoomId).emit('player_joined_in_progress', {
                playerName: username,
                replacedBot: replaceResult.oldBot.name
            });

            // If it was the bot's turn and now it's the human's turn, don't process bot turn
            if (replaceResult.wasCurrentTurn && room.gameState === 'playing') {
                console.log(`It's now ${username}'s turn after replacing bot`);
            } else if (room.gameState === 'playing') {
                // Check if current player is still a bot and trigger bot turn processing
                processBotTurns(room, targetRoomId);
            }

            return;
        }

        const result = roomManager.joinRoom(targetRoomId, player);
        console.log(`Join result:`, result.error || 'success');

        if (result.error) {
            socket.emit('error', result.error);
            // Structured failure so the client can offer "Watch instead" without
            // string-matching the error text.
            socket.emit('join_failed', {
                roomId: targetRoomId,
                reason: result.error === 'Room full' ? 'full' : 'other',
                canSpectate: result.error === 'Room full'
            });
        } else {
            socket.join(targetRoomId);
            const room = result.room;

            // Notify everyone in room
            io.to(targetRoomId).emit('room_update', room.getGameState());
            socket.emit('joined_room', { roomId: targetRoomId, playerId: socket.id });
        }
    });

    // Join a room as a read-only spectator. Deliberately a separate handler from
    // join_room: that separateness is what keeps spectating clear of join_room's
    // auto-leave logic, so watching one game never evicts you from another.
    socket.on('spectate_room', ({ roomId, username, isGuest }) => {
        console.log(`spectate_room: roomId=${roomId}, username=${username}`);

        if (!username || typeof username !== 'string' || !username.trim()) {
            socket.emit('error', 'You must be signed in to watch a game.');
            return;
        }

        const room = roomManager.getRoom(roomId);
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        const result = room.addSpectator({ username, socketId: socket.id, socket, isGuest });
        if (result.error) {
            socket.emit('error', result.error);
            return;
        }

        // If this username was watching from another socket (e.g. a second tab),
        // retire the stale one so it stops receiving hands.
        if (result.previousSocketId && result.previousSocketId !== socket.id) {
            io.to(result.previousSocketId).emit('spectator_room_closed', { reason: 'Opened in another tab' });
        }

        socket.join(roomId);
        socket.spectatingRoomId = roomId;
        socket.spectatorUsername = username;

        socket.emit('spectating_room', { roomId, gameState: room.getGameState() });
        emitSpectatorHands(room, roomId);

        // Carry any host mute across the reconnect
        if (room.isSpectatorMuted(username)) {
            socket.emit('voice:force-muted', { muted: true });
        }

        // Replay terminal-state screens so a spectator joining mid-pause sees them
        if (room.gameState === 'round_over' && room.lastRoundResults) {
            socket.emit('round_over', room.lastRoundResults);
        }
        if (room.gameState === 'finished' && room.lastGameResults) {
            socket.emit(room.lastGameResults.isDragonWin ? 'dragon_win' : 'game_over', room.lastGameResults);
        }

        // Let the players see the updated spectator roster
        io.to(roomId).emit('room_update', room.getGameState());
    });

    // ---- Host mute controls for spectators ----
    //
    // This is a SOFT mute: the server tells the spectator's client to disable its
    // mic track and locks the button. Media is P2P (the server only relays
    // signaling), so a modified client could bypass it. Enforcing it hard would
    // mean tearing down the peer connection, which - because WebRTC peers are
    // bidirectional - would also stop the spectator hearing the game. Soft mute
    // is the deliberate choice; the UI must not claim more than it delivers.

    // Push a spectator's effective mute to their client and refresh the roster.
    const applySpectatorMute = (room, roomId, spec) => {
        const effective = room.spectatorsMutedAll || spec.forcedMute;
        io.to(spec.socketId).emit('voice:force-muted', { muted: effective });
    };

    const broadcastMuteState = (room, roomId) => {
        io.to(roomId).emit('spectator_mute_state', {
            spectatorsMutedAll: room.spectatorsMutedAll,
            spectators: room.getSpectatorList()
        });
        io.to(roomId).emit('room_update', room.getGameState());
    };

    // Shared host validation, mirroring the kick_player ordering.
    const requireHost = (roomId) => {
        const room = roomManager.getRoom(roomId);
        if (!room) { socket.emit('error', 'Room not found'); return null; }
        const requester = room.players.find(p => p.id === socket.id);
        if (!requester) { socket.emit('error', 'You are not in this room'); return null; }
        if (requester.name !== room.hostUsername) {
            socket.emit('error', 'Only the host can mute spectators');
            return null;
        }
        return room;
    };

    socket.on('mute_all_spectators', ({ roomId, muted }) => {
        const room = requireHost(roomId);
        if (!room) return;

        room.spectatorsMutedAll = !!muted;
        for (const spec of room.spectators.values()) {
            applySpectatorMute(room, roomId, spec);
        }
        broadcastMuteState(room, roomId);
        console.log(`Room ${roomId}: spectators ${muted ? 'muted' : 'unmuted'} by host`);
    });

    socket.on('mute_spectator', ({ roomId, username, muted }) => {
        const room = requireHost(roomId);
        if (!room) return;

        const spec = room.spectators.get(username);
        if (!spec) return socket.emit('error', 'Spectator not found');

        spec.forcedMute = !!muted;
        applySpectatorMute(room, roomId, spec);
        broadcastMuteState(room, roomId);
        console.log(`Room ${roomId}: spectator ${username} ${muted ? 'muted' : 'unmuted'} by host`);
    });

    socket.on('leave_spectate', ({ roomId }) => {
        const targetRoomId = roomId || socket.spectatingRoomId;
        const room = targetRoomId ? roomManager.getRoom(targetRoomId) : null;
        const username = socket.spectatorUsername;

        if (room && username) {
            room.removeSpectator(username);
            io.to(targetRoomId).emit('room_update', room.getGameState());
        }
        if (targetRoomId) socket.leave(targetRoomId);
        delete socket.spectatingRoomId;
        delete socket.spectatorUsername;
    });

    const handleDragonWin = async (room, roomId, dragonWinner) => {
        const lookupUser = createUserLookup();
        // Dragon win - player with all 13 different ranks wins the entire game immediately
        const dragonScores = calculateDragonScores(dragonWinner, room.players);
        room.updateScores(dragonScores);
        room.gameState = 'finished';

        // Add cumulative scores to the dragon scores for display
        const scoresWithCumulative = dragonScores.map(s => ({
            ...s,
            cumulativeScore: room.cumulativeScores[s.id] || 0
        }));

        const sanitizedDragonWinner = {
            id: dragonWinner.id,
            name: dragonWinner.name,
            isBot: dragonWinner.isBot
        };

        const dragonResults = {
            winner: sanitizedDragonWinner,
            scores: scoresWithCumulative,
            finalScores: room.cumulativeScores,
            roundNumber: room.roundNumber,
            isDragonWin: true
        };

        // Store dragon win results for reconnection handling
        room.lastGameResults = dragonResults;

        // Emit special dragon_win event
        io.to(roomId).emit('dragon_win', dragonResults);

        // Save game history for dragon win
        try {
            const endTime = new Date();
            const startTime = new Date(room.createdAt);
            const durationSeconds = Math.floor((endTime - startTime) / 1000);
            const winner = dragonWinner.isBot ? null : await lookupUser(dragonWinner.name);

            await withTransaction(async () => {
                await saveGameHistory({
                    gameId: room.gameId,
                    roomName: room.id,
                    gameMode: room.gameMode,
                    isPublic: !room.isPrivate,
                    status: 'completed',
                    winnerId: winner ? winner.id : null,
                    winnerUsername: dragonWinner.name,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    durationSeconds: durationSeconds,
                    totalRounds: 1,
                    maxPoints: room.pointThreshold
                });

                // Save participants with dragon win placements
                for (const p of room.players) {
                    const participant = p.isBot ? null : await lookupUser(p.name);
                    await saveGameParticipant({
                        gameId: room.gameId,
                        userId: participant ? participant.id : null,
                        username: p.name,
                        isBot: p.isBot,
                        finalPlacement: p.id === dragonWinner.id ? 1 : 4,
                        finalScore: p.id === dragonWinner.id ? 0 : 39,
                        roundsWon: p.id === dragonWinner.id ? 1 : 0
                    });
                }

                // Save dragon win event
                await saveGameEvent(room.gameId, 'dragon_win', {
                    winner: dragonWinner.name
                });
            });
        } catch (e) {
            console.error("Failed to save game history for dragon win:", e);
        }

        // startRound() buffered the deal before returning early, so the dragon
        // hand itself is preserved -- a ~1-in-millions datum that explains an
        // otherwise inexplicable game outcome.
        await gamelogRecorder.recordRoundEnd(room, {
            endReason: 'dragon',
            winnerSeat: room.seatOf(dragonWinner.id),
            cardsLeft: room.players.map(p => (p.hand ? p.hand.length : 0)),
            roundPoints: room.players.map(p => {
                const score = dragonScores.find(s => s.id === p.id);
                return score ? score.roundPoints : 0;
            }),
            scoreAfter: room.players.map(p => room.cumulativeScores[p.id] || 0)
        });
        await gamelogRecorder.recordGameEnd(room, {
            endReason: 'dragon',
            winnerSeat: room.seatOf(dragonWinner.id)
        });

        // Handle rating updates similar to game_over (fetch stats, calculate new ratings, update DB)
        // Exclude guests and mid-game joiners from rating calculations (treat as bots)
        const playersWithStats = await Promise.all(room.players.map(async (p) => {
            if (p.isBot || p.isGuest || p.joinedMidGame) return { ...p, isBot: true }; // Treat guests and mid-game joiners as bots for rating calc
            try {
                const stats = await getUserStatsByMode(p.name, room.gameMode);
                return {
                    ...p,
                    rating_mu: stats ? stats.rating_mu : undefined,
                    rating_sigma: stats ? stats.rating_sigma : undefined
                };
            } catch (e) {
                console.error("Error fetching stats for rating calc:", p.name, e);
                return { ...p };
            }
        }));

        // Final scores keyed by player id: calculateNewRatings reads
        // finalScores[p.id] to rank the table. Passing a positional array here
        // meant every lookup missed, every player scored 0, and the dragon win
        // rated as a four-way draw.
        const dragonFinalScores = {};
        room.players.forEach(p => {
            const score = dragonScores.find(s => s.id === p.id);
            dragonFinalScores[p.id] = score ? score.roundPoints : 0;
        });

        // Winner 1st, everyone else tied for last.
        const dragonPlacements = {};
        room.players.forEach(p => {
            dragonPlacements[p.id] = p.id === dragonWinner.id ? 1 : 4;
        });

        // Update ratings for all human players (excluding mid-game joiners).
        // calculateNewRatings returns HUMANS ONLY, so the result cannot be
        // indexed by seat -- key it by name, as the game_over path does.
        const newRatings = calculateNewRatings(playersWithStats, dragonFinalScores);
        const ratingUpdates = {};
        newRatings.forEach(r => {
            ratingUpdates[r.name] = { mu: r.mu, sigma: r.sigma };
        });

        await withTransaction(async () => {
            for (const player of room.players) {
                // Skip bots, guests, and mid-game joiners (no stats recorded for guests or mid-game joiners)
                if (player.joinedMidGame) {
                    console.log(`Dragon win: Skipping stats for ${player.name} (joined mid-game at round ${player.joinedAtRound})`);
                }
                if (player.isBot || player.isGuest || player.joinedMidGame) continue;

                try {
                    const user = await lookupUser(player.name);
                    if (!user) continue;

                    const newRating = ratingUpdates[player.name];
                    const isWinner = player.id === dragonWinner.id;

                    // updateUserStatsByMode takes positional args keyed on
                    // USERNAME. It was being called with a user id and an
                    // options object, so it rejected 'User not found' on the
                    // first await and a dragon win recorded nothing at all.
                    await updateUserStatsByMode(
                        player.name,
                        room.gameMode,
                        isWinner,
                        dragonFinalScores[player.id],
                        newRating ? newRating.mu : null,
                        newRating ? newRating.sigma : null
                    );

                    // Keeps the placement counters in step with games_played,
                    // which the leaderboard's average placement divides by.
                    // A dragon round writes no round_stats, so the play/pass
                    // totals this adds are zero.
                    await updateAggregateStats(
                        player.name,
                        room.gameMode,
                        dragonPlacements[player.id],
                        room.gameId
                    );

                    // Save placement history for variance tracking
                    await savePlacementHistory(
                        user.id,
                        room.gameMode,
                        room.gameId,
                        dragonPlacements[player.id]
                    );

                    if (newRating) {
                        player.rating = calculateDisplayRating(newRating.mu, newRating.sigma);
                    }
                } catch (e) {
                    console.error("Failed to update stats for", player.name, e);
                }
            }
        }).catch(e => console.error("Dragon win stats transaction failed:", e));
    };

    const handleRoundOver = async (room, roomId, roundWinner) => {
        const lookupUser = createUserLookup();
        const roundScores = calculateRoundScores(roundWinner, room.players);
        const isGameOver = room.updateScores(roundScores);

        // Add cumulative scores to the round scores for display
        const scoresWithCumulative = roundScores.map(s => ({
            ...s,
            cumulativeScore: room.cumulativeScores[s.id] || 0
        }));

        // Calculate placements for each player (1st = winner, 2nd/3rd/4th by cards left)
        const roundScoresWithPlacements = [...roundScores].sort((a, b) => {
            if (a.isRoundWinner) return -1;
            if (b.isRoundWinner) return 1;
            // Sort by cards left (fewer = better), then by points
            if (a.cardsLeft !== b.cardsLeft) return a.cardsLeft - b.cardsLeft;
            return a.roundPoints - b.roundPoints;
        }).map((score, index) => ({
            ...score,
            placement: index + 1
        }));

        // Save round stats for each player (only registered human players, not guests).
        // One transaction for the whole loop: these are up to 4 independent inserts
        // that would otherwise each pay their own commit.
        await withTransaction(async () => {
            for (const scoreData of roundScoresWithPlacements) {
                // Mid-game joiners are excluded from game-level stats and
                // ratings, so their rounds must not land in round_stats either
                // -- otherwise the two sources disagree about how much they
                // played. Guests have nothing to attach stats to at all.
                if (scoreData.isBot || scoreData.isGuest || scoreData.joinedMidGame) continue;
                try {
                    const user = await lookupUser(scoreData.name);
                    if (!user) continue;

                    const playStats = room.roundPlayStats[scoreData.id] || {
                        plays: 0,
                        passes: 0,
                        leadsWon: 0,
                        tricksContested: 0,
                        handTypes: {}
                    };

                    // Determine penalty multiplier
                    let penaltyMultiplier = 1;
                    if (scoreData.cardsLeft >= 13) penaltyMultiplier = 3;
                    else if (scoreData.cardsLeft >= 10) penaltyMultiplier = 2;

                    const roundData = {
                        roundNumber: room.roundNumber,
                        placement: scoreData.placement,
                        cardsLeft: scoreData.cardsLeft,
                        penaltyMultiplier: penaltyMultiplier,
                        roundPoints: scoreData.roundPoints,
                        cumulativeScore: room.cumulativeScores[scoreData.id] || 0,
                        plays: playStats.plays,
                        passes: playStats.passes,
                        leadsWon: playStats.leadsWon,
                        leadAttempts: playStats.tricksContested || 0,
                        handTypes: playStats.handTypes,
                        // Scored at deal time, before a card was played. Absent
                        // for rounds already in flight when the server restarted.
                        dealStrength: room.roundDealStrength[scoreData.id] || null
                    };

                    await saveRoundStats(room.gameId, user.id, room.gameMode, roundData);
                } catch (e) {
                    console.error("Failed to save round stats for", scoreData.name, e);
                }
            }
        }).catch(e => console.error("Round stats transaction failed:", e));

        // Flush this round's tape. Rounds are the unit of persistence: they
        // complete atomically, so a game abandoned later still leaves every
        // finished round intact and fully usable.
        await gamelogRecorder.recordRoundEnd(room, {
            endReason: 'normal',
            winnerSeat: room.seatOf(roundWinner.id),
            cardsLeft: room.players.map(p => (p.hand ? p.hand.length : 0)),
            roundPoints: room.players.map(p => {
                const score = roundScores.find(s => s.id === p.id);
                return score ? score.roundPoints : 0;
            }),
            scoreAfter: room.players.map(p => room.cumulativeScores[p.id] || 0)
        });

        const sanitizedRoundWinner = {
            id: roundWinner.id,
            name: roundWinner.name,
            isBot: roundWinner.isBot
        };

        io.to(roomId).emit('game_update', room.getGameState());

        if (isGameOver) {
            // Game is over - someone hit 100 points
            const gameWinner = room.getGameWinner();
            room.gameState = 'finished';

            const sanitizedGameWinner = {
                id: gameWinner.id,
                name: gameWinner.name,
                isBot: gameWinner.isBot
            };

            const gameResults = {
                winner: sanitizedGameWinner,
                scores: scoresWithCumulative,
                finalScores: room.cumulativeScores,
                roundNumber: room.roundNumber
            };

            // Store game results for reconnection handling
            room.lastGameResults = gameResults;
            room.gameState = 'finished';

            io.to(roomId).emit('game_over', gameResults);

            // Calculate final game placements BEFORE saving to database
            const finalPlacements = [...room.players].sort((a, b) => {
                const scoreA = room.cumulativeScores[a.id] || 0;
                const scoreB = room.cumulativeScores[b.id] || 0;
                return scoreA - scoreB; // Lower score = better placement
            }).map((p, index) => ({
                playerId: p.id,
                playerName: p.name,
                placement: index + 1
            }));

            // Save game history when game completes
            try {
                const endTime = new Date();
                const startTime = new Date(room.createdAt);
                const durationSeconds = Math.floor((endTime - startTime) / 1000);
                const winner = gameWinner.isBot ? null : await lookupUser(gameWinner.name);

                await withTransaction(async () => {
                    await saveGameHistory({
                        gameId: room.gameId,
                        roomName: room.id,
                        gameMode: room.gameMode,
                        isPublic: !room.isPrivate,
                        status: 'completed',
                        winnerId: winner ? winner.id : null,
                        winnerUsername: gameWinner.name,
                        startTime: startTime.toISOString(),
                        endTime: endTime.toISOString(),
                        durationSeconds: durationSeconds,
                        totalRounds: room.roundNumber,
                        maxPoints: room.pointThreshold
                    });

                    // Update participants with final placements
                    for (const p of finalPlacements) {
                        const player = room.players.find(pl => pl.id === p.playerId);
                        if (!player) continue;

                        // roundPlayStats is per-round and never carried a
                        // roundsWon field, so this was always 0. The per-game
                        // tally lives on the room, keyed by name.
                        const roundsWon = room.roundsWonByName[player.name] || 0;
                        const participant = player.isBot ? null : await lookupUser(player.name);
                        await saveGameParticipant({
                            gameId: room.gameId,
                            userId: participant ? participant.id : null,
                            username: player.name,
                            isBot: player.isBot,
                            finalPlacement: p.placement,
                            finalScore: room.cumulativeScores[p.playerId] || 0,
                            roundsWon: roundsWon
                        });
                    }

                    // Save notable events (e.g., perfect games, comebacks)
                    if (gameWinner && room.cumulativeScores[gameWinner.id] === 0) {
                        await saveGameEvent(room.gameId, 'perfect_game', {
                            winner: gameWinner.name
                        });
                    }
                });
            } catch (e) {
                console.error("Failed to save game history on completion:", e);
            }

            await gamelogRecorder.recordGameEnd(room, {
                endReason: 'threshold',
                winnerSeat: room.seatOf(gameWinner.id)
            });

            // 1. Fetch current ratings for all humans (mode-specific)
            // We need to fetch stats to get current mu/sigma
            // Exclude guests and mid-game joiners from rating calculations (treat as bots)
            const playersWithStats = await Promise.all(room.players.map(async (p) => {
                if (p.isBot || p.isGuest || p.joinedMidGame) return { ...p, isBot: true }; // Treat guests and mid-game joiners as bots for rating calc
                try {
                    const stats = await getUserStatsByMode(p.name, room.gameMode);
                    return {
                        ...p,
                        rating_mu: stats ? stats.rating_mu : undefined,
                        rating_sigma: stats ? stats.rating_sigma : undefined
                    };
                } catch (e) {
                    console.error("Error fetching stats for rating calc:", p.name, e);
                    return { ...p };
                }
            }));

            // 2. Calculate new ratings (mid-game joiners excluded from rating calculation)
            const newRatings = calculateNewRatings(playersWithStats, room.cumulativeScores);

            // Map new ratings by name for easy lookup
            const ratingUpdates = {};
            newRatings.forEach(r => {
                ratingUpdates[r.name] = { mu: r.mu, sigma: r.sigma };
            });

            // Sections 3 and 4 issue ~40 writes for a 4-human game (stats, ratings,
            // Tier 3 aggregates, and 12 head-to-head upserts). One transaction turns
            // that into a single commit.
            await withTransaction(async () => {
                // 3. Update DB for human players (final game results + ratings + aggregate stats, mode-specific)
                for (const p of room.players) {
                    // Skip bots, guests, and mid-game joiners (no stats recorded for guests or mid-game joiners)
                    if (p.joinedMidGame) {
                        console.log(`Skipping stats for ${p.name} (joined mid-game at round ${p.joinedAtRound} with score ${p.joinedWithScore})`);
                    }
                    if (!p.isBot && !p.isGuest && !p.joinedMidGame) {
                        try {
                            const isWinner = p.id === gameWinner.id;
                            const totalScore = room.cumulativeScores[p.id] || 0;
                            const newRating = ratingUpdates[p.name];
                            const playerPlacement = finalPlacements.find(fp => fp.playerId === p.id);

                            // Update game-level stats (wins/losses/points/rating)
                            await updateUserStatsByMode(
                                p.name,
                                room.gameMode,
                                isWinner,
                                totalScore,
                                newRating ? newRating.mu : null,
                                newRating ? newRating.sigma : null
                            );

                            // Update aggregate stats (placement, plays, passes, penalties)
                            if (playerPlacement) {
                                await updateAggregateStats(
                                    p.name,
                                    room.gameMode,
                                    playerPlacement.placement,
                                    room.gameId
                                );
                            }

                            // Calculate and save Tier 3 advanced analytics
                            const tier3Data = room.tier3DecisionTracking[p.id];
                            if (tier3Data && tier3Data.decisions.length > 0) {
                                try {
                                    const user = await lookupUser(p.name);
                                    if (user) {
                                        // Save all decisions in one batched insert rather than
                                        // one awaited statement per decision.
                                        try {
                                            await trackDecisionsBatch(
                                                room.gameId,
                                                user.id,
                                                room.roundNumber,
                                                tier3Data.decisions
                                            );
                                        } catch (err) {
                                            console.error("Failed to track decisions:", err);
                                        }

                                        // This game's rounds, for the behavioural
                                        // scores and the deal-luck read below.
                                        const gameSummary = await getGameRoundSummary(
                                            user.id,
                                            room.gameId,
                                            room.gameMode
                                        );

                                        // 1. Card Awareness Stats -- real per-decision
                                        // counts, not one increment per game.
                                        const decisionSummary = DecisionAnalyzer.summarizeDecisions(tier3Data.decisions);

                                        await updateCardAwarenessStats(
                                            user.id,
                                            room.gameMode,
                                            decisionSummary
                                        );

                                        // 2. Variance Stats (streaks)
                                        const isWinner = p.id === gameWinner.id;

                                        await updateVarianceStats(
                                            user.id,
                                            room.gameMode,
                                            isWinner
                                        );

                                        // 3. Save placement history for adaptability tracking
                                        if (playerPlacement) {
                                            await savePlacementHistory(
                                                user.id,
                                                room.gameMode,
                                                room.gameId,
                                                playerPlacement.placement
                                            );
                                        }

                                        // 4. Update variance/consistency scores based on placement history
                                        await updateVarianceScores(user.id, room.gameMode);

                                        // 5. Behavioral Stats
                                        //
                                        // Scored on THIS game and then smoothed by
                                        // updateBehavioralStats. Feeding in lifetime
                                        // totals, as this used to, averaged an
                                        // average and could never move.
                                        const aggressionScore = DecisionAnalyzer.calculateAggressionScore(
                                            gameSummary.plays || 0,
                                            gameSummary.passes || 0,
                                            gameSummary.leads_won || 0
                                        );

                                        // Risky plays and the decisions they are a
                                        // fraction of have to come from the same
                                        // population, so both are read back off the
                                        // row just updated.
                                        const lifetimeAwareness = await require('./db').getCardAwarenessStats(user.id, room.gameMode);
                                        const riskScore = DecisionAnalyzer.calculateRiskScore(
                                            lifetimeAwareness?.risky_plays_successful || 0,
                                            lifetimeAwareness?.risky_plays_failed || 0,
                                            lifetimeAwareness?.total_decisions || 0
                                        );

                                        // Get placement history for adaptability calculation
                                        const placementHistory = await getPlacementHistory(user.id, room.gameMode, 20);
                                        const adaptabilityScore = DecisionAnalyzer.calculateAdaptabilityScore(placementHistory);

                                        // Calculate early/late game phase-specific behaviors.
                                        //
                                        // Phase is a property of the round, read from
                                        // the deck remaining when each decision was
                                        // taken. Slicing the game's decision list by
                                        // index instead - as this used to - made
                                        // "early game" mean the first rounds of the
                                        // match rather than the opening of each round.
                                        const earlyDecisions = tier3Data.decisions.filter(
                                            d => DecisionAnalyzer.isEarlyGameDecision(d)
                                        );
                                        const lateDecisions = tier3Data.decisions.filter(
                                            d => DecisionAnalyzer.isLateGameDecision(d)
                                        );

                                        // Calculate early game aggression (play rate in early game)
                                        const earlyPlays = earlyDecisions.filter(d => d.action === 'play').length;
                                        const earlyGameAggression = earlyDecisions.length > 0 ? earlyPlays / earlyDecisions.length : 0.5;

                                        // Calculate late game risk (risky play rate in late game)
                                        const lateRiskyPlays = lateDecisions.filter(d => d.isRisky).length;
                                        const lateGameRisk = lateDecisions.length > 0 ? lateRiskyPlays / lateDecisions.length : 0.5;

                                        await updateBehavioralStats(
                                            user.id,
                                            room.gameMode,
                                            aggressionScore,
                                            riskScore,
                                            adaptabilityScore,
                                            earlyGameAggression,
                                            lateGameRisk
                                        );
                                    }
                                } catch (e) {
                                    console.error("Failed to update Tier 3 stats for", p.name, e);
                                }
                            }

                            // Update player object in room with new rating so UI updates
                            if (newRating) {
                                p.rating = calculateDisplayRating(newRating.mu, newRating.sigma);
                            }
                        } catch (e) {
                            console.error("Failed to update stats for", p.name, e);
                        }
                    }
                }

                // 4. Update head-to-head stats for all registered human player pairs (exclude guests)
                // Same exclusions as the game-level stats above: a mid-game
                // joiner did not play the whole game, so the result is not a
                // head-to-head record against them.
                const humanPlayers = room.players.filter(p => !p.isBot && !p.isGuest && !p.joinedMidGame);
                for (let i = 0; i < humanPlayers.length; i++) {
                    for (let j = i + 1; j < humanPlayers.length; j++) {
                        try {
                            const player1 = humanPlayers[i];
                            const player2 = humanPlayers[j];

                            const user1 = await lookupUser(player1.name);
                            const user2 = await lookupUser(player2.name);

                            if (user1 && user2) {
                                const placement1 = finalPlacements.find(fp => fp.playerId === player1.id);
                                const placement2 = finalPlacements.find(fp => fp.playerId === player2.id);

                                if (placement1 && placement2) {
                                    // Update player1's record vs player2
                                    await updateHeadToHeadStats(
                                        user1.id,
                                        user2.id,
                                        room.gameMode,
                                        placement1.placement,
                                        placement2.placement
                                    );

                                    // Update player2's record vs player1
                                    await updateHeadToHeadStats(
                                        user2.id,
                                        user1.id,
                                        room.gameMode,
                                        placement2.placement,
                                        placement1.placement
                                    );
                                }
                            }
                        } catch (e) {
                            console.error("Failed to update head-to-head stats:", e);
                        }
                    }
                }
            }).catch(e => console.error("Final stats transaction failed:", e));

        } else {
            // Round is over, but game continues
            const roundResults = {
                roundWinner: sanitizedRoundWinner,
                scores: scoresWithCumulative,
                roundNumber: room.roundNumber
            };

            // Store round results in room for reconnection handling
            room.lastRoundResults = roundResults;

            io.to(roomId).emit('round_over', roundResults);
        }
    };

    const handleNextRound = (room, roomId) => {
        room.roundNumber++;
        room.lastRoundResults = null; // Clear stored round results
        room.startRound();

        // Check if dragon was dealt (Hong Kong variation)
        if (room.gameState === 'dragon_win' && room.dragonWinner) {
            // Send hands first so players can see the dragon
            room.players.forEach(p => {
                if (!p.isBot) {
                    console.log(`Sending hand_update to ${p.name} (${p.id}) with DRAGON, ${p.hand?.length} cards`);
                    io.to(p.id).emit('hand_update', p.hand);
                }
            });
            emitSpectatorHands(room, roomId);
            // Handle dragon win
            handleDragonWin(room, roomId, room.dragonWinner);
            return;
        }

        const gameState = room.getGameState();
        console.log(`Next round ${room.roundNumber} starting. Current turn: ${gameState.currentTurn}, Players:`,
            room.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })));

        // Broadcast updated state
        io.to(roomId).emit('game_started', gameState);

        // Send individual hands
        room.players.forEach(p => {
            if (!p.isBot) {
                console.log(`Sending hand_update to ${p.name} (${p.id}), ${p.hand?.length} cards`);
                io.to(p.id).emit('hand_update', p.hand);
            }
        });
        emitSpectatorHands(room, roomId);

        // Check if first player is bot
        processBotTurns(room, roomId);
    };

    // Helper for recursive bot turns
    const processBotTurns = (room, roomId) => {
        room.checkBotTurn((result) => {
            if (result.type === 'roundOver') {
                // Add delay to show final winning card before round ends
                if (result.roundWinDelay) {
                    // Emit the game state first to show the winning card
                    io.to(roomId).emit('game_update', room.getGameState());
                    const timeoutId = setTimeout(() => {
                        // Validate state before proceeding
                        if (room.gameState !== 'round_over') {
                            console.log(`[Timeout] Skipping round over - game state changed`);
                            return;
                        }
                        room.clearRoundEndCards();
                        handleRoundOver(room, roomId, result.roundWinner);
                    }, 1500); // 1.5 second delay to see the winning card
                    room.registerTimeout('roundWin', timeoutId);
                } else {
                    handleRoundOver(room, roomId, result.roundWinner);
                }
            } else {
                io.to(roomId).emit('game_update', room.getGameState());
                // A bot just played, so spectators need the refreshed hands
                emitSpectatorHands(room, roomId);
                // Emit bot reasoning if debug mode is enabled
                if (room.debugMode && result.reasoning) {
                    io.to(roomId).emit('bot_reasoning', result.reasoning);
                }
                // If a trick was won, delay before clearing and continuing
                if (result.trickWinDelay) {
                    // Capture the current generation for validation
                    const generation = room.trickWinGeneration;
                    const timeoutId = setTimeout(() => {
                        // Validate state before clearing
                        if (room.gameState !== 'playing') {
                            console.log(`[Timeout] Skipping trick clear - game no longer playing`);
                            return;
                        }
                        if (room.clearTrickState(generation)) {
                            io.to(roomId).emit('game_update', room.getGameState());
                            // Continue checking if next player is bot
                            processBotTurns(room, roomId);
                        }
                    }, 1500); // 1.5 second delay to see the trick result
                    room.registerTimeout('trickWin', timeoutId);
                } else {
                    // Continue checking if next player is bot
                    processBotTurns(room, roomId);
                }
            }
        });
    };

    socket.on('get_room_state', ({ roomId }) => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Resolve the caller. Previously this handler served state to any socket
            // that knew a room ID and let it drive bot turns; both are now gated.
            const isPlayer = room.players.some(p => p.id === socket.id);
            const spectator = room.getSpectatorBySocketId(socket.id)
                // A spectator that hard-refreshed arrives with a new socket id, so
                // fall back to the username stashed on the socket.
                || (socket.spectatorUsername ? room.spectators.get(socket.spectatorUsername) : null);

            if (!isPlayer && !spectator) return;

            if (spectator) {
                // Re-bind the socket in case this is a post-refresh reconnect
                if (spectator.socketId !== socket.id) {
                    spectator.socketId = socket.id;
                    spectator.socket = socket;
                }
                socket.join(roomId);
                socket.spectatingRoomId = roomId;
                socket.spectatorUsername = spectator.username;

                socket.emit('spectating_room', { roomId, gameState: room.getGameState() });
                emitSpectatorHands(room, roomId);

                if (room.gameState === 'round_over' && room.lastRoundResults) {
                    socket.emit('round_over', room.lastRoundResults);
                }
                if (room.gameState === 'finished' && room.lastGameResults) {
                    socket.emit(room.lastGameResults.isDragonWin ? 'dragon_win' : 'game_over', room.lastGameResults);
                }
                return;
            }

            socket.emit('room_update', room.getGameState());
            // Also send hand if game is in progress or round is over
            if (room.gameState === 'playing' || room.gameState === 'round_over') {
                const hand = room.getPlayerHand(socket.id);
                console.log(`get_room_state: Sending hand to ${socket.id}: ${hand ? hand.length : 0} cards`);
                socket.emit('hand_update', hand);

                // Send round_over event if in round_over state
                if (room.gameState === 'round_over' && room.lastRoundResults) {
                    console.log(`get_room_state: Sending round_over to ${socket.id}`);
                    socket.emit('round_over', room.lastRoundResults);
                }

                // Check if current player is a bot and trigger bot turn processing
                if (room.gameState === 'playing') {
                    processBotTurns(room, roomId);
                }
            }

            // Send game_over event if the game is finished
            if (room.gameState === 'finished' && room.lastGameResults) {
                console.log(`get_room_state: Sending game_over to ${socket.id}`);
                if (room.lastGameResults.isDragonWin) {
                    socket.emit('dragon_win', room.lastGameResults);
                } else {
                    socket.emit('game_over', room.lastGameResults);
                }
            }
        }
    });

    socket.on('set_privacy', ({ isPrivate }) => {
        const result = roomManager.findRoomBySocketId(socket.id);
        if (!result) {
            return socket.emit('error', 'Not in a room');
        }

        const { room, roomId, player } = result;

        // Verify that the requesting player is the host
        if (!player || player.name !== room.hostUsername) {
            return socket.emit('error', 'Only the room host can change privacy settings');
        }

        const setResult = room.setPrivacy(isPrivate, player.name);
        if (setResult.error) {
            return socket.emit('error', setResult.error);
        }

        console.log(`Room ${roomId} privacy set to ${isPrivate ? 'private' : 'public'}`);

        // Notify all players in the room
        io.to(roomId).emit('room_update', room.getGameState());
    });

    socket.on('set_game_mode', async ({ gameMode }) => {
        const result = roomManager.findRoomBySocketId(socket.id);
        if (!result) {
            return socket.emit('error', 'Not in a room');
        }

        const { room, roomId, player } = result;

        // Verify that the requesting player is the host
        if (!player || player.name !== room.hostUsername) {
            return socket.emit('error', 'Only the room host can change the game mode');
        }

        // Only allow changing mode in waiting state
        const setResult = room.setGameMode(gameMode);
        if (setResult.error) {
            return socket.emit('error', setResult.error);
        }

        // Update all players' ratings for the selected game mode
        for (const player of room.players) {
            if (!player.isBot && player.name) {
                try {
                    const stats = await getUserStatsByMode(player.name, gameMode);
                    if (stats) {
                        player.rating = calculateDisplayRating(stats.rating_mu, stats.rating_sigma);
                    }
                } catch (e) {
                    console.error(`Error updating rating for ${player.name} in mode ${gameMode}:`, e);
                }
            }
        }

        // Broadcast updated state to all players in room
        io.to(roomId).emit('room_update', room.getGameState());
    });

    socket.on('start_game', async ({ roomId, useAdvancedBots }) => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Verify that the requesting player is the host
            const player = room.players.find(p => p.id === socket.id);
            if (!player || player.name !== room.hostUsername) {
                socket.emit('error', 'Only the room host can start the game');
                return;
            }

            room.startGame(useAdvancedBots);

            // Save game history entry when game starts
            try {
                await withTransaction(async () => {
                    await saveGameHistory({
                        gameId: room.gameId,
                        roomName: room.id,
                        gameMode: room.gameMode,
                        isPublic: !room.isPrivate,
                        status: 'in_progress',
                        winnerId: null,
                        winnerUsername: null,
                        startTime: new Date().toISOString(),
                        endTime: null,
                        durationSeconds: null,
                        totalRounds: 0,
                        maxPoints: room.pointThreshold
                    });

                    // Save initial participants
                    const lookupUser = createUserLookup();
                    for (const p of room.players) {
                        const user = p.isBot ? null : await lookupUser(p.name);
                        await saveGameParticipant({
                            gameId: room.gameId,
                            userId: user ? user.id : null,
                            username: p.name,
                            isBot: p.isBot,
                            finalPlacement: null,
                            finalScore: null,
                            roundsWon: 0
                        });
                    }
                });
            } catch (e) {
                console.error("Failed to save game history on start:", e);
            }

            // Open the ML game log for this game. Guarded internally: a failure
            // here must never stop a game from starting.
            await gamelogRecorder.recordGameStart(room);

            // Check if dragon was dealt (Hong Kong variation)
            if (room.gameState === 'dragon_win' && room.dragonWinner) {
                // Send hands first so players can see the dragon
                room.players.forEach(p => {
                    if (!p.isBot) {
                        io.to(p.id).emit('hand_update', p.hand);
                    }
                });
                emitSpectatorHands(room, roomId);
                // Handle dragon win
                handleDragonWin(room, roomId, room.dragonWinner);
                return;
            }

            // Normal game start
            // Broadcast full state
            io.to(roomId).emit('game_started', room.getGameState());
            // Send individual hands
            room.players.forEach(p => {
                if (!p.isBot) {
                    io.to(p.id).emit('hand_update', p.hand);
                }
            });

            // Check if first player is bot
            processBotTurns(room, roomId);
        }
    });

    socket.on('play_card', ({ roomId, cards }) => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Reject spectators explicitly. playHand() would already fail them with
            // 'Not your turn', but the error branch below emits an empty hand_update
            // that would clobber the spectator's client state.
            if (room.isSpectator(socket.id)) {
                return socket.emit('error', 'Spectators cannot play');
            }
            const result = room.playHand(socket.id, cards);
            if (result.error) {
                socket.emit('error', result.error);
                // Restore the player's hand on the client (undo optimistic update)
                socket.emit('hand_update', room.getPlayerHand(socket.id));
            } else {
                io.to(roomId).emit('game_update', room.getGameState());
                socket.emit('hand_update', room.getPlayerHand(socket.id));
                emitSpectatorHands(room, roomId);

                if (result.roundOver) {
                    // Add delay to show final winning card before round ends
                    if (result.roundWinDelay) {
                        const timeoutId = setTimeout(() => {
                            // Validate state before proceeding
                            if (room.gameState !== 'round_over') {
                                console.log(`[Timeout] Skipping round over - game state changed`);
                                return;
                            }
                            room.clearRoundEndCards();
                            handleRoundOver(room, roomId, result.roundWinner);
                        }, 1500); // 1.5 second delay to see the winning card
                        room.registerTimeout('roundWin', timeoutId);
                    } else {
                        handleRoundOver(room, roomId, result.roundWinner);
                    }
                } else if (result.trickWinDelay) {
                    // Big 2 was played or trick was won - delay before clearing state
                    // This gives players time to see the winning hand and passes
                    const generation = room.trickWinGeneration;
                    const timeoutId = setTimeout(() => {
                        // Validate state before clearing
                        if (room.gameState !== 'playing') {
                            console.log(`[Timeout] Skipping trick clear - game no longer playing`);
                            return;
                        }
                        if (room.clearTrickState(generation)) {
                            io.to(roomId).emit('game_update', room.getGameState());
                            // Check if next player is bot
                            processBotTurns(room, roomId);
                        }
                    }, 1500); // 1.5 second delay to see the trick result
                    room.registerTimeout('trickWin', timeoutId);
                } else {
                    // Check if next player is bot
                    processBotTurns(room, roomId);
                }
            }
        }
    });

    socket.on('next_round', ({ roomId }) => {
        const room = roomManager.getRoom(roomId);
        if (room && room.isSpectator(socket.id)) {
            return socket.emit('error', 'Spectators cannot advance the round');
        }
        if (room && room.gameState === 'round_over' && !room.roundTransitionInProgress) {
            room.roundTransitionInProgress = true;
            handleNextRound(room, roomId);
        }
    });

    socket.on('pass_turn', ({ roomId, auto }) => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            if (room.isSpectator(socket.id)) {
                return socket.emit('error', 'Spectators cannot pass');
            }
            // `auto` marks a pass the client's auto-pass preference made on the
            // player's behalf. The server cannot otherwise tell: auto-pass emits
            // an identical event, with a randomized 1-3s delay deliberately
            // chosen so opponents cannot distinguish it either.
            const result = room.passTurn(socket.id, { auto: Boolean(auto) });
            if (result.error) {
                socket.emit('error', result.error);
            } else {
                io.to(roomId).emit('game_update', room.getGameState());
                if (result.trickWinDelay) {
                    // Trick was won by passing - delay before clearing state
                    // This gives players time to see all the passes before the trick clears
                    const generation = room.trickWinGeneration;
                    const timeoutId = setTimeout(() => {
                        // Validate state before clearing
                        if (room.gameState !== 'playing') {
                            console.log(`[Timeout] Skipping trick clear - game no longer playing`);
                            return;
                        }
                        if (room.clearTrickState(generation)) {
                            io.to(roomId).emit('game_update', room.getGameState());
                            // Check if next player is bot
                            processBotTurns(room, roomId);
                        }
                    }, 1500); // 1.5 second delay to see the trick result
                    room.registerTimeout('trickWin', timeoutId);
                } else {
                    // Check if next player is bot
                    processBotTurns(room, roomId);
                }
            }
        }
    });

    // Debug mode toggle
    socket.on('toggle_debug', ({ roomId, enabled }) => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Require a seat. Previously any socket that knew a room ID could flip
            // debug mode on and make the room broadcast bot reasoning.
            if (!room.players.some(p => p.id === socket.id)) {
                return socket.emit('error', 'You are not in this room');
            }
            room.setDebugMode(enabled);
            io.to(roomId).emit('game_update', room.getGameState());
            console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'} for room ${roomId}`);
        }
    });

    socket.on('kick_player', ({ roomId, kickedPlayerId }) => {
        console.log(`Kick player request: roomId=${roomId}, kickedPlayerId=${kickedPlayerId}, requester=${socket.id}`);

        const room = roomManager.getRoom(roomId);
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        const requester = room.players.find(p => p.id === socket.id);
        if (!requester) {
            socket.emit('error', 'You are not in this room');
            return;
        }

        const result = room.kickPlayer(kickedPlayerId, requester.name);
        if (result.error) {
            socket.emit('error', result.error);
            return;
        }

        // Notify the kicked player
        const kickedSocket = io.sockets.sockets.get(kickedPlayerId);
        if (kickedSocket) {
            kickedSocket.emit('kicked_from_room', {
                roomId: roomId,
                message: `You have been kicked from the room by the host`
            });
            kickedSocket.leave(roomId);
        }

        // Notify all players in the room
        if (result.replacedWithBot) {
            io.to(roomId).emit('player_kicked', {
                playerName: result.kickedPlayer.name,
                replacedWithBot: true,
                botName: result.botPlayer.name
            });
        } else {
            io.to(roomId).emit('player_kicked', {
                playerName: result.kickedPlayer.name,
                replacedWithBot: false
            });
        }

        // Send updated room state
        io.to(roomId).emit('room_update', room.getGameState());
        console.log(`Player ${result.kickedPlayer.name} was kicked from room ${roomId}`);
    });

    socket.on('leave_room', ({ roomId }) => {
        console.log(`User ${socket.id} leaving room ${roomId}`);

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const playerName = player.name;

        // Remove player from room
        if (room.gameState === 'waiting') {
            // During waiting state, just remove the player
            room.removePlayer(socket.id);
            socket.leave(roomId);

            // Notify other players
            io.to(roomId).emit('room_update', room.getGameState());
            console.log(`Player ${playerName} left room ${roomId}`);

            // If room is empty, delete it
            if (room.players.length === 0) {
                evictSpectators(room, roomId, 'All players left');
                roomManager.deleteRoom(roomId);
                console.log(`Room ${roomId} deleted (empty)`);
            }
        } else {
            // During active game, replace the player with an Advanced Bot
            const replacement = room.replaceWithBot(socket.id);
            if (replacement) {
                gamelogRecorder.recordSeatChange(room, room.seatOf(replacement.botPlayer.id));
            }
            socket.leave(roomId);

            if (replacement) {
                console.log(`Player ${playerName} left and was replaced by ${replacement.botPlayer.name} in room ${roomId}`);

                // Check if the room now has only bots - if so, delete it
                if (room.hasOnlyBots()) {
                    console.log(`Room ${roomId} now has only bots, deleting room`);
                    evictSpectators(room, roomId, 'All players left');
                    roomManager.deleteRoom(roomId);
                    return;
                }

                // Notify other players about the replacement
                io.to(roomId).emit('room_update', room.getGameState());
                io.to(roomId).emit('player_disconnected', {
                    playerName: playerName,
                    replacedWithBot: true,
                    botName: replacement.botPlayer.name
                });

                // If it was the leaving player's turn, trigger bot to play immediately
                if (replacement.wasCurrentTurn && room.gameState === 'playing') {
                    console.log(`It was ${playerName}'s turn, triggering bot to play`);
                    processBotTurns(room, roomId);
                }
            }
        }
    });

    // ============ Post-Game Flow Events ============

    // Non-host player indicates they're ready for next game
    socket.on('player_ready', ({ roomId }) => {
        console.log(`player_ready: ${socket.id} in room ${roomId}`);

        const room = roomManager.getRoom(roomId);
        if (!room) {
            return socket.emit('error', 'Room not found');
        }

        if (room.gameState !== 'finished') {
            return socket.emit('error', 'Game is not finished');
        }

        const result = room.setPlayerReady(socket.id);
        if (result.error) {
            return socket.emit('error', result.error);
        }

        // Broadcast ready status to all players
        const readyStatus = room.getReadyStatus();
        io.to(roomId).emit('ready_status', readyStatus);
        console.log(`Ready status for room ${roomId}:`, readyStatus);
    });

    // Host initiates rematch (instant new game)
    socket.on('host_rematch', async ({ roomId }) => {
        console.log(`host_rematch: ${socket.id} in room ${roomId}`);

        const room = roomManager.getRoom(roomId);
        if (!room) {
            return socket.emit('error', 'Room not found');
        }

        if (room.gameState !== 'finished') {
            return socket.emit('error', 'Game is not finished');
        }

        // Verify requester is host
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.name !== room.hostUsername) {
            return socket.emit('error', 'Only the host can start a rematch');
        }

        // Check if all non-host players are ready
        if (!room.allPlayersReady()) {
            const readyStatus = room.getReadyStatus();
            return socket.emit('error', `Waiting for players to be ready: ${readyStatus.notReady.join(', ')}`);
        }

        // Start the rematch
        const gameState = room.startRematch();
        if (gameState.error) {
            return socket.emit('error', gameState.error);
        }

        // Save new game history
        try {
            await withTransaction(async () => {
                await saveGameHistory({
                    gameId: room.gameId,
                    roomName: room.id,
                    gameMode: room.gameMode,
                    isPublic: !room.isPrivate,
                    status: 'in_progress',
                    winnerId: null,
                    winnerUsername: null,
                    startTime: new Date().toISOString(),
                    endTime: null,
                    durationSeconds: null,
                    totalRounds: 0,
                    maxPoints: room.pointThreshold
                });

                // Save initial participants
                const lookupUser = createUserLookup();
                for (const p of room.players) {
                    const user = p.isBot ? null : await lookupUser(p.name);
                    await saveGameParticipant({
                        gameId: room.gameId,
                        userId: user ? user.id : null,
                        username: p.name,
                        isBot: p.isBot,
                        finalPlacement: null,
                        finalScore: null,
                        roundsWon: 0
                    });
                }
            });
        } catch (e) {
            console.error("Failed to save game history for rematch:", e);
        }

        // Check for dragon
        if (room.gameState === 'dragon_win' && room.dragonWinner) {
            room.players.forEach(p => {
                if (!p.isBot) {
                    io.to(p.id).emit('hand_update', p.hand);
                }
            });
            emitSpectatorHands(room, roomId);
            handleDragonWin(room, roomId, room.dragonWinner);
            return;
        }

        // Normal game start
        io.to(roomId).emit('game_started', room.getGameState());
        room.players.forEach(p => {
            if (!p.isBot) {
                io.to(p.id).emit('hand_update', p.hand);
            }
        });
        emitSpectatorHands(room, roomId);

        console.log(`Rematch started in room ${roomId}`);
        processBotTurns(room, roomId);
    });

    // Host sends everyone back to lobby
    socket.on('host_back_to_lobby', ({ roomId }) => {
        console.log(`host_back_to_lobby: ${socket.id} in room ${roomId}`);

        const room = roomManager.getRoom(roomId);
        if (!room) {
            return socket.emit('error', 'Room not found');
        }

        if (room.gameState !== 'finished') {
            return socket.emit('error', 'Game is not finished');
        }

        // Verify requester is host
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.name !== room.hostUsername) {
            return socket.emit('error', 'Only the host can send everyone back to lobby');
        }

        // Transition room to lobby
        const result = room.transitionToLobby();
        if (result.error) {
            return socket.emit('error', result.error);
        }

        // Notify all players to go to lobby
        io.to(roomId).emit('lobby_ready', {
            roomId: result.roomId,
            players: result.players,
            hostUsername: result.hostUsername
        });

        // Also send updated room state
        io.to(roomId).emit('room_update', room.getGameState());

        console.log(`Room ${roomId} transitioned back to lobby with ${result.players.length} players`);
    });

    // Player leaves after game ends (goes to main lobby)
    socket.on('leave_after_game', ({ roomId }) => {
        console.log(`leave_after_game: ${socket.id} in room ${roomId}`);

        const room = roomManager.getRoom(roomId);
        if (!room) {
            return socket.emit('error', 'Room not found');
        }

        if (room.gameState !== 'finished') {
            return socket.emit('error', 'Game is not finished');
        }

        // Remove the player
        const result = room.removePlayerPostGame(socket.id);
        if (result.error) {
            return socket.emit('error', result.error);
        }

        // Leave the socket room
        socket.leave(roomId);

        // If host changed, notify everyone
        if (result.wasHost && result.newHost) {
            io.to(roomId).emit('host_changed', { newHost: result.newHost });
        }

        // Notify other players
        io.to(roomId).emit('player_left', { playerName: result.removedPlayer });

        // If only 1 human remains, they can't rematch - cancel and send to main lobby
        if (result.remainingHumans === 1) {
            io.to(roomId).emit('game_cancelled', {
                reason: 'Not enough players for rematch'
            });
            console.log(`Room ${roomId}: Only 1 human left, game cancelled`);
        } else if (result.remainingHumans === 0) {
            // No humans left, delete room
            evictSpectators(room, roomId, 'All players left');
            roomManager.deleteRoom(roomId);
            console.log(`Room ${roomId} deleted (no humans left)`);
        } else {
            // Update ready status for remaining players
            const readyStatus = room.getReadyStatus();
            io.to(roomId).emit('ready_status', readyStatus);
            io.to(roomId).emit('room_update', room.getGameState());
        }

        console.log(`Player ${result.removedPlayer} left room ${roomId} after game`);
    });

    // Voice Chat WebRTC Signaling Events

    socket.on('voice:join', ({ roomId, username }) => {
        console.log(`Voice join: ${username} joining voice in room ${roomId}`);

        // Make sure socket joins the room for broadcasting
        socket.join(roomId);

        if (!voiceRooms[roomId]) {
            voiceRooms[roomId] = new Set();
        }

        // Get users BEFORE adding the new user (for room state)
        const existingUsers = Array.from(voiceRooms[roomId]);

        // Store username with socket id for tracking
        socket.voiceUsername = username;
        socket.voiceRoomId = roomId;
        voiceRooms[roomId].add(username);

        console.log(`Voice room ${roomId} now has users:`, Array.from(voiceRooms[roomId]));

        // Send current voice room state to the joining user (existing users before they joined)
        // This tells them who to connect to
        socket.emit('voice:room-state', {
            users: existingUsers  // Send who was already in the room
        });

        // Re-apply a host mute on (re)joining voice, so toggling voice off and back
        // on isn't a way to clear it.
        const gameRoom = roomManager.getRoom(roomId);
        if (gameRoom && gameRoom.isSpectatorMuted(username)) {
            socket.emit('voice:force-muted', { muted: true });
        }

        // Notify others in room that user joined voice
        socket.to(roomId).emit('voice:user-joined', { userId: username });

        // Broadcast voice user count to EVERYONE in the room (including non-voice users)
        io.to(roomId).emit('voice:user-count', {
            count: voiceRooms[roomId].size,
            users: Array.from(voiceRooms[roomId])
        });
    });

    socket.on('voice:signal', ({ to, signal }) => {
        // Forward WebRTC signaling data between peers
        const from = socket.voiceUsername;
        console.log(`Voice signal from ${from} to ${to}, signal type: ${signal.type}`);

        if (from && to) {
            // Find the target socket by username
            const targetSocket = [...io.sockets.sockets.values()].find(
                s => s.voiceUsername === to && s.voiceRoomId === socket.voiceRoomId
            );

            if (targetSocket) {
                console.log(`Forwarding signal from ${from} to ${to}`);
                targetSocket.emit('voice:signal', { from, signal });
            } else {
                console.log(`Target socket not found for ${to} in room ${socket.voiceRoomId}`);
            }
        } else {
            console.log(`Missing from (${from}) or to (${to}) in signal`);
        }
    });

    socket.on('voice:mute', ({ muted }) => {
        // Broadcast mute state to others in the room
        if (socket.voiceRoomId && socket.voiceUsername) {
            socket.to(socket.voiceRoomId).emit('voice:user-muted', {
                userId: socket.voiceUsername,
                muted
            });
        }
    });

    socket.on('voice:leave', () => {
        // Handle explicit voice leave
        if (socket.voiceRoomId && socket.voiceUsername) {
            const roomId = socket.voiceRoomId;
            const username = socket.voiceUsername;

            if (voiceRooms[roomId]) {
                voiceRooms[roomId].delete(username);

                // Broadcast updated voice user count to everyone in the room
                io.to(roomId).emit('voice:user-count', {
                    count: voiceRooms[roomId].size,
                    users: Array.from(voiceRooms[roomId])
                });

                if (voiceRooms[roomId].size === 0) {
                    delete voiceRooms[roomId];
                }
            }

            // Notify others in room
            socket.to(roomId).emit('voice:user-left', { userId: username });

            // Clean up socket properties
            delete socket.voiceUsername;
            delete socket.voiceRoomId;
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${socket.id}, reason: ${reason}`);

        // Clean up spectator seat. Never delete the room here - the players remain.
        if (socket.spectatingRoomId && socket.spectatorUsername) {
            const specRoom = roomManager.getRoom(socket.spectatingRoomId);
            if (specRoom) {
                const spec = specRoom.spectators.get(socket.spectatorUsername);
                // Only remove if this socket still owns the seat; a newer socket for
                // the same username (reconnect/second tab) must not be evicted here.
                if (spec && spec.socketId === socket.id) {
                    specRoom.removeSpectator(socket.spectatorUsername);
                    io.to(socket.spectatingRoomId).emit('room_update', specRoom.getGameState());
                }
            }
        }

        // Clean up voice chat if user was in voice
        if (socket.voiceRoomId && socket.voiceUsername) {
            const roomId = socket.voiceRoomId;
            const username = socket.voiceUsername;

            if (voiceRooms[roomId]) {
                voiceRooms[roomId].delete(username);

                // Broadcast updated voice user count to everyone in the room
                io.to(roomId).emit('voice:user-count', {
                    count: voiceRooms[roomId].size,
                    users: Array.from(voiceRooms[roomId])
                });

                if (voiceRooms[roomId].size === 0) {
                    delete voiceRooms[roomId];
                }
            }

            // Notify others in room
            socket.to(roomId).emit('voice:user-left', { userId: username });
        }

        // Find which room this player was in
        const result = roomManager.findRoomBySocketId(socket.id);
        if (result) {
            const { roomId, room, player } = result;

            // Mark player as disconnected (not removed, so they can reconnect)
            const disconnectedPlayer = room.markDisconnected(socket.id);
            if (disconnectedPlayer) {
                console.log(`Player ${disconnectedPlayer.name} marked as disconnected in room ${roomId}`);

                // Notify other players
                io.to(roomId).emit('room_update', room.getGameState());
                io.to(roomId).emit('player_disconnected', { playerName: disconnectedPlayer.name });
            }
        }
    });
});

// Debug endpoint for production data inspection (TEMPORARY - REMOVE AFTER DEBUGGING)
app.get('/api/debug/game/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { db } = require('./db');

        // Get game history
        const game = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM game_history WHERE game_id = ?`, [gameId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Get participants
        const participants = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM game_participants WHERE game_id = ?`, [gameId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({ game, participants });
    } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Activity Feed Routes
app.get('/api/activity', async (req, res) => {
    try {
        const { userId, status, gameMode, page = 1, limit = 20 } = req.query;

        // Parse status filter
        let includeStatus = ['completed'];
        if (status) {
            if (status === 'all') {
                includeStatus = ['completed', 'abandoned'];
            } else {
                includeStatus = status.split(',');
            }
        }

        const offset = (page - 1) * limit;

        const games = await getActivityFeed({
            userId: userId ? parseInt(userId) : null,
            includeStatus,
            gameMode: gameMode || null,
            limit: parseInt(limit),
            offset: offset
        });

        const totalCount = await getActivityFeedCount({
            userId: userId ? parseInt(userId) : null,
            includeStatus,
            gameMode: gameMode || null
        });

        res.json({
            games,
            pagination: {
                total: totalCount,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching activity feed:', error);
        res.status(500).json({ error: 'Failed to fetch activity feed' });
    }
});

// Auth Routes
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    try {
        const user = await createUser(username, password);
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: 'Username taken or invalid' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await verifyUser(username, password);
        if (user) {
            res.json({ success: true, user });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== GOOGLE OAUTH ROUTES ==========

// Initialize Google OAuth client
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Verify Google ID token
async function verifyGoogleToken(idToken) {
    if (!googleClient) {
        throw new Error('Google OAuth not configured');
    }
    const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID
    });
    return ticket.getPayload();
}

// Helper function to generate username suggestion from Google profile.
// The result is pre-validated against the same rules /api/auth/google/register
// enforces (3-20 chars, [a-zA-Z0-9_], not taken) so the suggestion the user is
// shown can actually be submitted. Google display names routinely sanitize down
// to something too short ("Al", "J.D." -> "JD") or collide with an existing
// account, and an invalid suggestion turns into a dead end on the signup form.
async function generateUsername(email, name) {
    // Try name first, then email prefix
    let base = name ? name.replace(/\s+/g, '') : email.split('@')[0];
    base = base.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 15);

    // Pad short bases rather than emitting one the register endpoint will reject.
    if (base.length < 3) base = base ? `${base}Player` : 'Player';

    if (await isUsernameAvailable(base)) return base;

    // Taken - append a numeric suffix, keeping the whole thing within 20 chars.
    for (let i = 0; i < 50; i++) {
        const suffix = String(Math.floor(1000 + Math.random() * 9000));
        const candidate = `${base.substring(0, 20 - suffix.length)}${suffix}`;
        if (await isUsernameAvailable(candidate)) return candidate;
    }

    // Fall back to the raw base and let the user edit it on the form.
    return base;
}

// Google OAuth Login/Register endpoint
app.post('/api/auth/google', async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ error: 'Missing ID token' });
    }

    if (!googleClient) {
        return res.status(500).json({ error: 'Google OAuth not configured on server' });
    }

    try {
        // Verify the Google token
        const payload = await verifyGoogleToken(idToken);
        const { sub: googleId, email, name } = payload;

        // Check if user exists with this Google ID
        const user = await getUserByGoogleId(googleId);

        if (user) {
            // Existing Google user - log them in
            return res.json({
                success: true,
                user: { id: user.id, username: user.username },
                isNewUser: false
            });
        }

        // New Google user - need to choose between create or link
        // Generate a username suggestion from email or name
        const suggestedUsername = await generateUsername(email, name);

        return res.json({
            success: false,
            needsAction: true,
            suggestedUsername,
            googleEmail: email
        });

    } catch (err) {
        console.error('Google auth error:', err);
        res.status(401).json({ error: 'Invalid Google token' });
    }
});

// Complete Google registration (create new account for Google users)
app.post('/api/auth/google/register', async (req, res) => {
    const { idToken, username } = req.body;

    if (!idToken || !username) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    if (!googleClient) {
        return res.status(500).json({ error: 'Google OAuth not configured on server' });
    }

    try {
        const payload = await verifyGoogleToken(idToken);
        const { sub: googleId, email } = payload;

        // Validate username
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username must be 3-20 characters' });
        }

        // Check for invalid characters
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
        }

        // Check username availability
        const available = await isUsernameAvailable(username);
        if (!available) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Check if this Google account is already linked to another user
        const existingGoogleUser = await getUserByGoogleId(googleId);
        if (existingGoogleUser) {
            return res.status(400).json({ error: 'This Google account is already registered' });
        }

        // Create the user
        const user = await createGoogleUser(username, googleId, email);
        res.json({ success: true, user: { id: user.id, username: user.username } });

    } catch (err) {
        console.error('Google registration error:', err);
        // The availability check above is not atomic with the insert, so a
        // collision can still surface here as a UNIQUE constraint failure.
        // Report it as the actionable "pick another name" rather than a generic
        // failure the user can't do anything about.
        if (/UNIQUE constraint failed/i.test(err.message || '')) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        res.status(400).json({ error: 'Registration failed' });
    }
});

// Link Google account to existing user (requires password verification)
app.post('/api/auth/google/link', async (req, res) => {
    const { idToken, username, password } = req.body;

    if (!idToken || !username || !password) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    if (!googleClient) {
        return res.status(500).json({ error: 'Google OAuth not configured on server' });
    }

    try {
        // Verify existing credentials
        const user = await verifyUser(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify Google token
        const payload = await verifyGoogleToken(idToken);
        const { sub: googleId, email } = payload;

        // Check if this Google account is already linked to another user
        const existingGoogleUser = await getUserByGoogleId(googleId);
        if (existingGoogleUser) {
            return res.status(400).json({ error: 'This Google account is already linked to another user' });
        }

        // Link the accounts
        await linkGoogleAccount(user.id, googleId, email);

        res.json({
            success: true,
            user: { id: user.id, username: user.username },
            message: 'Google account linked successfully'
        });

    } catch (err) {
        console.error('Google link error:', err);
        res.status(400).json({ error: 'Failed to link account' });
    }
});

// User Preferences Routes
app.get('/api/preferences/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const preferences = await getUserPreferences(userId);
        res.json({
            fourColorMode: preferences.four_color_mode === 1,
            autoPass: preferences.auto_pass === 1,
            tableTheme: preferences.table_theme || 'felt',
            accentColor: preferences.accent_color || 'gold',
            reducedMotion: preferences.reduced_motion === 1,
            // Sound defaults to on, so treat a missing column as enabled.
            soundEnabled: (preferences.sound_enabled ?? 1) === 1,
            soundVolume: preferences.sound_volume ?? 0.6,
            // null when the player has never picked one
            avatarAnimal: preferences.avatar_animal ?? null,
            avatarTile: preferences.avatar_tile ?? null
        });
    } catch (err) {
        console.error('Error fetching preferences:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/preferences/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { fourColorMode, autoPass, tableTheme, accentColor, reducedMotion, soundEnabled, soundVolume } = req.body;
        await updateUserPreferences(userId, { fourColorMode, autoPass, tableTheme, accentColor, reducedMotion, soundEnabled, soundVolume });
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating preferences:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Save the avatar chosen in the picker. Kept off the preferences POST so the
// periodic preference sync can never clobber an avatar with a stale value.
app.post('/api/avatar/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (!Number.isInteger(userId)) {
            return res.status(400).json({ error: 'Invalid user' });
        }
        const avatar = normalizeAvatar(req.body?.animal, req.body?.tile);
        if (!avatar) {
            return res.status(400).json({ error: 'Unknown avatar' });
        }
        await updateUserPreferences(userId, { avatarAnimal: avatar.animal, avatarTile: avatar.tile });
        res.json({ success: true, ...avatar });
    } catch (err) {
        console.error('Error saving avatar:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Batch avatar lookup by username, so a client can render everyone at a table
// (or in a leaderboard row) with the avatar they actually chose.
app.get('/api/avatars', async (req, res) => {
    try {
        const raw = typeof req.query.usernames === 'string' ? req.query.usernames : '';
        const names = [...new Set(raw.split(',').map(n => n.trim()).filter(Boolean))].slice(0, 60);
        const rows = await getAvatarsByUsernames(names);
        const avatars = {};
        for (const row of rows) {
            const avatar = normalizeAvatar(row.avatar_animal, row.avatar_tile);
            if (avatar) avatars[row.username] = avatar;
        }
        res.json({ avatars });
    } catch (err) {
        console.error('Error fetching avatars:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/stats/:username', async (req, res) => {
    try {
        const stats = await getUserStats(req.params.username);
        if (stats) res.json(stats);
        else res.status(404).json({ error: 'User not found' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get detailed stats with round aggregates and combination usage
app.get('/api/stats/:username/detailed', async (req, res) => {
    try {
        const { username } = req.params;
        const mode = req.query.mode || 'standard'; // default to standard

        // 1. Get user ID
        const user = await getUserByUsername(username);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 2. Get game-level stats (existing)
        const gameStats = await getUserStatsByMode(username, mode);

        // 3. Get aggregated round stats
        const roundAggregates = await getRoundAggregates(user.id, mode);

        // 4. Get combination type usage
        const combinationStats = await getCombinationStats(user.id, mode);

        res.json({
            username,
            mode,
            gameStats: gameStats || {},
            roundAggregates: roundAggregates || {},
            combinationStats: combinationStats || {}
        });
    } catch (err) {
        console.error('Error fetching detailed stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get recent round history
app.get('/api/stats/:username/rounds', async (req, res) => {
    try {
        const { username } = req.params;
        const mode = req.query.mode || 'standard';
        const limit = parseInt(req.query.limit) || 20;

        const user = await getUserByUsername(username);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const rounds = await getRecentRounds(user.id, mode, limit);
        res.json({ rounds });
    } catch (err) {
        console.error('Error fetching round history:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get head-to-head stats
app.get('/api/stats/:username/head-to-head', async (req, res) => {
    try {
        const { username } = req.params;
        const mode = req.query.mode || 'standard';

        const user = await getUserByUsername(username);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const h2hStats = await getHeadToHeadStats(user.id, mode);
        res.json({ headToHead: h2hStats });
    } catch (err) {
        console.error('Error fetching head-to-head stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Tier 3 advanced analytics stats
app.get('/api/stats/:username/tier3', async (req, res) => {
    try {
        const { username } = req.params;
        const mode = req.query.mode || 'standard';

        const user = await getUserByUsername(username);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const tier3Stats = await getTier3Stats(user.id, mode);
        res.json(tier3Stats);
    } catch (err) {
        console.error('Error fetching Tier 3 stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Deal strength vs. outcome: did the player do better or worse than the cards
 * they were dealt would predict?
 *
 * Returns three scopes - `all`, `vsBots` (three bots at the table) and
 * `vsHumans` (at least one human opponent). Bot rounds are the bulk of play, so
 * they are reported rather than discarded, but kept separable so a strong
 * player farming bots does not read as a strong player generally.
 */
app.get('/api/stats/:username/hand-strength', async (req, res) => {
    try {
        const { username } = req.params;
        const mode = req.query.mode || 'standard';

        const user = await getUserByUsername(username);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { byTier, byRank } = await getDealStrengthStats(user.id, mode);
        res.json(buildHandStrengthResponse(byTier, byRank));
    } catch (err) {
        console.error('Error fetching hand strength stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Shape the raw per-tier rows into the three scopes the client renders.
 * Pure, so it is unit-testable without a database.
 */
function buildHandStrengthResponse(byTier, byRank) {
    const scopes = { all: null, vsBots: null, vsHumans: null };
    const matchers = {
        all: () => true,
        vsBots: row => row.vs_humans === 0,
        vsHumans: row => row.vs_humans === 1
    };

    for (const [scope, matches] of Object.entries(matchers)) {
        const tierRows = byTier.filter(matches);
        const rankRows = byRank.filter(matches);

        const tiers = DEAL_TIERS.map((tier, index) => {
            const rows = tierRows.filter(r => r.deal_tier === index);
            const rounds = rows.reduce((s, r) => s + r.rounds, 0);
            const wins = rows.reduce((s, r) => s + r.wins, 0);
            // Weighted so multi-row (bot + human) merges average correctly.
            const points = rows.reduce((s, r) => s + r.avg_points * r.rounds, 0);
            return {
                key: tier.key,
                label: tier.label,
                rounds,
                wins,
                winRate: rounds > 0 ? wins / rounds : null,
                avgPoints: rounds > 0 ? points / rounds : null,
                expectedWinRate: tier.winRate,
                expectedPoints: tier.avgPoints
            };
        });

        const rounds = tiers.reduce((s, t) => s + t.rounds, 0);
        const wins = tiers.reduce((s, t) => s + t.wins, 0);
        const expectedWins = tiers.reduce((s, t) => s + t.rounds * t.expectedWinRate, 0);
        const expectedPoints = tiers.reduce((s, t) => s + t.rounds * t.expectedPoints, 0);
        const actualPoints = tiers.reduce((s, t) => s + (t.avgPoints || 0) * t.rounds, 0);
        const avgRaw = rounds > 0
            ? rankRows.reduce((s, r) => s + r.avg_raw * r.rounds, 0) / rounds
            : null;

        scopes[scope] = {
            rounds,
            // Deal Luck: how kind the deal has been. Pure variance, and the
            // reason Edge is worth computing at all.
            avgDealPercentile: avgRaw === null ? null : Math.round(percentileForRaw(avgRaw)),
            avgDealRank: rounds > 0
                ? rankRows.reduce((s, r) => s + r.avg_rank * r.rounds, 0) / rounds
                : null,
            // Edge: results minus what those deals were worth. The skill number.
            winRateAboveExpected: rounds > 0 ? (wins - expectedWins) / rounds : null,
            pointsSavedPerRound: rounds > 0 ? (expectedPoints - actualPoints) / rounds : null,
            // 95% CI half-widths, from the measured residual SD per round. The
            // per-round variance in this game is large enough that omitting
            // these would present noise as a verdict.
            winRateConfidence: rounds > 0 ? 1.96 * RESIDUAL_SD_WIN / Math.sqrt(rounds) : null,
            pointsConfidence: rounds > 0 ? 1.96 * RESIDUAL_SD_POINTS / Math.sqrt(rounds) : null,
            confidence: confidenceLevelFor(rounds),
            steals: rankRows.reduce((s, r) => s + r.steals, 0),
            worstDeals: rankRows.reduce((s, r) => s + r.worst_deals, 0),
            squanders: rankRows.reduce((s, r) => s + r.squanders, 0),
            bestDeals: rankRows.reduce((s, r) => s + r.best_deals, 0),
            tiers
        };
    }

    return { ...scopes, baselineVersion: DEAL_BASELINE_VERSION, minRoundsForEdge: MIN_ROUNDS_FOR_EDGE };
}

/**
 * How much weight the Edge number deserves. Thresholds come from the measured
 * residual SD: ~67 rounds for a +/-10pp interval, ~265 for +/-5pp.
 */
function confidenceLevelFor(rounds) {
    if (rounds < MIN_ROUNDS_FOR_EDGE) return 'insufficient';
    if (rounds < 250) return 'provisional';
    return 'established';
}

// Get joinable rooms (rooms in-progress with bots)
app.get('/api/rooms/joinable', (_req, res) => {
    try {
        const joinableRooms = roomManager.getJoinableRooms();
        res.json(joinableRooms);
    } catch (err) {
        console.error('Error fetching joinable rooms:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const {
            mode = 'standard',
            sortBy = 'rating',
            limit = 100,
            offset = 0,
            minGames = 0
        } = req.query;

        const leaderboardData = await require('./db').getLeaderboard({
            gameMode: mode,
            sortBy,
            limit: parseInt(limit),
            offset: parseInt(offset),
            minGames: parseInt(minGames)
        });

        res.json(leaderboardData);
    } catch (err) {
        console.error('Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get player's rank on leaderboard
app.get('/api/leaderboard/:username/rank', async (req, res) => {
    try {
        const { username } = req.params;
        const { mode = 'standard', sortBy = 'rating' } = req.query;

        const rank = await require('./db').getPlayerRank(username, mode, sortBy);

        if (rank === null) {
            return res.status(404).json({ error: 'Player not found' });
        }

        res.json({ username, rank, mode, sortBy });
    } catch (err) {
        console.error('Error fetching player rank:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    console.log('Serving static files from public directory');
    const publicDir = path.join(__dirname, 'public');

    // Vite emits content-hashed filenames under /assets, so those are safe to
    // cache indefinitely. Everything else (index.html, sw.js, manifest) must stay
    // revalidated or clients would pin to a stale build.
    app.use('/assets', express.static(path.join(publicDir, 'assets'), {
        maxAge: '1y',
        immutable: true
    }));
    app.use(express.static(publicDir, {
        setHeaders: (res, filePath) => {
            if (/(?:index\.html|sw\.js|manifest\.webmanifest)$/.test(filePath)) {
                res.setHeader('Cache-Control', 'no-cache');
            }
        }
    }));

    // Handle SPA routing - serve index.html for any unknown routes
    app.get(/(.*)/, (req, res) => {
        // Don't intercept API routes (though they should have matched above)
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'Endpoint not found' });
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(publicDir, 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker
server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});

// Close out games left open by a process death, before any new game can start.
//
// Rooms live in memory only, so a restart silently destroys every game in
// progress. Without this sweep those rows keep a NULL ended_at forever and are
// indistinguishable from live games -- the exact state game_history is in
// today, where nothing has ever written 'abandoned' and every abandoned game
// since launch still reads 'in_progress'.
//
// Safe at this moment specifically: no game in this database can legitimately
// be in progress when the process has only just started.
gamelog.sweepOrphans();

// Retention sweep for decision_tracking.
//
// Run at startup rather than only on a long timer: this server exits when idle
// (see the autostop check below) with min_machines_running = 0, so a daily
// interval would frequently never fire. Startup is the one moment guaranteed to
// happen. The delay keeps it off the critical path while the first players are
// connecting, and the interval covers machines that stay up for days.
const DECISION_PRUNE_INTERVAL = 24 * 60 * 60 * 1000;

const pruneDecisions = async () => {
    try {
        const removed = await pruneDecisionTracking();
        if (removed > 0) {
            console.log(
                `[Cleanup] Pruned ${removed} decision_tracking row(s) older than ` +
                `${DECISION_TRACKING_RETENTION_DAYS} days`
            );
        }
    } catch (err) {
        console.error('[Cleanup] Failed to prune decision_tracking:', err.message);
    }
};

setTimeout(pruneDecisions, 30 * 1000).unref();
setInterval(pruneDecisions, DECISION_PRUNE_INTERVAL).unref();

// Periodic cleanup of inactive rooms
// Runs every 5 minutes
// Periodic cleanup and autostop check
// Runs every 1 minute
const CHECK_INTERVAL = 60 * 1000;

// How long the server must stay *continuously* idle before it exits.
//
// Exiting on the first idle tick made scale-to-zero far too eager: a player
// who closed the tab for two minutes, or a lull between games, cost everyone a
// cold start on the next request. Fly restarts the machine on demand
// (auto_start_machines), so the only thing a longer window costs is machine
// time; the only thing a shorter one buys is a slightly smaller bill.
//
// Any connected socket or any live room resets the clock, so this is 6 hours
// of nobody touching the server at all -- not 6 hours since the last game.
const DEFAULT_IDLE_SHUTDOWN_MINUTES = 6 * 60;
const parsedIdleMinutes = Number(process.env.IDLE_SHUTDOWN_MINUTES);
const IDLE_SHUTDOWN_MINUTES = Number.isFinite(parsedIdleMinutes) && parsedIdleMinutes > 0
    ? parsedIdleMinutes
    : DEFAULT_IDLE_SHUTDOWN_MINUTES;
const IDLE_SHUTDOWN_MS = IDLE_SHUTDOWN_MINUTES * 60 * 1000;

// Start the clock at boot so a machine that nobody ever connects to still
// winds down instead of running forever.
let idleSince = Date.now();

setInterval(() => {
    const reaped = roomManager.cleanupInactiveRooms();
    if (reaped.length > 0) {
        console.log(`[Cleanup] Removed ${reaped.length} inactive room(s)`);
    }
    // Persist whatever those rooms had in flight before it is lost with them.
    // Without this, every abandoned game would be invisible to the corpus --
    // which is exactly the state game_history is in, where nothing has ever
    // written 'abandoned'.
    for (const { room, abandonReason } of reaped) {
        if (abandonReason) {
            gamelogRecorder.recordAbandon(room, abandonReason)
                .catch(e => console.error('[gamelog] abandon flush failed:', e.message));
        }
    }

    // Autostop check
    // Logic: if there have been no active rooms AND no connected clients for
    // IDLE_SHUTDOWN_MS, stop the server. This allows Fly.io to scale down to
    // zero when idle, without punishing short gaps between players.
    const activeRooms = roomManager.rooms.size;
    const connectedClients = io.engine.clientsCount;

    if (activeRooms > 0 || connectedClients > 0) {
        idleSince = null;
        return;
    }

    if (idleSince === null) {
        idleSince = Date.now();
    }

    const idleMs = Date.now() - idleSince;
    if (idleMs >= IDLE_SHUTDOWN_MS) {
        const idleMinutes = Math.round(idleMs / 60000);
        console.log(`[Autostop] Idle for ${idleMinutes} minute(s) (threshold ${IDLE_SHUTDOWN_MINUTES}). Shutting down server...`);
        process.exit(0);
    }
}, CHECK_INTERVAL);

console.log(
    `[Cleanup] Automatic room cleanup and autostop enabled ` +
    `(check every ${CHECK_INTERVAL / 60000} minute(s), shut down after ` +
    `${IDLE_SHUTDOWN_MINUTES} idle minute(s))`
);

// Error handlers to catch crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});
