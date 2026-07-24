# Chor Dai Dee (Big 2)

A feature-rich multiplayer Big 2 card game with comprehensive statistics tracking, advanced AI opponents, and accessibility options. Built with React frontend and Express/Socket.io backend.

## Features

### Core Gameplay
- **Multiplayer support**: Play with up to 4 players in real-time via Socket.io
- **Advanced bot players**: Intelligent AI opponents with heuristic-based decision-making
  - "Poker First" strategy to preserve strong 5-card hands
  - Card counting and strategic passing
  - Toggle between simple and advanced bot difficulty
- **Voice Chat**: Real-time voice communication with other players (toggleable)
- **Game modes**: Choose between Short Game (50 points, default) or Standard Game (100 points)
- **Reconnection support**: Seamlessly rejoin in-progress games if disconnected

### Statistics & Analytics
- **3-Tier statistics system**:
  - **Tier 1 (Basic)**: Games played, wins, losses, win rate, rating, placement distribution, play style metrics, combination usage, penalty severity
  - **Tier 2 (Strategic)**: Lead control percentage, head-to-head records against other players
  - **Tier 3 (Advanced Analytics)**: Decision efficiency, consistency analysis, behavioral profiling, player archetypes
- **Skill-based rating system**: OpenSkill-based ratings (similar to TrueSkill) that update based on game placement
- **Persistent accounts**: User registration and login with comprehensive stats tracking
- **Mode-specific stats**: Separate tracking for Short and Standard game modes

### UI/UX Features
- **Hand Helper**: Quick selection tool that finds all valid hands and highlights which ones beat the current pile
- **Drag & Drop**: Reorder your hand by dragging cards (touch and mouse support)
- **Four-Color Deck Mode**: Colorblind-friendly option (diamonds blue, clubs green)
- **Auto-Pass**: Automatically pass when no valid moves are available
- **Mobile optimized**: Responsive design with dynamic card spacing and swipe support
- **Smooth animations**: Card animations and transitions using Framer Motion
- **Settings panel**: In-game gear icon to adjust preferences (voice, deck colors, etc.)

### Developer Features
- **Bot Debug Panel**: Real-time analysis of bot decision-making
  - View reasoning, decision factors, and alternative moves considered
  - Situation analysis and decision history tracking
  - Toggle on/off in settings

## Quick Start

### Prerequisites
- Node.js (v16+)
- [mise](https://mise.jdx.dev/) (optional, for the single-command dev workflow)

### Running everything (recommended)
Install dependencies once, then start the server and client together:
```bash
# Install deps for both packages
npm --prefix server install
npm --prefix client install

# Start server (:3000) + client (:5173) in one command
mise run dev
```
The first time you run a mise task in this repo, run `mise trust` to allow the
config. Logs from both processes are interleaved and prefixed with `[dev:server]`
/ `[dev:client]`; press Ctrl+C to stop both.

### Running each part manually
If you'd rather not use mise, run the two processes in separate terminals:
```bash
# Terminal 1 — server (http://localhost:3000)
cd server/
npm install
node index.js

# Terminal 2 — client (http://localhost:5173)
cd client/
npm install
npm run dev
```

### Deployment (Fly.io)
The application is configured for deployment on Fly.io using Docker.

1. **Install flyctl**: [https://fly.io/docs/hands-on/install-flyctl/](https://fly.io/docs/hands-on/install-flyctl/)
2. **Deploy**:
   ```bash
   fly deploy
   ```
   This will build the Docker image and deploy it to your Fly.io app.
3. **Continuous Deployment**: A GitHub Action (`.github/workflows/fly-deploy.yml`) is set up to automatically deploy changes pushed to the `main` branch.


### Running Multiple Instances
The codebase supports running multiple development instances simultaneously (e.g., for testing multiplayer locally):

**Instance 1** (default ports):
```bash
# Server on port 3000
cd server/ && node index.js

# Client on port 5173
cd client/ && npm run dev
```

**Instance 2** (custom ports):
```bash
# Server on port 3001
cd server/ && PORT=3001 node index.js

# Client on port 5174, connecting to server on 3001
cd client/ && VITE_SERVER_URL=http://localhost:3001 npm run dev -- --port 5174
```

Each instance uses its own SQLite database (`server/database.sqlite`), providing complete isolation between instances.

## How to Play

1. **Register or login** with your username
2. **Select game mode** (Short: 50pts or Standard: 100pts)
3. **Create a new room** or join an existing one with a room code
4. **Click "Start Game"** when ready (bots fill empty spots automatically)
5. **Player with 3 of Diamonds plays first** (round 1 only; subsequent rounds start with previous winner)
6. **Play valid card combinations** to beat the table, or pass
7. **Use the Hand Helper** (lightbulb icon) to find valid hands quickly
8. **Drag cards** to reorder your hand as needed
9. **First player to empty their hand wins the round**
10. **Game continues** until someone reaches 50 or 100 points - lowest score wins!

## Valid Card Combinations

- **Single**: Any single card
- **Pair**: Two cards of the same rank
- **Triple**: Three cards of the same rank
- **Straight**: 5+ consecutive cards (3-4-5-6-7 up to 10-J-Q-K-A; 2 cannot be used in straights)
- **Flush**: 5 cards of the same suit
- **Full House**: Triple + Pair
- **Quads (Four of a Kind)**: Four cards of same rank + any card
- **Straight Flush**: 5 consecutive cards of the same suit

## Card Ranking

- **Ranks** (low to high): 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2
- **Suits** (low to high): Diamonds, Clubs, Hearts, Spades

## Scoring

### Per-Round Scoring
- **Round winner**: 0 points
- **Other players**: Points equal to cards remaining
- **Penalty multipliers**:
  - 1-9 cards remaining: 1x
  - 10-12 cards remaining: 2x
  - 13 cards remaining (no plays made): 3x

### Game Victory
- Game ends when any player reaches 50 points (Short) or 100 points (Standard)
- Player with **lowest total score** wins the game

### Rating System
- **OpenSkill-based** ratings update after each game
- Starting rating: approximately 1200
- Updates based on final placement (1st/2nd/3rd/4th)
- Only human players receive rating updates
- View your rating in the lobby and stats page

## Statistics Dashboard

Access comprehensive statistics from the lobby:

### Tier 1: Basic Stats
- Games played, wins, losses, win rate
- Current rating
- Placement distribution (1st/2nd/3rd/4th finishes)
- Play style metrics (aggressive, conservative, etc.)
- Combination usage breakdown
- Penalty severity analysis

### Tier 2: Strategic Stats
- Lead control percentage (how often you control the table)
- Head-to-head records against specific opponents

### Tier 3: Advanced Analytics
- Decision efficiency (optimal vs suboptimal plays)
- Consistency and variance analysis
- Behavioral profiling (Aggressive, Conservative, Balanced, Adaptive)
- Lucky vs skilled win distinction

Statistics are tracked separately for Short and Standard game modes.

## Game Settings

Access settings via the gear icon in-game:

- **Four-Color Deck**: Toggle colorblind-friendly deck colors
  - 2-color mode: Red (Hearts/Diamonds), Black (Spades/Clubs)
  - 4-color mode: Red (Hearts), Blue (Diamonds), Black (Spades), Green (Clubs)
- **Auto-Pass**: Automatically pass when you have no valid moves
- **Advanced Bots**: Toggle between simple and heuristic-based AI opponents
- **Bot Debug Panel**: View real-time bot decision analysis (for developers)

## Tech Stack

### Frontend
- **React 19.2** - UI framework
- **React Router 7.10** - Client-side routing
- **Vite 7.2** - Build tool and dev server
- **Tailwind CSS 4.1** - Utility-first styling
- **Framer Motion 12.23** - Animation library
- **@dnd-kit** - Drag and drop functionality
- **Socket.io Client** - Real-time communication
- **Simple Peer** - WebRTC implementation for Voice Chat

### Backend
- **Express 5.2** - Web server
- **Socket.io 4.8** - WebSocket server
- **SQLite3 5.1** - Database
- **bcrypt 6.0** - Password hashing
- **openskill** - Rating/ranking system

### Architecture
- Monorepo structure with separate `client/` and `server/` directories
- Client uses ES modules; server uses CommonJS
- Real-time bidirectional communication via Socket.io
- Persistent storage with SQLite database
- Context API for global state management (preferences, suit colors)

## Project Structure

```
chor-dai-dee/
├── client/
│   ├── src/
│   │   ├── components/        # React components
│   │   │   ├── Login.jsx
│   │   │   ├── Lobby.jsx
│   │   │   ├── GameRoom.jsx
│   │   │   ├── Stats.jsx
│   │   │   ├── HandHelper.jsx
│   │   │   ├── BotDebugPanel.jsx
│   │   │   └── Card.jsx
│   │   ├── contexts/          # React contexts
│   │   │   ├── SuitColorContext.jsx
│   │   │   └── UserPreferencesContext.jsx
│   │   ├── utils/             # Utility functions
│   │   ├── constants/         # Constants and config
│   │   ├── App.jsx            # Main app component
│   │   └── main.jsx           # Entry point
│   └── package.json
│
└── server/
    ├── game/                  # Game logic modules
    │   ├── RoomManager.js     # Room and player management
    │   ├── Big2Rules.js       # Hand validation
    │   ├── Deck.js            # Card deck
    │   ├── BotLogic.js        # AI decision-making
    │   ├── Scoring.js         # Score calculation
    │   ├── RatingSystem.js    # Skill rating
    │   ├── DecisionAnalyzer.js # Advanced analytics
    │   └── GameModes.js       # Game mode config
    ├── db.js                  # Database layer
    ├── index.js               # Server entry point
    └── package.json
```

## Development

### Linting
```bash
cd client/
npm run lint
```

### Production Build
```bash
cd client/
npm run build
npm run preview  # Preview production build
```

### Database
- Development: `./database.sqlite` in server directory
- Production: `/data/database.sqlite` (Docker volume mount)
- Schema includes: users, user_preferences, stats (overall/short/standard), round_stats, head_to_head_stats, decision_tracking, behavioral_stats, and more

## License

MIT
