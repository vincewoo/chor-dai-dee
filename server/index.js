const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./game/RoomManager');
const { createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName } = require('./db');
const { calculateRoundScores } = require('./game/Scoring');

const app = express();

// Determine allowed origins based on environment
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = isProduction
  ? [process.env.APP_URL || 'https://chor-dai-dee.fly.dev']
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST']
}));
app.use(express.json());

// Serve static files in production
if (isProduction) {
  app.use(express.static(path.join(__dirname, 'public')));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', ({ roomId, username }) => {
    console.log(`join_room event received: roomId=${roomId}, username=${username}`);
    // If roomId is 'create', create a new one
    let targetRoomId = roomId;
    if (roomId === 'create') {
        targetRoomId = roomManager.createRoom();
        console.log(`Created new room: ${targetRoomId}`);
    }

    const player = { id: socket.id, name: username || `Player ${socket.id.substr(0,4)}`, socket };
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

  const handleRoundOver = (room, roomId, roundWinner) => {
      const roundScores = calculateRoundScores(roundWinner, room.players);
      const isGameOver = room.updateScores(roundScores);

      // Add cumulative scores to the round scores for display
      const scoresWithCumulative = roundScores.map(s => ({
          ...s,
          cumulativeScore: room.cumulativeScores[s.id] || 0
      }));

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

          // Update DB for human players (final game results)
          room.players.forEach(async (p) => {
              if (!p.isBot) {
                  try {
                      const isWinner = p.id === gameWinner.id;
                      const totalScore = room.cumulativeScores[p.id] || 0;
                      await updateUserStatsByName(p.name, isWinner, totalScore);
                  } catch (e) {
                      console.error("Failed to update stats for", p.name, e);
                  }
              }
          });

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

      // Broadcast updated state
      io.to(roomId).emit('game_started', room.getGameState());

      // Send individual hands
      room.players.forEach(p => {
          if (!p.isBot) {
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
              socket.emit('hand_update', room.getPlayerHand(socket.id));
          }
      }
  });

  socket.on('start_game', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (room) {
          room.startGame();
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

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Handle removal... needs lookup of which room they were in.
    // For now, minimal handling.
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

app.get('/api/stats/:username', async (req, res) => {
    try {
        const stats = await getUserStats(req.params.username);
        if (stats) res.json(stats);
        else res.status(404).json({ error: 'User not found' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// SPA catch-all route - must be after all API routes
// Express 5 requires named parameter for wildcards
if (isProduction) {
    app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker/Fly.io
server.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
