# Chor Dai Dee (Big 2)

A multiplayer Big 2 card game with a React frontend and Express/Socket.io backend.

## Features

- **Multiplayer support**: Play with up to 4 players in real-time
- **Bot players**: Rooms auto-fill with AI bots if fewer than 4 players
- **Persistent accounts**: User registration and login with stats tracking
- **Multi-round scoring**: Play multiple rounds until someone reaches 100 points
- **Animated UI**: Smooth card animations and visual feedback using Framer Motion

## Quick Start

### Prerequisites
- Node.js (v16+)

### Running the Server
```bash
cd server/
npm install
node index.js
```
Server runs on http://localhost:3000

### Running the Client
```bash
cd client/
npm install
npm run dev
```
Client runs on http://localhost:5173

## How to Play

1. Register or login with your username
2. Create a new room or join an existing one with a room code
3. Click "Start Game" when ready (bots fill empty spots)
4. Player with 3 of Diamonds plays first (round 1 only)
5. Play valid card combinations to beat the table, or pass
6. First player to empty their hand wins the round
7. Game continues until someone reaches 100 points - lowest score wins!

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

- Round winner: 0 points
- Other players: Points equal to cards remaining
- Penalty multipliers:
  - 10-12 cards remaining: 2x
  - 13 cards remaining: 3x
- First to 100 points loses; lowest score wins

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, Framer Motion
- **Backend**: Express, Socket.io
- **Database**: SQLite3
