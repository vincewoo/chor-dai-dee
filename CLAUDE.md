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
- Server emits: `room_update`, `game_started`, `hand_update`, `game_update`, `game_over`, `error`

## Game Rules (Big 2)
- Player with 3♦ plays first
- Valid hands: single, pair, triple, straight, flush, full house, quads, straight flush
- Must beat the table or pass
- Three consecutive passes reset the table
- First to empty hand wins

## Technical Notes
- Client uses ES modules; server uses CommonJS
- Rooms are stored in-memory (lost on server restart)
- Card value encoding: `rankIndex * 4 + suitIndex` for comparison
- Hardcoded URLs: client expects server at `localhost:3000`, server accepts `localhost:5173`
