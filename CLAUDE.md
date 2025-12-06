# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chor Dai Dee is a multiplayer Big 2 card game with a React frontend and Express/Socket.io backend. The project is organized as a monorepo with separate `client/` and `server/` directories.

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
- `main.jsx` - Entry point
- `App.jsx` - Router with routes: `/` (Login), `/lobby`, `/game/:roomId`
- `components/` - Login, Lobby, GameRoom, Card components
- Socket.io connection initialized in App and passed as prop to children

### Backend Structure (`server/`)
- `index.js` - Express server with REST endpoints (`/api/register`, `/api/login`, `/api/stats/:username`) and Socket.io event handlers
- `db.js` - SQLite database layer (users, stats tables)
- `game/` - Game logic modules:
  - `RoomManager.js` - Room creation, player management, game state
  - `Big2Rules.js` - Hand validation and comparison logic
  - `Deck.js` - Card deck (ranks: 3→2, suits: Diamonds < Clubs < Hearts < Spades)
  - `BotLogic.js` - AI player moves
  - `Scoring.js` - Winner scoring calculation

### Key Socket.io Events
- `join_room` - Create/join a room
- `start_game` - Begin game (auto-fills bots if < 4 players)
- `play_card` - Submit a hand
- `pass_turn` - Pass current turn
- `next_round` - Start the next round after round ends
- `get_room_state` - Request current room state (for reconnection)
- Server emits: `room_update`, `game_started`, `hand_update`, `game_update`, `round_over`, `game_over`, `error`

## Game Rules (Big 2)
- Player with 3♦ plays first (round 1 only)
- Subsequent rounds: previous round winner starts
- Valid hands: single, pair, triple, straight, flush, full house, quads, straight flush
- Must beat the table or pass
- When all other players pass, the last player who played gets free control
- First to empty hand wins the round

## Scoring System
- Games consist of multiple rounds played until someone reaches 100 points
- Winner of each round gets 0 points; other players get points based on cards remaining
- Penalty multipliers:
  - 1-9 cards: 1x (points = cards remaining)
  - 10-12 cards: 2x multiplier
  - 13 cards (no plays): 3x multiplier
- Player with lowest cumulative score when someone hits 100 wins the game
- Player stats (wins, games, total score) are persisted to SQLite database

## Technical Notes
- Client uses ES modules; server uses CommonJS
- Rooms are stored in-memory (lost on server restart)
- Card value encoding: `rankIndex * 4 + suitIndex` for comparison
- Hardcoded URLs: client expects server at `localhost:3000`, server accepts `localhost:5173`
- Uses Framer Motion for card animations and UI transitions
- Responsive table layout with relative player positioning (current player always at bottom)
