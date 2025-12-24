const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./game/RoomManager');
const { createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName, getUserStatsByMode, updateUserStatsByMode, getUserByUsername, saveRoundStats, getRoundAggregates, getCombinationStats, getRecentRounds, updateAggregateStats, updateHeadToHeadStats, getHeadToHeadStats, updateCardAwarenessStats, updateVarianceStats, updateBehavioralStats, getTier3Stats, savePlacementHistory, getPlacementHistory, updateVarianceScores, trackDecision, getUserPreferences, updateUserPreferences } = require('./db');
const { calculateRoundScores } = require('./game/Scoring');
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
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
      methods: ['GET', 'POST']
    };

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions
});

const roomManager = new RoomManager();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', async ({ roomId, username }) => {
    console.log(`join_room event received: roomId=${roomId}, username=${username}`);

    // Fetch user stats to get rating
    let ratingMu, ratingSigma, displayRating;
    if (username) {
        try {
            const stats = await getUserStats(username);
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

            // Check if current player is a bot and trigger bot turn processing
            if (targetRoom.gameState === 'playing') {
                processBotTurns(targetRoom, roomId);
            }

            return;
        }
    }

    // Normal join flow
    let targetRoomId = roomId;
    if (roomId === 'create') {
        targetRoomId = roomManager.createRoom();
        console.log(`Created new room: ${targetRoomId}`);
    }

    const player = {
        id: socket.id,
        name: username || `Player ${socket.id.substring(0,4)}`,
        socket,
        rating: displayRating
    };

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

          // 1. Fetch current ratings for all humans (mode-specific)
          // We need to fetch stats to get current mu/sigma
          const playersWithStats = await Promise.all(room.players.map(async (p) => {
            if (p.isBot) return { ...p };
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

          // 2. Calculate new ratings
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
              if (!p.isBot) {
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

          const sanitizedGameWinner = {
              id: gameWinner.id,
              name: gameWinner.name,
              isBot: gameWinner.isBot
          };

          io.to(roomId).emit('game_over', {
              winner: sanitizedGameWinner,
              scores: scoresWithCumulative,
              finalScores: room.cumulativeScores,
              roundNumber: room.roundNumber
          });
      } else {
          // Round is over, but game continues
          io.to(roomId).emit('round_over', {
              roundWinner: sanitizedRoundWinner,
              scores: scoresWithCumulative,
              roundNumber: room.roundNumber
          });
      }
  };

  const handleNextRound = (room, roomId) => {
      room.roundNumber++;
      room.startRound();

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
              handleRoundOver(room, roomId, result.roundWinner);
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              // Emit bot reasoning if debug mode is enabled
              if (room.debugMode && result.reasoning) {
                  io.to(roomId).emit('bot_reasoning', result.reasoning);
              }
              // Continue checking if next player is bot
              processBotTurns(room, roomId);
          }
      });
  };

  socket.on('get_room_state', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (room) {
          socket.emit('room_update', room.getGameState());
          // Also send hand if game is in progress
          if (room.gameState === 'playing') {
              const hand = room.getPlayerHand(socket.id);
              console.log(`get_room_state: Sending hand to ${socket.id}: ${hand ? hand.length : 0} cards`);
              socket.emit('hand_update', hand);
              // Check if current player is a bot and trigger bot turn processing
              processBotTurns(room, roomId);
          }
      }
  });

  socket.on('set_game_mode', ({ gameMode }) => {
      const result = roomManager.findRoomBySocketId(socket.id);
      if (!result) {
          return socket.emit('error', 'Not in a room');
      }

      const { room, roomId } = result;

      // Only allow changing mode in waiting state
      const setResult = room.setGameMode(gameMode);
      if (setResult.error) {
          return socket.emit('error', setResult.error);
      }

      // Broadcast updated state to all players in room
      io.to(roomId).emit('room_update', room.getGameState());
  });

  socket.on('start_game', ({ roomId, useAdvancedBots }) => {
      const room = roomManager.getRoom(roomId);
      if (room) {
          room.startGame(useAdvancedBots);
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
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              socket.emit('hand_update', room.getPlayerHand(socket.id));

              if (result.roundOver) {
                  handleRoundOver(room, roomId, result.roundWinner);
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
              // Check if next player is bot
              processBotTurns(room, roomId);
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
      // During active game, mark as disconnected instead
      const disconnectedPlayer = room.markDisconnected(socket.id);
      socket.leave(roomId);

      if (disconnectedPlayer) {
        console.log(`Player ${playerName} left during game, marked as disconnected in room ${roomId}`);
        io.to(roomId).emit('room_update', room.getGameState());
        io.to(roomId).emit('player_disconnected', { playerName: disconnectedPlayer.name });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);

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

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker/Fly.io
server.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
