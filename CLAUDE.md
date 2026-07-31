# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chor Dai Dee is a multiplayer Big 2 card game with a React frontend and Express/Socket.io backend. The project features comprehensive statistics tracking, heuristic bot AI, a skill-based rating system, and extensive accessibility options. The project is organized as a monorepo with separate `client/` and `server/` directories.

## Development Commands

### Client (React + Vite)
```bash
cd client/
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run lint         # ESLint checks
npm test             # Node's built-in runner over test/*.test.js (pure utils only)
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
npm test             # regression tests (bot logic, game log, replay, export, activity feed)
npm run bench        # bot self-play benchmark + behavioural metrics
npm run bench:difficulty # difficulty-tier ladder + monotonicity gate
npm run bot:rl:train # train the candidate-value policy with canonical JS rules
npm run bot:rl:bench # held-out learned-vs-heuristic evaluation
npm run bot:rl:experience # generate canonical replay rows for batched training
npm run bot:rl:generation # parallel collect, CUDA-train, paired benchmark + diagnose
npm run bot:rl:human # convert exported human games to public-state replay rows
                     # (--include-guests to add guest seats as an anonymous pool)
npm run bot:rl:gpu   # optimize replay rows with project-local CUDA PyTorch
```

Game log tooling (all off unless `GAMELOG_ENABLED=1`):
```bash
npm run gamelog:verify                              # replay every logged round
npm run gamelog:export -- --out data/ --humans-only # JSONL training shards
npm run gamelog:archive -- --out archive/ --dry-run # archival + retention
```

Note: bot logic, the game-history store, the activity feed's SQL, and the
account/rename helpers are covered by tests; the socket layer and REST endpoints
are not. Tests that need `db.js` set `DATABASE_PATH` to a scratch file *before*
requiring it.

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
- `App.jsx` - Router with routes: `/` (Login), `/lobby`, `/game/:roomId`, `/stats`,
  `/profile` (account settings; guests are redirected, having no account row)
- Socket.io connection initialized in App and passed as prop to children

#### Components (`components/`)
- **Game Components:**
  - `Login.jsx` - User authentication. Owns the state, validation and network
    calls for all five auth flows; `tableV2/LoginV2.jsx` only says how they look.
  - `Profile.jsx` - Account settings (rename, password, Google link/unlink),
    split the same way against `tableV2/ProfileV2.jsx`. Each card is its own form
    with its own status line, so a success in one is not read as a success in the
    one below it. Reached from the username on the home screen — the bottom nav
    has to hold one line at 320px, so a fifth destination does not go there.
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
(the standard felt-and-gold tokens and `useTableTheme`) and the `cdd*` keyframes
in `index.css`. There is no second, older UI: the legacy green/white Tailwind
screens were removed when desktop moved to v2.

The split is by **composition, not design**. `hooks/useMediaQuery.js` is the one
place breakpoints are defined — `useIsDesktop()` (768px width) picks the
composition, `useIsWide()` (1024px width) decides whether the desktop table's
rails fit, and `useIsShortViewport()` (760px height) switches the mobile table
to its compact layout tier for viewports with mobile-browser chrome visible.

- `GameTableMobile.jsx` / `GameTableDesktop.jsx` - the two in-game orchestrators.
  They take an **identical prop bundle** (built once in `GameRoom.jsx`) and share
  every leaf component; only the arrangement differs. Mobile is a full-bleed
  stack; desktop is a three-column grid whose rails hold `ScorePanel` and
  `RoundLogPanel` permanently. Below `useIsWide()` those rails are dropped and
  the desktop table falls back to the mobile affordances for the same
  information — the HUD's Info toggle (`ScoreStrip`) and `RoundLogSheet`.
- `layout.js` - `MOBILE_LAYOUT` / `MOBILE_COMPACT_LAYOUT` / `DESKTOP_LAYOUT`:
  seat placements, pile frame and scale, banner placement, hand geometry caps.
  The v2 table was built with these offsets inline for a ~390x844 phone; they
  live here now so a second composition does not mean a second set of
  components. The compact tier (picked by `useIsShortViewport()`) shifts seats
  and pile up and shrinks the pile so the table also fits ~650px-tall
  viewports; the pile frame is anchored top *and* bottom (`maxHeight` restores
  the tall-viewport look) so it can never extend under the bottom controls.
  The status banner renders in the bottom stack's normal flow on both tables
  (`placement=null`), so it cannot collide with the pile. **Every leaf still
  defaults to the mobile values**, so a component rendered without a placement
  prop looks exactly as it did before desktop existed.
- `RoundLogRows.jsx` - the log rows, shared by the mobile sheet and the desktop
  rail so the two can't drift.
- `SuitWatermark.jsx` - the oversized faded suit shapes every v2 screen
  background uses, drawn as **SVG paths, never text glyphs**. iOS resolves
  ♠ ♥ ♦ ♣ to Apple Color Emoji, and a colour font ignores `color` - as text
  these rendered on iPhone as full-opacity black and red emoji on top of the
  page. Anywhere a suit *must* stay text (card pips, hand-type chips) the
  symbol carries the U+FE0E text-presentation selector for the same reason;
  `SUIT_SYMBOLS` in `theme/tableTheme.js` is the canonical copy.
- `HomeScreenV2.jsx` - the home screen. The logo is a corner mark, not a hero:
  the page opens on identity + the one button that starts a game, then a single
  Live/Recent switch over one hairline-separated list (joinable rooms in
  progress / finished games) instead of a stack of panels. Destinations are a
  viewport-`fixed` bottom bar on phones - an absolutely-positioned footer inside
  the scroller lands on top of the content once the page grows - and header
  links from 768px up.
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
- `timeAgo.js` - Compact relative-time labels ("7mo ago"), shared by the
  activity feed and the home screen's recent-games list
- `joinErrors.js` - Pure predicate deciding whether a `join_room` error is
  worth a toast (the lobby's reconnect probes also miss with "Room not found")

### Backend Structure (`server/`)

#### Core Server Files
- `index.js` - Express server with REST endpoints and Socket.io event handlers
- `db.js` - SQLite database layer with comprehensive schema
- `username.js` - The username and password rules, shared by registration, the
  Google signup flow and the profile rename. They used to live inline in two
  endpoints and nowhere at all in a third, so which rules applied depended on
  which door you came through. Reserves the `Guest_` prefix: guest seats are
  auto-named `Guest_1234` and recorded in `game_participants` with a NULL
  `user_id`, sharing the `UNIQUE(game_id, username)` key with account rows, so an
  account allowed to hold that shape could collide with its own history on
  rename (and impersonate a guest besides).
- `gamelog.js` - Append-only game-history store for offline ML, in its own
  `gamelog.sqlite`. Every write is guarded so a store failure can never surface
  to a player or abort a round.
- `gamelogRecorder.js` - Glue between gameplay and the store; resolves seated
  players to account ids for attribution

#### Game Logic Modules (`game/`)
- `RoomManager.js` - Room creation, player management, game state, reconnection handling
- `Big2Rules.js` - Hand validation and comparison logic
- `Deck.js` - Card deck (ranks: 3→2, suits: Diamonds < Clubs < Hearts < Spades)
  (display can be remapped per-viewer; see the Pusoy Dos lens)
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
  - "Poker First" hand organisation - preserves strong 5-card hands.
    `comboBreakPenalty` prices the **combination destroyed**, never the rank of
    the card pulled out of it: a flush is equally wrecked whether it is broken
    with its 8 or its Ace, and that card's rank is already charged in full by
    `moveRetentionCost`. Scaling by the departing card made the cheapest card
    the cheapest way to wreck the hand, so the model would break a flush to lead
    a pair. See `docs/BOT-HEURISTICS-REVIEW.md` § 16.
  - **A full house is never built out of a second triple** - `organizeHand`'s
    greedy five-card pass skips a full house whose *pair* half comes from a rank
    the hand holds exactly three of, so two triples stay two triples. Without
    that guard `organized.triples` came back empty in exactly those hands, and
    `comboBreakPenalty` then charged every alternative - including leading either
    triple whole - for breaking a combination that only existed because a triple
    had been dismantled to build it. The organizer's pick was the one move paying
    nothing, so it was scored twice. See `docs/BOT-HEURISTICS-REVIEW.md` § 17.
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
  - **The heuristic is no longer the live policy.** Production runs the promoted
    generation-14 PPO actor (`fly.toml` sets `BOT_POLICY = "ppo"`), selected per
    room by `BotPolicy.createBotPolicy()`. Inference is pure JavaScript, so Fly
    needs no Python, CUDA or GPU. Setting `BOT_POLICY` back to `heuristic` and
    `COACH_POLICY` back to `move_quality` is a configuration-only rollback.
    An *earlier* advanced bot — a PPO network served by a Python worker — was
    removed for erroring on Fly.io and falling back to the heuristic anyway;
    `SOURCE.BOT_FALLBACK` is the one genuine fossil of it, reserved so old tapes
    decode and written by nothing. `bot_ppo` and `advanced_bots` are not
    fossils: they are written on every production game.
- `BotPolicy.js` - Chooses what plays a bot seat and how hard it tries.
  `createBotPolicy({ mode, difficulty })` returns one object exposing `getMove`,
  `profileFor` and its own provenance (`occupant`, `policyGen`, `policyRef`,
  `difficulty`); a Room snapshots exactly one, so nothing can dispatch on a
  different policy from the one it records. See `docs/BOT-DIFFICULTY.md`.
  - **Difficulty is one dial: the softmax temperature the PPO actor is sampled
    at.** `competitive` (the default) is argmax and byte-identical to the
    pre-difficulty bot; `balanced` and `casual` sample at rising temperature.
    Measured against a fixed full-strength reference seat, the three tiers give
    that reference 25% / 33% / 40% of rounds. Temperature below ~2 is
    indistinguishable from argmax, and the heuristic is only ~1.4pp weaker than
    PPO, so neither is a usable "easy" setting — both were measured, not assumed.
  - **`sample: true` also disables PPOBot's heuristic-override guard**, because
    `PPOBot` gates it on `!sample`. Deliberate: the guard pulls near-tie
    deviations back to the heuristic move, which is exactly what produces the
    weakening. It is worth ~0.1pp, so nothing is lost. Do not decouple them
    without re-running `npm run bench:difficulty`.
- `BotContext.js` - Builds the observation a bot reasons over. Shared by live
  play, the self-play benchmark, and the game-log replayer so all three see
  identical features. Takes plain seat-indexed state, never a Room.
- `PPOModel.js` / `PPOBot.js` - The live learned policy. Variable-action
  actor/critic over server-generated legal candidates, sharing `RLValueBot`'s
  `decisionOptions` encoder so live play, replay and grading see identical
  features. `PPOBot` takes `{ sample, temperature, overrideMargin }` — the knobs
  the difficulty tiers are built from.
- `RLValueModel.js` / `RLValueBot.js` - Experimental variable-action value
  policy, and the canonical candidate encoder the PPO path also uses. Server-
  generated legal candidates are scored from public information, with a
  margin-gated heuristic fallback. Training and promotion instructions are in
  `docs/RL-VALUE-BOT.md`; the value policy is a training/benchmark path and a
  distillation teacher, not the live bot.
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
- `MoveQuality.js` - Grades one decision by ranking every legal option in
  BotLogic's cost model. `rankOptions` is the shared primitive: `evaluateMove`
  finds the played move inside the ranked list, and the coach takes the top of it.
- `MoveReview.js` - Picks the handful of graded decisions worth showing a person,
  as named situations (`missed_win`, `blunder`, `found_forced_win`, ...)
- `Coach.js` - The owl coach. **Decides nothing of its own**: a hint is the top of
  `MoveQuality.rankOptions`, and a live note is `MoveReview.classify` run on the
  grade RoomManager already computes for every human move. Sharing both means the
  coach can never recommend a move it would then call a mistake, and a mistake
  called out at the table is the same one the post-game review lists.
  - Live grading has **no outcome and no opponent hands**. `classify` is passed
    `outcome: null`, which drops the two gamble kinds (the trick has not resolved
    yet); the observation carries opponents' card *counts* only, so a hint can
    only ever be derived from what the player can already see.
  - **Coach prose never names a suit.** The Pusoy Dos lens remaps suits per
    viewer, so a server string saying "the 5 of diamonds" would be wrong for half
    the table. Moves are described in ranks and shapes ("the pair of Jacks");
    the client draws the cards themselves with the lens-aware `PileCardGlyph`.
    Pinned by test in `test/coach.test.js`.
  - Corrections are unlimited; praise is rationed to `COACH_CREDITS_PER_ROUND`
    (RoomManager) so the owl does not applaud every good move.

### REST API Endpoints

#### Authentication & User
- `POST /api/register` - User registration
- `POST /api/login` - User login
- `POST /api/auth/google` - Google sign-in; unknown Google accounts get
  `needsAction` and choose between creating an account and linking one
- `POST /api/auth/google/register` / `POST /api/auth/google/link` - the two
  arms of that choice

#### Account (profile page)
There are no sessions or tokens in this app — the client holds `{id, username}`
in localStorage — so **every account mutation carries its own proof of ownership
in the body**: the current password, or a Google ID token whose `sub` is already
on the row. The second form exists because a Google-only account has no password
to offer and would otherwise be locked out of its own settings.
- `GET /api/account/:userId` - username, whether a password exists, whether
  Google is linked. The email is **masked** here, since this GET is
  unauthenticated like `/api/preferences/:userId`.
- `POST /api/account/:userId/username` - rename + history backfill (below)
- `POST /api/account/:userId/password` - set a first password or change one.
  An account that *has* a password must prove it with that password, never with
  a Google token — otherwise linking Google would be a way to take over an
  account whose owner only wanted it as a second way in.
- `POST /api/account/:userId/google/link` - link from inside a session. Proof is
  the password specifically: the token being linked proves nothing about this
  account yet.
- `POST /api/account/:userId/google/unlink` - refused unless a password is set,
  or you would clear the account's only credential.

#### Statistics
- `GET /api/stats/:username` - Basic user stats
- `GET /api/stats/:username/detailed` - Detailed stats with mode filter (short/standard)
- `GET /api/stats/:username/rounds` - Recent round history
- `GET /api/stats/:username/head-to-head` - Head-to-head records vs other players
- `GET /api/stats/:username/tier3` - Advanced analytics (Tier 3)
- `GET /api/stats/:username/hand-strength` - Deal strength vs. outcome. Returns
  four scopes (`all`, `vsBots`, `vsCasualBots`, `vsHumans`) so beating bots and
  beating humans stay distinguishable — and so rounds against deliberately
  weakened bots do not silently inflate the `vsBots` baseline, which exists
  precisely so farming bots does not read as general strength. The client only
  offers the fourth chip once there are rounds in it. Each carries a per-tier
  win rate against the baseline,
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
  Bot strength is automatic: the server averages every human player's saved
  placement calibration and snapshots that policy for the complete game.
- `play_card` - Submit a hand
- `pass_turn` - Pass current turn
- `next_round` - Start the next round after round ends
- `get_room_state` - Request current room state (for reconnection)
- `toggle_debug` - Enable/disable bot debug panel
- `set_coach` - Turn the coach on/off for this seat (re-sent after reconnect,
  since the server keys it on player id)
- `coach_hint` - Ask what to play. Read-only, and answered only for the asking
  seat on its own turn.

#### Server → Client
- `room_update` - Room state changes (players joining/leaving)
- `game_started` - Game has begun
- `hand_update` - Player's hand cards
- `game_update` - Game state changes (plays, turns, etc.)
- `round_over` - Round has ended with scores
- `game_over` - Game has ended with final results
- `dragon_win` - Dragon detected, instant game win (Hong Kong variation)
- `bot_reasoning` - Bot decision analysis (for debug panel)
- `coach_hint` - The coach's suggested move + reasoning (to the asker only)
- `coach_note` - The coach's unprompted reaction to the move just made (to the
  player who made it only)
- `reconnected` - Client successfully reconnected
- `error` - Error messages

### Game History Store (ML)

Separate from `database.sqlite`. Records the deal, the seating, and the ordered
actions; every intermediate state is re-derived by replay rather than stored.
Keyed on **seat index, not socket id** - socket ids change mid-game on
reconnect and on bot/human swaps. See `docs/GAME-STATE-HISTORY-STORE.md`.

Tables: `mlog_game`, `mlog_seat` (occupancy segments), `mlog_round` (deal +
outcome labels), `mlog_action` (the tape).

Bot difficulty is recorded, not filtered out: `mlog_seat.difficulty` per seat
and `mlog_game.weakened_bots` per game (one weakened seat taints the whole
game's labels, since round utility is zero-sum). Games against easier bots are
still real data - the human moves in them are genuine human decisions and the
bot rows are valid league opponents. What is biased is the *outcome label*, so
the exporters emit everything by default and offer `--competitive-only` for the
clean subset. Labelling is the irreversible half; a filter can be applied later,
but data exported without provenance can never be sorted out.

**`gamelog.js` has no automatic migration.** `createSchema` only runs
`CREATE TABLE IF NOT EXISTS`, which is a no-op on an existing database, and
every write is wrapped in `guard()` - so a column added to the `SCHEMA` array
alone would leave production silently failing to record seats, with the error
caught and logged rather than raised. Anything added to a table after its first
release must also go in `ADDED_COLUMNS`. `test/gamelogMigration.test.js` builds
a v1 database on disk and asserts a real write survives.

Recording requires `GAMELOG_ENABLED=1` (there is no per-player opt-out).
Unsetting it is the kill switch.

Guest seats are recorded like any other - the tape is keyed on seat, not on who
occupies it - but anonymously: `occupant` is `guest`, with no `subject_key`,
`user_id` or rating. They are therefore selectable for training only as one
undifferentiated pool, via `--include-guests` on either human converter (off by
default). Their round labels are load-bearing regardless of whether you train on
them, because a four-seat zero-sum utility cannot be reconstructed without them.

### Database Schema

#### Activity Feed Tables
- `game_history` - One row per game, `status` in `completed` / `abandoned` /
  `in_progress`. A game is opened `in_progress` by `start_game` and reaches a
  terminal status two ways: `completed` at game over, or `abandoned` via
  `recordAbandonedGame()` (`index.js`) when the room is destroyed mid-play —
  the inactivity sweep, or the last human walking out. `in_progress` is
  therefore a *live* game and no feed filter selects it; a row stuck there is a
  bug, and `db.sweepAbandonedGames()` converts any survivors at boot.
  Note both this table and `game_participants` store the **username**, not just
  the id — they are the only two places in the schema that do, and therefore the
  only two a rename has to backfill (`db.renameUser`, one transaction with the
  `users` update). Everything else — every `stats*` table, `round_stats`,
  `head_to_head_stats`, `placement_history`, the avatar lookup, the leaderboard —
  keys on `user_id` and joins the name at read time, so it follows a rename for
  free. The ML game log stores no username at all. A rename that landed in
  `users` but not here would be worse than one that never happened: the stale
  rows become indistinguishable from another player's.
- `game_participants` - Who was in each game. Abandoned games carry rows too
  (scores at the moment the game died) but with a **NULL `final_placement`**,
  since an unfinished game has no standings. Anything reading placements must
  filter `final_placement IS NOT NULL` rather than assume abandoned games have
  no rows.
  Abandoned rows are attributed to whoever *owned* each seat, not to whoever sat
  in it at teardown: leaving mid-game swaps the seat for a bot
  (`replaceWithBot`, which stashes the displaced player on `replacedHuman`), so
  reading `room.players` recorded a rage quit containing four bots and nobody to
  attribute it to. `Room.describeParticipants()` resolves this and is the only
  place that should. Completed games deliberately keep the opposite rule — those
  rows carry a real placement, and someone who left half a game ago should not
  be credited with one a bot earned.

#### Core Tables
- `users` - User accounts (id, username, password_hash, google_id, google_email).
  A Google-created account has **no `password_hash`**; anything comparing one
  must guard for that, since bcrypt rejects on a null hash.
- `username_history` - One row per rename. Renaming rewrites the two columns that
  denormalize a username, so a retired name leaves no trace anywhere else — and
  once free it can be registered by somebody else. This is the record of which
  account used to hold it.
- `user_preferences` - Settings (four_color_mode, pusoy_mode, auto_pass,
  coach_enabled, reduced motion, sound, avatar_animal/avatar_tile). The legacy
  `table_theme`, `accent_color`, and `bot_difficulty` columns remain for migration
  compatibility but are no longer exposed or used.
- `stats` - Overall player statistics
- `stats_short` - Short game mode statistics
- `stats_standard` - Standard game mode statistics

#### Analytics Tables
- `round_stats` - Per-round granular stats (plays, passes, leads_won, combinations,
  plus deal strength: `deal_strength_raw`, `deal_tier`, `deal_rank`,
  `deal_baseline_version`, `human_opponents`, `bot_difficulty`). The deal columns are NULL on rows
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
- **Pusoy Dos Suit Lens:** A per-user, **display-only** remap of every rendered
  suit glyph and colour from the underlying order (D < C < H < S) to the
  Filipino Pusoy Dos order (C < S < H < D).
  `client/src/utils/suitLens.js` holds the permutation and nothing else. Because
  both are total orders over the same four suits, aligning them position-for-
  position gives an order-preserving bijection — which is why no rule,
  comparison or flush check changes, and why the underlying 3♦ opener correctly
  displays as the 3♣ a Pusoy Dos player expects.
  The seam is exactly two leaf components — `tableV2/HandCardFaceV2.jsx` and
  `tableV2/PileCardGlyph.jsx` — plus a handful of user-facing strings
  (`StatusBanner`, `HowToPlay`, and the one card-naming server error, reworded
  on arrival by `lensServerMessage`). Both leaves key the symbol *and* the
  colour off the lensed suit, so a card shown as ♦ is drawn red; remapping only
  the symbol is the bug to watch for.
  **Hard rule: the lens must never reach card data.** `play_card` payloads, the
  `${rank}-${suit}` identity keys, the socket protocol, `SUITS_ORDER` in
  `cardUtils.js`, the bots, stats and the ML game log all keep seeing the
  underlying suit. A lensed suit in the 52-byte deal blob or the 52-bit card
  masks would corrupt stored tapes irreversibly. `BotDebugPanel` is dev-only and
  deliberately stays in underlying notation.
- **Auto-Pass:** Automatically pass when no valid moves available
- **Coach (off by default):** Adds an owl button on the left edge of the
  Pass/Play row (`tableV2/CoachBubble.jsx`). Tapping it on your turn asks the
  server for the best move, auto-selects those cards, and explains the choice in
  a speech bubble; it suggests passing where passing is what the model prefers.
  The same owl speaks up unprompted after a misplay. See `server/game/Coach.js` —
  the client is purely presentational and never second-guesses the suggestion.
- **Avatars:** Emoji animal on a coloured tile, picked in the v2 Avatar Picker.
  Stored on the account so every player at the table sees the same avatar; the
  choice is mirrored into localStorage for instant render and for guests, who
  have no account to attach it to. `client/src/utils/avatars.js` holds the
  registry of looked-up avatars and `useAvatars()` (in `hooks/useAvatars.js`)
  loads the names a component renders.
- **Settings Panel:** In-game gear icon for preferences
  - Auto-pass and the optional owl coach
  - Two-/four-color suits and the display-only Pusoy Dos suit lens
  - Sound toggle/volume, table surface/accent and reduced motion

### Gameplay Helpers
- **Quick Select** (`tableV2/ControlsRow.jsx`, backed by `utils/handFinder.js`):
  - Chips for every pair, triple or five-card hand type present in the player's
    cards; single cards are selected directly from the hand
  - Playable types use the table accent. Types that cannot beat the pile stay
    visible in grey and remain clickable; every chip is grey between turns so
    the player can review their hand while waiting
  - The first click selects the lowest currently playable combination. Further
    clicks cycle through the rest, with non-playable lower previews ordered after
    the playable responses
  - At the start of a turn, the chip scroller aligns the first playable type to
    its left inset, bounded by the scroller's maximum position
  - Reset and Sort are pinned to the right of the chip row, outside its
    scrollable area, so they stay visible while the chips scroll
- **Drag & Drop Card Reordering:**
  - Tap cards to select them or reorder them by dragging (@dnd-kit); touch and
    mouse. There is deliberately no swipe-across selection gesture.

### Layout
- Card size and overlap come from `useHandGeometry`, driven by the active
  table layout: the fan fills a phone's width and spreads out on desktop.
- Seats are positioned relative to the viewer, so you are always at the bottom.
- Opponent card counts show on each seat; on desktop the score rail repeats
  them alongside ratings.
- **Low-card alert:** at or below `LOW_CARD_THRESHOLD` (3) cards an opponent's
  seat switches to `ALERT_RED` — warmed badge, red ring (`cddAlertRing`, off
  under reduced motion) and a "N LEFT" chip in place of the plain count — and
  the score rail reddens their card line. The colour is deliberately fixed
  rather than accent-driven, so it never collides with the accent turn glow and
  never gets themed away. Only opponents alert: your own short hand is the goal,
  not a warning (`isLowCards` + the `!isMe` guard in `ScorePanel`).

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
| `DATABASE_PATH` | `/data/database.sqlite` prod, `server/database.sqlite` dev | Overrides both. Exists so tests can point `db.js` at a scratch file — requiring it opens and migrates whatever path it resolves. |
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
- A room outlives the games played in it (rematches, lobby restarts), so
  `room.createdAt` and `room.gameStartedAt` are different questions. Anything
  reporting a *game's* duration reads `gameStartedAt`, stamped by `startGame()`
  where `roundNumber === 0` — the one "a new game is starting" signal a room
  gets, and the same place both reuse paths mint a new `gameId`. Reading
  `createdAt` charged every game for the lobby wait before it and charged a
  rematch for the whole previous game.
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
