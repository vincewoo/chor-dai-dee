# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chor Dai Dee is a multiplayer Big 2 card game with a React frontend and Express/Socket.io backend. The project features comprehensive statistics tracking, advanced bot AI, a skill-based rating system, and extensive accessibility options. The project is organized as a monorepo with separate `client/` and `server/` directories.

## Development Commands

### Client (React + Vite)
```bash
cd client/
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run lint         # ESLint checks
npm run preview      # Preview production build
```

### Server (Express + Socket.io)
```bash
cd server/
node index.js        # Start server on port 3000
```

Note: No test framework is currently configured.

## Architecture

### Data Flow
```
Browser (React) ◄──REST API + Socket.io──► Express Server ◄──► SQLite3 DB
```

### Frontend Structure (`client/src/`)

#### Core App Files
- `main.jsx` - Entry point
- `App.jsx` - Router with routes: `/` (Login), `/lobby`, `/game/:roomId`, `/stats`
- Socket.io connection initialized in App and passed as prop to children

#### Components (`components/`)
- **Game Components:**
  - `Login.jsx` - User authentication
  - `Lobby.jsx` - Room creation/joining, game mode selection
  - `GameRoom.jsx` - Main game interface with settings panel
  - `Card.jsx` - Card rendering with 2-color and 4-color mode support
  - `CardCountIndicator.jsx` - Visual card back showing opponent card counts

- **UI Helper Components:**
  - `HandHelper.jsx` - Quick selection tool for finding valid hands
    - Auto-detects all playable combinations
    - Highlights hands that beat current pile
    - Cycling through multiple hands of same type
  - `BotDebugPanel.jsx` - Real-time bot decision analysis
    - Shows bot reasoning and decision factors
    - Displays situation analysis and alternative moves
    - History tracking of bot decisions
  - `Stats.jsx` - Comprehensive 3-tier statistics dashboard
    - Tier 1: Basic stats (games, wins, win rate, rating, placements, penalties)
    - Tier 2: Strategic stats (lead control, head-to-head records)
    - Tier 3: Advanced analytics (decision efficiency, consistency, behavioral profiling)
    - Mode switcher for Short vs Standard game stats

#### Contexts (`contexts/`)
- `SuitColorContext.jsx` - Manages 2-color vs 4-color deck modes
- `UserPreferencesContext.jsx` - User preferences with server sync
  - Four-color deck mode toggle
  - Auto-pass toggle
  - Syncs with server-side user_preferences table

#### Utils & Constants
- `handFinder.js` - Hand detection and validation logic for HandHelper
- `gameModes.js` - Game mode definitions (Short: 50pts, Standard: 100pts)

### Backend Structure (`server/`)

#### Core Server Files
- `index.js` - Express server with REST endpoints and Socket.io event handlers
- `db.js` - SQLite database layer with comprehensive schema

#### Game Logic Modules (`game/`)
- `RoomManager.js` - Room creation, player management, game state, reconnection handling
- `Big2Rules.js` - Hand validation and comparison logic
- `Deck.js` - Card deck (ranks: 3→2, suits: Diamonds < Clubs < Hearts < Spades)
- `BotLogic.js` - Advanced heuristic-based AI with decision reasoning
  - "Poker First" strategy - preserves strong 5-card hands
  - Combo-breaking heuristics
  - Card counting and strategic passing
  - Configurable difficulty (simple vs advanced)
- `Scoring.js` - Winner scoring calculation with penalty multipliers
- `RatingSystem.js` - OpenSkill-based rating system
  - Formula: Display Rating = 1200 + (mu - 3*sigma) * 40
  - Updates based on game placement (not just win/loss)
  - Only updates ratings for human players
- `DecisionAnalyzer.js` - Advanced analytics engine for Tier 3 stats
  - Hand strength calculation
  - Decision quality evaluation (optimal/suboptimal/risky)
  - Player archetype detection (Aggressive, Conservative, Balanced, Adaptive)
  - Lucky vs skilled win distinction
- `GameModes.js` - Game mode configuration (SHORT: 50pts, STANDARD: 100pts)

### REST API Endpoints

#### Authentication & User
- `POST /api/register` - User registration
- `POST /api/login` - User login

#### Statistics
- `GET /api/stats/:username` - Basic user stats
- `GET /api/stats/:username/detailed` - Detailed stats with mode filter (short/standard)
- `GET /api/stats/:username/rounds` - Recent round history
- `GET /api/stats/:username/head-to-head` - Head-to-head records vs other players
- `GET /api/stats/:username/tier3` - Advanced analytics (Tier 3)

#### Preferences
- `GET /api/preferences/:userId` - Get user preferences
- `POST /api/preferences/:userId` - Save user preferences

### Socket.io Events

#### Client → Server
- `join_room` - Create/join a room
- `set_game_mode` - Set game mode (short/standard) before starting
- `start_game` - Begin game (auto-fills bots if < 4 players)
- `play_card` - Submit a hand
- `pass_turn` - Pass current turn
- `next_round` - Start the next round after round ends
- `get_room_state` - Request current room state (for reconnection)
- `toggle_debug` - Enable/disable bot debug panel

#### Server → Client
- `room_update` - Room state changes (players joining/leaving)
- `game_started` - Game has begun
- `hand_update` - Player's hand cards
- `game_update` - Game state changes (plays, turns, etc.)
- `round_over` - Round has ended with scores
- `game_over` - Game has ended with final results
- `bot_reasoning` - Bot decision analysis (for debug panel)
- `reconnected` - Client successfully reconnected
- `error` - Error messages

### Database Schema

#### Core Tables
- `users` - User accounts (id, username, password_hash)
- `user_preferences` - Settings (four_color_mode, auto_pass)
- `stats` - Overall player statistics
- `stats_short` - Short game mode statistics
- `stats_standard` - Standard game mode statistics

#### Analytics Tables
- `round_stats` - Per-round granular stats (plays, passes, leads_won, combinations)
- `head_to_head_stats` - Win/loss records against specific opponents
- `decision_tracking` - Decision quality tracking for Tier 3 analytics
- `card_awareness_stats` - Optimal/suboptimal decision counts
- `variance_stats` - Win streaks, lucky vs skilled wins
- `behavioral_stats` - Aggression, risk, adaptability scores and archetypes
- `placement_history` - Historical placement data for variance analysis

## Game Rules (Big 2)

### Basic Gameplay
- Player with 3♦ plays first (round 1 only)
- Subsequent rounds: previous round winner starts
- Valid hands: single, pair, triple, straight, flush, full house, quads, straight flush
- Must beat the table or pass
- When all other players pass, the last player who played gets free control
- First to empty hand wins the round

### Game Modes
- **Short Game:** First to 50 points ends the game (~30 minutes)
- **Standard Game:** First to 100 points ends the game (~60 minutes)
- Players select mode before starting the game

### Scoring System
- Games consist of multiple rounds played until someone reaches the point threshold
- Winner of each round gets 0 points; other players get points based on cards remaining
- Penalty multipliers:
  - 1-9 cards: 1x (points = cards remaining)
  - 10-12 cards: 2x multiplier
  - 13 cards (no plays): 3x multiplier
- Player with lowest cumulative score when someone hits threshold wins the game
- Player stats, ratings, and analytics are persisted to SQLite database

### Rating System
- OpenSkill-based ratings (similar to TrueSkill)
- Starting rating: ~1200
- Updates based on final placement (1st/2nd/3rd/4th)
- Only human players receive rating updates
- Displayed in lobby and stats dashboard

## UI/UX Features

### Accessibility & Preferences
- **Four-Color Deck Mode:** Optional colorblind-friendly deck
  - 2-color mode: Red (Hearts/Diamonds), Black (Spades/Clubs)
  - 4-color mode: Red (Hearts), Blue (Diamonds), Black (Spades), Green (Clubs)
- **Auto-Pass:** Automatically pass when no valid moves available
- **Settings Panel:** In-game gear icon for preferences
  - Toggle four-color deck
  - Toggle auto-pass
  - Toggle advanced bots

### Gameplay Helpers
- **Hand Helper/Quick Select:**
  - Shows all valid hands in current hand
  - Highlights hands that beat the pile (green)
  - Click to select cards, cycle through alternatives
  - Shows counts and percentages for each hand type
- **Drag & Drop Card Reordering:**
  - Reorder hand cards by dragging
  - Uses @dnd-kit library
  - Touch and mouse support

### Mobile Optimization
- Dynamic card spacing based on screen size and card count
- Swipe selection support
- Improved touch targets
- Responsive card layout prevents overlap
- Full-width card container on mobile
- Card count indicators for opponents

### Visual Features
- Custom logo and favicon
- Smooth card animations with Framer Motion
- Responsive table layout with relative player positioning (current player always at bottom)
- Card count indicators on opponent hands
- Auto-reconnection with status indicators

### Developer Features
- **Bot Debug Panel:** Real-time AI decision analysis
  - Toggle with settings panel
  - Shows reasoning, factors, alternatives
  - History tracking of decisions
  - Situation analysis (hand size, 2s count, free play)

## Technical Notes

### Technology Stack
- **Frontend:** React 19.2, React Router 7.10, Vite 7.2, Tailwind CSS 4.1, Framer Motion 12.23
- **Backend:** Express 5.2, Socket.io 4.8, SQLite3 5.1
- **Libraries:** @dnd-kit (drag & drop), openskill (ratings), bcrypt 6.0 (auth)
- Client uses ES modules; server uses CommonJS

### Deployment & Environment
- Environment-based CORS configuration
- Dynamic API URL detection (production vs development)
- Database path: `/data/database.sqlite` in production (Docker volume), `./database.sqlite` in dev
- Hardcoded dev URLs: client expects server at `localhost:3000`, server accepts `localhost:5173`

### Game Implementation Details
- Rooms are stored in-memory (lost on server restart)
- Card value encoding: `rankIndex * 4 + suitIndex` for comparison
- Reconnection handling: players can rejoin in-progress games
- Bot decisions captured with reasoning for debug panel
- Advanced bot AI uses heuristics and card counting
- Stats calculated at round-end and persisted to multiple tables

### Key Design Patterns
- Context API for global state (preferences, suit colors)
- Socket.io for real-time bidirectional communication
- React Router for SPA navigation
- Component composition with prop drilling for socket connection
- Server-side game state management with client updates via socket events
