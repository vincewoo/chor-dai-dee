const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./game/RoomManager');
const { createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName, getUserStatsByMode, updateUserStatsByMode, getUserByUsername, saveRoundStats, getRoundAggregates, getCombinationStats, getRecentRounds, updateAggregateStats, updateHeadToHeadStats, getHeadToHeadStats, updateCardAwarenessStats, updateVarianceStats, updateBehavioralStats, getTier3Stats, savePlacementHistory, getPlacementHistory, updateVarianceScores, trackDecision, getUserPreferences, updateUserPreferences } = require('./db');
const { calculateRoundScores, calculateDragonScores } = require('./game/Scoring');
const { calculateNewRatings, calculateDisplayRating } = require('./game/RatingSystem');
const { DecisionAnalyzer } = require('./game/DecisionAnalyzer');

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
      origin: function(origin, callback) {
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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} from ${socket.handshake.headers['user-agent']?.substring(0, 50)}`);

  // Handle explicit ping from client (for keep-alive)
  socket.on('ping', () => {
    // Socket.io handles this automatically, but we can log it for debugging
    // Respond with pong to keep connection alive
    socket.emit('pong');
  });

  socket.on('join_room', async ({ roomId, username }) => {
    console.log(`join_room event received: roomId=${roomId}, username=${username}`);

    // Fetch user stats to get rating
    // Use 'standard' mode as default when joining (mode can change later via set_game_mode)
    let ratingMu, ratingSigma, displayRating;
    if (username) {
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
        targetRoomId = roomManager.createRoom();
        console.log(`Created new room: ${targetRoomId}`);
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
                    roomManager.deleteRoom(existingRoomId);
                    console.log(`Room ${existingRoomId} deleted (empty after ${username} left)`);
                }
            } else {
                // Game in progress - replace with bot
                const replacement = existingRoom.replaceWithBot(existingPlayer.id);
                socket.leave(existingRoomId);

                if (replacement) {
                    console.log(`${username} left room ${existingRoomId} (game in progress) and was replaced by ${replacement.botPlayer.name}`);

                    // Check if room now has only bots
                    if (existingRoom.hasOnlyBots()) {
                        console.log(`Room ${existingRoomId} now has only bots, deleting room`);
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
    const targetRoom = roomManager.getRoom(roomId);
    if (targetRoom && targetRoom.playersByUsername && targetRoom.playersByUsername[username]) {
        const existingPlayer = targetRoom.playersByUsername[username];
        // Player is already in the room but socket ID changed (e.g., page refresh)
        console.log(`Player ${username} already in room ${roomId}, updating socket from ${existingPlayer.id} to ${socket.id}`);

        const player = targetRoom.reconnectPlayer(username, socket.id, socket);
        if (player) {
            player.rating = displayRating;
            socket.join(roomId);

            socket.emit('joined_room', { roomId, playerId: socket.id });
            io.to(roomId).emit('room_update', targetRoom.getGameState());

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
                processBotTurns(targetRoom, roomId);
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
        name: username || `Player ${socket.id.substring(0,4)}`,
        socket,
        rating: displayRating
    };

    // Check if room is in-progress and has bots to replace
    if (finalTargetRoom && (finalTargetRoom.gameState === 'playing' || finalTargetRoom.gameState === 'round_over') && finalTargetRoom.hasReplacableBots()) {
        console.log(`Room ${targetRoomId} is in-progress. Attempting to replace a bot with ${username}`);
        const replaceResult = finalTargetRoom.replaceBot(player);

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
    } else {
        socket.join(targetRoomId);
        const room = result.room;

        // Notify everyone in room
        io.to(targetRoomId).emit('room_update', room.getGameState());
        socket.emit('joined_room', { roomId: targetRoomId, playerId: socket.id });
    }
  });

  const handleDragonWin = async (room, roomId, dragonWinner) => {
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

      // Handle rating updates similar to game_over (fetch stats, calculate new ratings, update DB)
      // Exclude mid-game joiners from rating calculations (treat as bots)
      const playersWithStats = await Promise.all(room.players.map(async (p) => {
          if (p.isBot || p.joinedMidGame) return { ...p, isBot: true }; // Treat mid-game joiners as bots for rating calc
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

      // Calculate placements for rating purposes (winner is 1st, all others are tied for last)
      const placements = room.players.map(p => {
          if (p.id === dragonWinner.id) return 1;
          return 4; // All losers get worst placement
      });

      // Update ratings for all human players (excluding mid-game joiners)
      const newRatings = calculateNewRatings(playersWithStats, placements);

      for (let i = 0; i < room.players.length; i++) {
          const player = room.players[i];
          // Skip bots and mid-game joiners (no stats recorded for mid-game joiners)
          if (player.joinedMidGame) {
              console.log(`Dragon win: Skipping stats for ${player.name} (joined mid-game at round ${player.joinedAtRound})`);
          }
          if (!player.isBot && !player.joinedMidGame && newRatings[i]) {
              try {
                  const user = await getUserByUsername(player.name);
                  if (user) {
                      // Update mode-specific stats
                      await updateUserStatsByMode(user.id, room.gameMode, {
                          games: 1,
                          wins: player.id === dragonWinner.id ? 1 : 0,
                          rating_mu: newRatings[i].mu,
                          rating_sigma: newRatings[i].sigma
                      });

                      // Save placement history for variance tracking
                      await savePlacementHistory(user.id, room.gameMode, placements[i]);
                  }
              } catch (e) {
                  console.error("Failed to update stats for", player.name, e);
              }
          }
      }
  };

  const handleRoundOver = async (room, roomId, roundWinner) => {
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

      // Save round stats for each player (both human and bots)
      for (const scoreData of roundScoresWithPlacements) {
          if (!scoreData.isBot) {
              try {
                  const user = await getUserByUsername(scoreData.name);
                  if (user) {
                      const playStats = room.roundPlayStats[scoreData.id] || {
                          plays: 0,
                          passes: 0,
                          leadsWon: 0,
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
                          handTypes: playStats.handTypes
                      };

                      await saveRoundStats(room.gameId, user.id, room.gameMode, roundData);
                  }
              } catch (e) {
                  console.error("Failed to save round stats for", scoreData.name, e);
              }
          }
      }

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

          // 1. Fetch current ratings for all humans (mode-specific)
          // We need to fetch stats to get current mu/sigma
          // Exclude mid-game joiners from rating calculations (treat as bots)
          const playersWithStats = await Promise.all(room.players.map(async (p) => {
            if (p.isBot || p.joinedMidGame) return { ...p, isBot: true }; // Treat mid-game joiners as bots for rating calc
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

          // Calculate final game placements (1st = lowest score, 2nd/3rd/4th by score ascending)
          const finalPlacements = [...room.players].sort((a, b) => {
              const scoreA = room.cumulativeScores[a.id] || 0;
              const scoreB = room.cumulativeScores[b.id] || 0;
              return scoreA - scoreB; // Lower score = better placement
          }).map((p, index) => ({
              playerId: p.id,
              playerName: p.name,
              placement: index + 1
          }));

          // 3. Update DB for human players (final game results + ratings + aggregate stats, mode-specific)
          for (const p of room.players) {
              // Skip bots and mid-game joiners (no stats recorded for mid-game joiners)
              if (p.joinedMidGame) {
                  console.log(`Skipping stats for ${p.name} (joined mid-game at round ${p.joinedAtRound} with score ${p.joinedWithScore})`);
              }
              if (!p.isBot && !p.joinedMidGame) {
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
                              const user = await getUserByUsername(p.name);
                              if (user) {
                                  // Save all decisions to decision_tracking table
                                  for (const decision of tier3Data.decisions) {
                                      try {
                                          await trackDecision(
                                              room.gameId,
                                              user.id,
                                              room.roundNumber,
                                              decision.turn,
                                              decision.action,
                                              decision.handSize || 0,
                                              decision.cardsInDeck || 0,
                                              decision.pileStrength || 0,
                                              decision.handStrength || 0,
                                              decision.quality
                                          );
                                      } catch (err) {
                                          console.error("Failed to track decision:", err);
                                      }
                                  }

                                  // Get round aggregates for this player
                                  const roundAggregates = await getRoundAggregates(user.id, room.gameMode);

                                  // 1. Card Awareness Stats
                                  const totalDecisions = tier3Data.decisions.length;
                                  const optimalCount = tier3Data.optimalPlays || 0;
                                  const isOptimal = optimalCount > (totalDecisions / 2);
                                  const riskyCount = tier3Data.riskyPlays || 0;
                                  const isRisky = riskyCount > 0;

                                  // Determine risky play success (risky plays that led to good placement)
                                  const riskSucceeded = isRisky && playerPlacement.placement <= 2;

                                  // Calculate late game accuracy
                                  const lateGameAccuracy = DecisionAnalyzer.calculateLateGameAccuracy(
                                      room.cumulativeScores[p.id] || 0,
                                      52 // Full deck
                                  );

                                  await updateCardAwarenessStats(
                                      user.id,
                                      room.gameMode,
                                      isOptimal,
                                      isRisky,
                                      riskSucceeded,
                                      lateGameAccuracy
                                  );

                                  // 2. Variance Stats (Streaks and Lucky/Skilled wins)
                                  const isWinner = p.id === gameWinner.id;

                                  // Determine if win was lucky vs skilled
                                  let isLucky = false;
                                  if (isWinner) {
                                      // Calculate avg cards remaining for other players
                                      const otherPlayers = room.players.filter(pl => pl.id !== p.id);
                                      const avgCardsRemaining = otherPlayers.reduce((sum, pl) => {
                                          const playerScore = room.cumulativeScores[pl.id] || 0;
                                          return sum + playerScore;
                                      }, 0) / otherPlayers.length;

                                      const optimalRate = optimalCount / totalDecisions;
                                      isLucky = DecisionAnalyzer.isLuckyWin(avgCardsRemaining, optimalRate);
                                  }

                                  await updateVarianceStats(
                                      user.id,
                                      room.gameMode,
                                      isWinner,
                                      isLucky
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
                                  const totalPlays = roundAggregates?.total_plays || 0;
                                  const totalPasses = roundAggregates?.total_passes || 0;
                                  const leadsWon = roundAggregates?.leads_won || 0;

                                  const aggressionScore = DecisionAnalyzer.calculateAggressionScore(
                                      totalPlays,
                                      totalPasses,
                                      leadsWon
                                  );

                                  // Get existing card awareness stats for risk score calculation
                                  const existingAwareness = await require('./db').getCardAwarenessStats(user.id, room.gameMode);
                                  const riskySuccessful = existingAwareness?.risky_plays_successful || 0;
                                  const riskyFailed = existingAwareness?.risky_plays_failed || 0;

                                  const riskScore = DecisionAnalyzer.calculateRiskScore(
                                      riskySuccessful,
                                      riskyFailed,
                                      totalPlays
                                  );

                                  // Get placement history for adaptability calculation
                                  const placementHistory = await getPlacementHistory(user.id, room.gameMode, 20);
                                  const adaptabilityScore = DecisionAnalyzer.calculateAdaptabilityScore(placementHistory);

                                  // Calculate early/late game phase-specific behaviors
                                  // Early game = decisions in first 40% of turns
                                  // Late game = decisions in last 30% of turns
                                  const totalTurns = tier3Data.decisions.length;
                                  const earlyGameCutoff = Math.floor(totalTurns * 0.4);
                                  const lateGameStart = Math.floor(totalTurns * 0.7);

                                  const earlyDecisions = tier3Data.decisions.slice(0, earlyGameCutoff);
                                  const lateDecisions = tier3Data.decisions.slice(lateGameStart);

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

          // 4. Update head-to-head stats for all human player pairs
          const humanPlayers = room.players.filter(p => !p.isBot);
          for (let i = 0; i < humanPlayers.length; i++) {
              for (let j = i + 1; j < humanPlayers.length; j++) {
                  try {
                      const player1 = humanPlayers[i];
                      const player2 = humanPlayers[j];

                      const user1 = await getUserByUsername(player1.name);
                      const user2 = await getUserByUsername(player2.name);

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
                  setTimeout(() => {
                      room.clearRoundEndCards();
                      handleRoundOver(room, roomId, result.roundWinner);
                  }, 1500); // 1.5 second delay to see the winning card
              } else {
                  handleRoundOver(room, roomId, result.roundWinner);
              }
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              // Emit bot reasoning if debug mode is enabled
              if (room.debugMode && result.reasoning) {
                  io.to(roomId).emit('bot_reasoning', result.reasoning);
              }
              // If a trick was won, delay before clearing and continuing
              if (result.trickWinDelay) {
                  setTimeout(() => {
                      room.clearTrickState();
                      io.to(roomId).emit('game_update', room.getGameState());
                      // Continue checking if next player is bot
                      processBotTurns(room, roomId);
                  }, 1500); // 1.5 second delay to see the trick result
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

  socket.on('start_game', ({ roomId, useAdvancedBots }) => {
      const room = roomManager.getRoom(roomId);
      if (room) {
          // Verify that the requesting player is the host
          const player = room.players.find(p => p.id === socket.id);
          if (!player || player.name !== room.hostUsername) {
              socket.emit('error', 'Only the room host can start the game');
              return;
          }

          room.startGame(useAdvancedBots);

          // Check if dragon was dealt (Hong Kong variation)
          if (room.gameState === 'dragon_win' && room.dragonWinner) {
              // Send hands first so players can see the dragon
              room.players.forEach(p => {
                  if (!p.isBot) {
                      io.to(p.id).emit('hand_update', p.hand);
                  }
              });
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
          const result = room.playHand(socket.id, cards);
          if (result.error) {
              socket.emit('error', result.error);
              // Restore the player's hand on the client (undo optimistic update)
              socket.emit('hand_update', room.getPlayerHand(socket.id));
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              socket.emit('hand_update', room.getPlayerHand(socket.id));

              if (result.roundOver) {
                  // Add delay to show final winning card before round ends
                  if (result.roundWinDelay) {
                      setTimeout(() => {
                          room.clearRoundEndCards();
                          handleRoundOver(room, roomId, result.roundWinner);
                      }, 1500); // 1.5 second delay to see the winning card
                  } else {
                      handleRoundOver(room, roomId, result.roundWinner);
                  }
              } else if (result.trickWinDelay) {
                  // Big 2 was played or trick was won - delay before clearing state
                  // This gives players time to see the winning hand and passes
                  setTimeout(() => {
                      room.clearTrickState();
                      io.to(roomId).emit('game_update', room.getGameState());
                      // Check if next player is bot
                      processBotTurns(room, roomId);
                  }, 1500); // 1.5 second delay to see the trick result
              } else {
                  // Check if next player is bot
                  processBotTurns(room, roomId);
              }
          }
      }
  });

  socket.on('next_round', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (room && room.gameState === 'round_over') {
          handleNextRound(room, roomId);
      }
  });

  socket.on('pass_turn', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (room) {
          const result = room.passTurn(socket.id);
          if (result.error) {
              socket.emit('error', result.error);
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              if (result.trickWinDelay) {
                  // Trick was won by passing - delay before clearing state
                  // This gives players time to see all the passes before the trick clears
                  setTimeout(() => {
                      room.clearTrickState();
                      io.to(roomId).emit('game_update', room.getGameState());
                      // Check if next player is bot
                      processBotTurns(room, roomId);
                  }, 1500); // 1.5 second delay to see the trick result
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
        roomManager.deleteRoom(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      }
    } else {
      // During active game, replace the player with an Advanced Bot
      const replacement = room.replaceWithBot(socket.id);
      socket.leave(roomId);

      if (replacement) {
        console.log(`Player ${playerName} left and was replaced by ${replacement.botPlayer.name} in room ${roomId}`);

        // Check if the room now has only bots - if so, delete it
        if (room.hasOnlyBots()) {
          console.log(`Room ${roomId} now has only bots, deleting room`);
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

  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);

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

// User Preferences Routes
app.get('/api/preferences/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const preferences = await getUserPreferences(userId);
        res.json({
            fourColorMode: preferences.four_color_mode === 1,
            autoPass: preferences.auto_pass === 1
        });
    } catch (err) {
        console.error('Error fetching preferences:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/preferences/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { fourColorMode, autoPass } = req.body;
        await updateUserPreferences(userId, { fourColorMode, autoPass });
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating preferences:', err);
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

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker
server.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Periodic cleanup of inactive rooms
// Runs every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const deletedCount = roomManager.cleanupInactiveRooms();
  if (deletedCount > 0) {
    console.log(`[Cleanup] Removed ${deletedCount} inactive room(s)`);
  }
}, CLEANUP_INTERVAL);

console.log(`[Cleanup] Automatic room cleanup enabled (every ${CLEANUP_INTERVAL / 60000} minutes)`);

// Error handlers to catch crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});
