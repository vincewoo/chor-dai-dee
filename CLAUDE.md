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

Tests (server, uses Node's built-in runner):
```bash
cd server/
npm test             # regression tests (bot logic, game log, replay, export)
npm run bench        # bot self-play benchmark + behavioural metrics
```

Game log tooling (all off unless `GAMELOG_ENABLED=1`):
```bash
npm run gamelog:verify                              # replay every logged round
npm run gamelog:export -- --out data/ --humans-only # JSONL training shards
npm run gamelog:archive -- --out archive/ --dry-run # archival + retention
```

Note: bot logic and the game-history store are covered by tests; the socket
layer and REST endpoints are not.

### Deployment (Fly.io)
```bash
fly deploy           # Deploy to Fly.io (requires flyctl)
fly open             # Open the deployed app
fly logs             # View production logs
```
CI/CD is configured via GitHub Actions (`.github/workflows/fly-deploy.yml`) to auto-deploy on push to `main`.

## Running Multiple Instances

The codebase supports running multiple development instances simultaneously (e.g., for testing multiplayer locally or running different versions side-by-side).

### Environment Variable Support
- **Server port**: Use `PORT` environment variable (default: 3000)
- **Client API URL**: Use `VITE_SERVER_URL` environment variable (default: http://localhost:3000)
- **Client dev port**: Use `--port` flag with npm run dev (default: 5173)

### Example: Running Two Instances

#### Instance 1 (default ports)
```bash
# Terminal 1 - Server
cd server/
node index.js                    # Runs on port 3000

# Terminal 2 - Client
cd client/
npm run dev                      # Runs on port 5173, connects to localhost:3000
```

#### Instance 2 (custom ports)
```bash
# Terminal 3 - Server
cd server/
PORT=3001 node index.js          # Runs on port 3001

# Terminal 4 - Client
cd client/
VITE_SERVER_URL=http://localhost:3001 npm run dev -- --port 5174
                                 # Runs on port 5174, connects to localhost:3001
```

### Using .env Files

**Client only.** Vite loads `.env` natively, so this works:

`client/.env`:
```
VITE_SERVER_URL=http://localhost:3001
```

**The server does not read `.env` files.** `dotenv` is not a dependency and
nothing loads one, so a `server/.env` is silently ignored — `PORT=3001` in it
will leave the server on 3000. Pass server variables inline or export them:

```bash
cd server/
PORT=3001 node index.js
# or
export PORT=3001
```

In production these come from `fly.toml`'s `[env]` block (non-secret) or
`fly secrets set` (secret), not from a file.

### Database Isolation
Each instance uses its own SQLite database:
- Development: `server/database.sqlite` (relative to each clone)
- Production: `/data/database.sqlite` (Docker volume)

This means each instance has:
- Separate user accounts and authentication
- Independent game statistics
- Isolated user preferences
- No data conflicts between instances

### CORS Configuration
The server's CORS is configured to accept connections from any localhost port in development, so no additional configuration is needed for multiple instances.

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
  - `GameRoom.jsx` - Owns all in-game state, socket wiring and player actions,
    then hands one prop bundle to a v2 table orchestrator. It renders no table
    chrome of its own.
  - `VoiceChat.jsx` - Owns the room's WebRTC lifecycle (uses simple-peer) and
    publishes voice state upward. Renders nothing; the v2 tables draw the
    controls (`VoiceControlBubble` in the HUD, `VoiceIndicator` per seat).

- **UI Helper Components:**
  - `BotDebugPanel.jsx` - Real-time bot decision analysis
    - Shows bot reasoning and decision factors
    - Displays situation analysis and alternative moves
    - History tracking of bot decisions
  - `Stats.jsx` - Comprehensive 3-tier statistics dashboard
    - Tier 1: Basic stats (games, wins, win rate, rating, placements, penalties)
    - Tier 2: Strategic stats (lead control, head-to-head records)
    - Tier 3: Advanced analytics (decision efficiency, consistency, behavioral profiling)
    - Mode switcher for Short vs Standard game stats

#### The v2 UI (`components/tableV2/`)

The whole client renders in one design system, defined by `theme/tableTheme.js`
(accent palettes, felt/ink surfaces, `useTableTheme`) and the `cdd*` keyframes in
`index.css`. There is no second, older UI: the legacy green/white Tailwind
screens were removed when desktop moved to v2.

The split is by **composition, not design**. `hooks/useMediaQuery.js` is the one
place breakpoints are defined — `useIsDesktop()` (768px) picks the composition,
`useIsWide()` (1024px) decides whether the desktop table's rails fit.

- `GameTableMobile.jsx` / `GameTableDesktop.jsx` - the two in-game orchestrators.
  They take an **identical prop bundle** (built once in `GameRoom.jsx`) and share
  every leaf component; only the arrangement differs. Mobile is a full-bleed
  stack; desktop is a three-column grid whose rails hold `ScorePanel` and
  `RoundLogPanel` permanently. Below `useIsWide()` those rails are dropped and
  the desktop table falls back to the mobile affordances for the same
  information — the HUD's Info toggle (`ScoreStrip`) and `RoundLogSheet`.
- `layout.js` - `MOBILE_LAYOUT` / `DESKTOP_LAYOUT`: seat placements, pile frame
  and scale, banner placement, hand geometry caps. The v2 table was built with
  these offsets inline for a ~390x844 phone; they live here now so a second
  composition does not mean a second set of components. **Every leaf still
  defaults to the mobile values**, so a component rendered without a placement
  prop looks exactly as it did before desktop existed.
- `RoundLogRows.jsx` - the log rows, shared by the mobile sheet and the desktop
  rail so the two can't drift.
- `useHandGeometry.js` (in `hooks/`) - card size and overlap for the hand fan.
  Type scales only *above* the 75px mobile card (`typeScale`), so no mobile
  width can be altered by a desktop change.

#### Contexts (`contexts/`)
- `SuitColorContext.jsx` - Manages 2-color vs 4-color deck modes
- `VoiceChatContext.jsx` - Manages WebRTC connections and voice state
- `UserPreferencesContext.jsx` - User preferences with server sync
  - Four-color deck mode toggle
  - Auto-pass toggle
  - Syncs with server-side user_preferences table

#### Utils & Constants
- `handFinder.js` - Hand detection and validation, backing the quick-select
  chips in `tableV2/ControlsRow.jsx`
- `gameModes.js` - Game mode definitions (Short: 50pts, Standard: 100pts)

### Backend Structure (`server/`)

#### Core Server Files
- `index.js` - Express server with REST endpoints and Socket.io event handlers
- `db.js` - SQLite database layer with comprehensive schema
- `gamelog.js` - Append-only game-history store for offline ML, in its own
  `gamelog.sqlite`. Every write is guarded so a store failure can never surface
  to a player or abort a round.
- `gamelogRecorder.js` - Glue between gameplay and the store; resolves seated
  players to account ids for attribution

#### Game Logic Modules (`game/`)
- `RoomManager.js` - Room creation, player management, game state, reconnection handling
- `Big2Rules.js` - Hand validation and comparison logic
- `Deck.js` - Card deck (ranks: 3→2, suits: Diamonds < Clubs < Hearts < Spades)
- `BotLogic.js` - Heuristic AI with decision reasoning. See
  `docs/BOT-HEURISTICS-REVIEW.md` for the design rationale.
  - **Retention-cost scoring** - every heuristic is denominated in one currency:
    a convex per-card cost (`RANK_RETENTION_COST`) for giving up a card,
    discounted by game phase and by combination size. Adding a new rule means
    pricing it against that scale, not inventing a fresh bonus magnitude.
  - **Separate lead and response scoring** (`scoreLeadMove` / `scoreResponseMove`).
    Most historic bot bugs were lead heuristics leaking into responses.
  - **Price of the trick** - a card is spent only when the lead it buys is worth
    more than the card (`evaluateTrickValue`, `shouldStrategicPass`)
  - "Poker First" hand organisation - preserves strong 5-card hands, with the
    break penalty scaled by what is actually lost (`comboBreakPenalty`)
  - **2s are never "locked" in a combination** - `standaloneControlSurcharge`
    charges back the `COST_WEIGHT_BY_SIZE` discount for 2s, which can always be
    pulled out and played as an unbeatable single. Without it the bot dumped 2s
    inside full houses and quads (23.5% of all 2s played, now 12%). Lifts once
    `roundLostness` fires. See `docs/BOT-HEURISTICS-REVIEW.md` § 14.
  - **Phase is deliberately own-hand-only** - `getGamePhase` ignores opponents
    on purpose; it prices *our* control to *us*. Making it track the leader was
    measured and cost 3pp of win rate (§ 13). Round-ending risk is a separate
    question, answered by `dangerLevel` and `roundLostness`.
  - **Penalty-tier awareness** - `roundLostness` reads opponents' card counts to
    detect a round that cannot be won; once it fires, `penaltyTierValue` prices
    ducking under the 10-card (2x) and 13-card (3x) scoring tiers. Round points
    count *cards, not ranks*, so in a lost round retention cost is pricing an
    asset that no longer exists. Worth -0.069 round points per round (3.2 sigma).
  - **Opponent modelling** - `buildOpponentModels` replays the round's
    `trickHistory` (maintained by RoomManager, survives trick boundaries) to
    infer what each opponent cannot beat, and stops trusting that read once an
    opponent shows they pass strategically
  - **Per-bot personality** - `getBotProfile` derives stable variability,
    patience and aggression from the bot's name; `pickScoredMove` samples near
    the top move rather than always taking the argmax, so bots at one table do
    not play identically. Bots with no profile are fully deterministic.
  - Configurable difficulty (heuristic vs advanced PPO bot)
- `BotContext.js` - Builds the observation a bot reasons over. Shared by live
  play, the self-play benchmark, and the game-log replayer so all three see
  identical features. Takes plain seat-indexed state, never a Room.
- `TapeCodec.js` - Game-log encodings: 52-byte deal blob, 52-bit card masks
  (built with BigInt - JS bitwise operators truncate to 32 bits), action/source
  /flag codes, `think_ms` clamping
- `GameTape.js` - In-memory per-round tape buffer held by each Room
- `Replayer.js` - Reconstructs full game state from a logged tape using the same
  Big2Rules the server plays with, so training features cannot drift from the
  live rules
- `Scoring.js` - Winner scoring calculation with penalty multipliers
- `RatingSystem.js` - OpenSkill-based rating system
  - Formula: Display Rating = 1200 + (mu - 3*sigma) * 40
  - Updates based on game placement (not just win/loss)
  - Only updates ratings for human players
- `DealStrength.js` - Scores a 13-card deal before play, so stats can separate
  card luck from skill. Control (2s/aces/kings) against the plays needed to shed,
  mapped to five tiers with a measured win-rate baseline. See
  `docs/HAND-STRENGTH-STATS.md`; regenerate the constants with
  `node test/dealStrength.bench.js`.
  - Deliberately separate from `DecisionAnalyzer.calculateHandStrength`, which
    scores *partial* hands mid-round and is entangled with hand size by design.
  - `rank` is derived from all four hands and must never reach a client
    mid-round - it leaks opponents' holdings.
  - Bots do **not** use it: feeding own-hand strength into bot scoring was
    measured and made play worse. A *relative* signal (`BotLogic.roundLostness`)
    did work and shipped instead. See `docs/BOT-HEURISTICS-REVIEW.md` §§ 11-12.
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
- `GET /api/stats/:username/hand-strength` - Deal strength vs. outcome. Returns
  three scopes (`all`, `vsBots`, `vsHumans`) so beating bots and beating humans
  stay distinguishable, each with a per-tier win rate against the baseline,
  "Edge" (results minus what the deals were worth) and its confidence interval.

#### Preferences
- `GET /api/preferences/:userId` - Get user preferences (includes the chosen avatar)
- `POST /api/preferences/:userId` - Save user preferences

#### Avatars
- `POST /api/avatar/:userId` - Save the avatar picked in the Avatar Picker.
  Kept separate from the preferences POST so the periodic preference sync can
  never overwrite an avatar with a stale value. The emoji is validated against
  `server/avatars.js`.
- `GET /api/avatars?usernames=a,b,c` - Batch lookup keyed on **username**, since
  a username is the only identifier a client has for the other players at its
  table. Names with no chosen avatar are omitted from the response and the
  client falls back to a deterministic name-derived avatar (bots, guests, and
  anyone who never opened the picker).

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
- `dragon_win` - Dragon detected, instant game win (Hong Kong variation)
- `bot_reasoning` - Bot decision analysis (for debug panel)
- `reconnected` - Client successfully reconnected
- `error` - Error messages

### Game History Store (ML)

Separate from `database.sqlite`. Records the deal, the seating, and the ordered
actions; every intermediate state is re-derived by replay rather than stored.
Keyed on **seat index, not socket id** - socket ids change mid-game on
reconnect and on bot/human swaps. See `docs/GAME-STATE-HISTORY-STORE.md`.

Tables: `mlog_game`, `mlog_seat` (occupancy segments), `mlog_round` (deal +
outcome labels), `mlog_action` (the tape).

Recording requires `GAMELOG_ENABLED=1` (there is no per-player opt-out).
Unsetting it is the kill switch.

### Database Schema

#### Core Tables
- `users` - User accounts (id, username, password_hash)
- `user_preferences` - Settings (four_color_mode, auto_pass, table theme, sound, avatar_animal/avatar_tile)
- `stats` - Overall player statistics
- `stats_short` - Short game mode statistics
- `stats_standard` - Standard game mode statistics

#### Analytics Tables
- `round_stats` - Per-round granular stats (plays, passes, leads_won, combinations,
  plus deal strength: `deal_strength_raw`, `deal_tier`, `deal_rank`,
  `deal_baseline_version`, `human_opponents`). The deal columns are NULL on rows
  written before the feature - an unknown deal is not an average one, so every
  deal-strength query filters `IS NOT NULL` rather than treating them as zero.
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
- **Hong Kong Dragon Rule:** If a player is dealt all 13 different ranks (3-4-5-6-7-8-9-10-J-Q-K-A-2), they instantly win the entire game. All other players receive 39 penalty points.

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
- **Avatars:** Emoji animal on a coloured tile, picked in the v2 Avatar Picker.
  Stored on the account so every player at the table sees the same avatar; the
  choice is mirrored into localStorage for instant render and for guests, who
  have no account to attach it to. `client/src/utils/avatars.js` holds the
  registry of looked-up avatars and `useAvatars()` (in `hooks/useAvatars.js`)
  loads the names a component renders.
- **Settings Panel:** In-game gear icon for preferences
  - Toggle four-color deck
  - Toggle auto-pass
  - Toggle advanced bots

### Gameplay Helpers
- **Quick Select** (`tableV2/ControlsRow.jsx`, backed by `utils/handFinder.js`):
  - Chips for every hand type currently playable
  - Chips that can beat the pile are accented; tapping one cycles through the
    alternatives of that type
- **Drag & Drop Card Reordering:**
  - Reorder hand cards by dragging (@dnd-kit); touch and mouse
  - Swipe across the fan to select a run of cards

### Layout
- Card size and overlap come from `useHandGeometry`, driven by the active
  table layout: the fan fills a phone's width and spreads out on desktop.
- Seats are positioned relative to the viewer, so you are always at the bottom.
- Opponent card counts show on each seat; on desktop the score rail repeats
  them alongside ratings.

### Visual Features
- Custom logo and favicon
- Smooth card animations with Framer Motion plus the `cdd*` keyframes
- Accent colour, table surface and reduced-motion are user preferences
  (`useTableTheme`)
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
- **Voice/WebRTC:** simple-peer 9.11
- **Backend:** Express 5.2, Socket.io 4.8, SQLite3 5.1
- **Libraries:** @dnd-kit (drag & drop), openskill (ratings), bcrypt 6.0 (auth)
- Client uses ES modules; server uses CommonJS

### Deployment & Environment
- **Platform:** Fly.io (Dockerized)
- **CI/CD:** GitHub Actions
- **Environment:** Environment-based CORS configuration
- **Database:** `/data/database.sqlite` (Fly.io Volume), `./database.sqlite` (Local)
- Dynamic API URL detection (production vs development)
- Database path: `/data/database.sqlite` in production (Docker volume), `./database.sqlite` in dev
- Hardcoded dev URLs: client expects server at `localhost:3000`, server accepts `localhost:5173`

#### Server environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `NODE_ENV` | — | `production` switches DB path to `/data` and tightens CORS |
| `IDLE_SHUTDOWN_MINUTES` | `360` (6h) | The process exits once it has been continuously idle — no rooms and no connected sockets — for this long, letting Fly scale to zero. Any room or socket resets the clock. Fly restarts the machine on the next request. |
| `CLIENT_URL` | — | Allowed CORS origin in production |
| `GOOGLE_CLIENT_ID` | — | Google OAuth |
| `GAMELOG_ENABLED` | off | Must be exactly `"1"`. Enabled in `fly.toml`. |
| `GAMELOG_PATH` | `/data/gamelog.sqlite` prod, `server/gamelog.sqlite` dev | |
| `GAMELOG_EXPORT_SECRET` | — | HMAC key for pseudonymizing user ids. Needed only to export, never to record. **Never rotate it** — doing so changes every `subject` and breaks joining a player across old and new shards. |
| `GIT_SHA` | falls back to `FLY_MACHINE_VERSION` | Recorded as `server_build` on every logged game |

Set non-secret values in `fly.toml`'s `[env]`; use `fly secrets set` for
secrets. `GAMELOG_*` are read at process start, so changing them needs a deploy
or `fly machine restart`.

### Game Implementation Details
- Rooms are stored in-memory (lost on server restart)
- Card value encoding: `rankIndex * 4 + suitIndex` for comparison
- Reconnection handling: players can rejoin in-progress games
- Bot decisions captured with reasoning for debug panel
- Bot AI uses retention-cost heuristics, card counting, and per-round opponent
  modelling built from `Room.trickHistory`
- Stats calculated at round-end and persisted to multiple tables

### Key Design Patterns
- Context API for global state (preferences, suit colors)
- Socket.io for real-time bidirectional communication
- React Router for SPA navigation
- Component composition with prop drilling for socket connection
- Server-side game state management with client updates via socket events
