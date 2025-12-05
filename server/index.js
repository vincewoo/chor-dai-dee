const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./game/RoomManager');
const { createUser, verifyUser, getUserStats, updateUserStats } = require('./db');
const { calculateScores } = require('./game/Scoring');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', ({ roomId, username }) => {
    // If roomId is 'create', create a new one
    let targetRoomId = roomId;
    if (roomId === 'create') {
        targetRoomId = roomManager.createRoom();
    }

    const player = { id: socket.id, name: username || `Player ${socket.id.substr(0,4)}`, socket };
    const result = roomManager.joinRoom(targetRoomId, player);

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

  const handleGameOver = (room, roomId, winner) => {
      const scores = calculateScores(winner, room.players);

      // Update DB for human players
      scores.forEach(s => {
          if (!s.isBot) {
               // We need the database user ID, but we only stored socket ID in room.
               // We need to fetch user ID from DB by username?
               // Or we can assume we only track stats for registered users.
               // Since we don't have user ID in room player object easily without querying.
               // Let's assume username is unique and query by username or store UserID in join.
               // I'll query by username for now as it's cleaner than refactoring join logic heavily.
               // Wait, I can just change join logic to include DB ID.

               // Quick fix: Do the lookup inside updateUserStats or pass username.
               // The DB function takes userId.
               // I will update db.js to allow updating by username or just fetch id here.
               // Actually, let's just lookup by username in db.js helper.
               // OR, assume room.players has dbId if I add it now.
               // Let's modify join_room to add dbId.
          }
      });

      // Since I can't easily change join_room logic in this patch without context,
      // I will implement a "bulk update by username" helper in db?
      // Or just loop.

      scores.forEach(async (s) => {
          if (!s.isBot) {
              try {
                  await updateUserStatsByName(s.name, s.isWin, s.points);
              } catch (e) {
                  console.error("Failed to update stats for", s.name, e);
              }
          }
      });

      io.to(roomId).emit('game_update', room.getGameState());
      io.to(roomId).emit('game_over', { winner, scores });
  };

  // Helper for recursive bot turns
  const processBotTurns = (room, roomId) => {
      room.checkBotTurn((result) => {
          if (result.type === 'gameOver') {
              handleGameOver(room, roomId, result.winner);
          } else {
              io.to(roomId).emit('game_update', room.getGameState());
              // Continue checking if next player is bot
              processBotTurns(room, roomId);
          }
      });
  };

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

              if (result.gameOver) {
                  handleGameOver(room, roomId, result.winner);
              } else {
                  // Check if next player is bot
                  processBotTurns(room, roomId);
              }
          }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
