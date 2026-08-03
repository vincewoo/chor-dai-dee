# Game State History Store — Design

Status: **implemented.** This document is the design; the code follows it. See
[Implementation](#13-implementation) for the file map and how to run the tools.

**Recording is ON in production.** `GAMELOG_ENABLED = "1"` is set in
`fly.toml`, so every game played on the live server is recorded from the next
deploy onwards. There is deliberately **no per-player opt-out**, which means the
disclosure in [§8](#8-privacy-and-retention) is the only thing standing between
the store and a player who did not expect it — it needs to be published.

To stop recording: remove that line from `fly.toml` and deploy, or
`fly machine restart` after unsetting it. The flag is read at process start, not
per game.

## Goal

Keep a complete, lossless history of every game played on the live server, in a
form suitable for training machine-learning models later — behaviour cloning
from human play, offline RL, opponent modelling, and evaluation of new bot
policies against real trajectories.

## Assumptions

Four design questions were open when this was written and are resolved here by
default. Each is cheap to revisit; the section that depends on it is noted.

| Question | Assumed answer | Affects |
|---|---|---|
| Storage substrate | Separate `gamelog.sqlite` on the same Fly volume | [Substrate](#1-substrate) |
| Fidelity | Deal + action log, states re-derived by replay | [Model](#2-the-central-decision-log-the-tape-not-the-state) |
| Private hands | Record all four hands; no opt-out, retention enforced | [Privacy](#8-privacy-and-retention) |
| Deliverable | Design doc, then implemented | [§13](#13-implementation) |

---

## 1. Substrate

A new SQLite database, separate from `database.sqlite`:

- Development: `server/gamelog.sqlite`
- Production: `/data/gamelog.sqlite` (same volume already mounted in `fly.toml`)

Reasons to keep it out of the existing database:

- **Write profile is opposite.** `database.sqlite` serves interactive reads
  (stats dashboards, leaderboard, activity feed). The game log is append-only,
  never read by the app, and will grow 100× faster. Sharing one connection and
  one WAL means log flushes contend with the round-end stats path that `db.js`
  already had to hand-tune with `withTransaction` batching.
- **Different lifecycle.** You will want to `scp` the corpus off the volume,
  truncate it, or drop and rebuild it as the schema evolves. Doing that to a
  file that also holds user accounts is needlessly risky.
- **Different retention.** Accounts are permanent; raw hand histories should not
  be (see [§8](#8-privacy-and-retention)).

Same pragmas as `db.js` (`WAL`, `synchronous=NORMAL`, `busy_timeout=5000`) and
the same `withTransaction` queueing helper, which should move to a small shared
module rather than being copied.

`*.sqlite` is already covered by `.gitignore`, so the new file needs no change
there. **Check the Fly volume's provisioned size before enabling this** —
`fly.toml` declares the mount but not a size, and [§7](#7-volume) shows the log
outgrows a default 1 GB volume within a year at modest traffic.

---

## 2. The central decision: log the tape, not the state

Big 2 is fully deterministic given the deal. Every intermediate state — each
player's hand, the pile, who has passed, whose turn it is, the set of legal
moves — is a pure function of:

1. the initial 4×13 deal,
2. the seating order,
3. the ordered sequence of actions,
4. the rules in force.

So the store records those four things and nothing else. All state is
reconstructed by **replaying** the tape through the same `Big2Rules` module the
server plays with.

This matters more than it first appears:

- **Size.** A snapshot-per-decision store is roughly 50–100× larger for exactly
  the same information.
- **No feature lock-in.** The features you want in six months are not the ones
  you would guess today. If features are baked into rows at write time, adding
  one means re-instrumenting the server and losing all history before the
  change. With replay, you regenerate the whole corpus from day one.
- **No rule drift.** `Big2Rules.validateHand` has genuinely subtle behaviour —
  the A-2-3-4-5 straight is the *highest*, flush comparison folds suit into
  `value`, quads and full houses take their value from the multiple, not the
  kicker. A separate Python feature extractor would reimplement this and get it
  wrong. Replay makes the training pipeline import the same code path, so it
  cannot disagree.

The cost is a replayer that must be exercised by tests. That cost is paid once.

### Replay contract

`server/game/Replayer.js` exposes:

```js
replayRound(round, actions) -> Array<Snapshot>
```

where each `Snapshot` is emitted immediately before an action and carries the
full perfect-information state (all four hands, pile, passed set, turn, trick
history) plus the acting seat's observable projection and its legal move set.
Training code consumes snapshots; nothing else parses the schema.

Two invariants make this trustworthy, both enforced by tests:

1. **Replay is total.** Every persisted round replays to completion without a
   rules violation, and the final hand sizes match the `cards_left` recorded at
   round end. This is the single best corruption detector available and should
   run as a nightly sweep over recent games, not just in CI.
2. **Replay reproduces derived columns.** Where the schema denormalizes
   something for query convenience (`hand_type`, `hand_value`), replay must
   recompute the identical value.

---

## 3. Identity: seats, not socket IDs

**This is the most important schema decision and the easiest to get wrong.**

Everything in the current server keys players by `player.id`, which is a
Socket.io socket ID. That identifier is unstable *within a single game*, in at
least three ways already present in `RoomManager.js`:

- `reconnectPlayer()` — a human reloading the page gets a new socket ID, and the
  method hand-migrates eight separate maps to keep up (`RoomManager.js:118-156`).
- `replaceWithBot()` — a player who leaves mid-game is replaced by a bot that
  inherits their hand under a new ID (`RoomManager.js:313`).
- `replaceBot()` — a human joining in progress takes over a bot's hand and ID
  (`RoomManager.js:432`).

A tape keyed on socket ID is unusable: the same physical seat changes key
mid-round, and the same key can mean different agents at different times.

The log therefore keys on **seat index 0–3**, the position in `room.players`.
That array is mutated in place and never reordered, so a seat is stable for the
lifetime of a game. Turn order is `(seat + 1) % 4`, which also makes relative
positional features (already used by `BotLogic`'s opponent modelling) trivial to
derive.

*Who* occupies a seat is recorded separately, as a segment with a round range,
so occupancy changes are first-class data rather than corruption:

- a human replaced by a bot at round 5 produces two segments for that seat;
- `joined_mid_game` is carried through, so trajectories from a player who
  inherited someone else's hand can be excluded from imitation learning (they
  are contaminated — the player did not choose the hand they are playing).

`room.gameId` is the right game key: it is regenerated on both `startRematch()`
and `transitionToLobby()` (`RoomManager.js:1409`, `RoomManager.js:1451`), so it
is genuinely per-game and joins cleanly to the existing `game_history` table.

---

## 4. Encoding

**Cards** reuse the existing `value = rankIndex * 4 + suitIndex` (0–51) from
`Deck.js`. No new encoding, no conversion layer, no chance of a mismatch.

**The deal** is a 52-byte `BLOB` where `deal[cardValue] = seat`. Fixed width,
order-independent, canonical, and trivially inverted into four hands. It is
worth being compact and exact here because it is the one field that cannot be
derived from anything else.

Note that `Deck.shuffle()` uses unseeded `Math.random()`
(`Deck.js:31`), so the deal cannot be reconstructed from a stored seed — it must
be stored explicitly. Seeding the shuffle with a logged PRNG seed would shrink
this to 8 bytes, but at ~10 rounds per game that saves ~440 bytes per game
against a real risk of the PRNG implementation changing under the log. Not
worth it.

**Played cards** are a 52-bit mask in a single SQLite `INTEGER` (which is
64-bit). A pass is `0`. This is compact and directly queryable — `WHERE
cards_mask & (1 << 51)` finds every play containing the 2♠ without a replay
pass.

**Hand types** are stored as the ordinal of the existing `HAND_TYPES` order, not
as text, and the ordinal-to-name mapping is pinned in the schema version.

---

## 5. Schema

`schema_version` and `rules_version` are on every game row. A store that will be
replayed years after it was written needs both: the first says how to parse, the
second says which rules to replay under. The Hong Kong dragon rule and the
2♠ auto-pass are house rules that may well change, and old games must keep
replaying under the rules they were actually played with.

```sql
-- One row per game (matches room.gameId, joins to game_history.game_id).
CREATE TABLE mlog_game (
    game_key        INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         TEXT    NOT NULL UNIQUE,
    room_id         TEXT    NOT NULL,
    game_mode       TEXT    NOT NULL,          -- 'short' | 'standard'
    point_threshold INTEGER NOT NULL,
    advanced_bots   INTEGER NOT NULL DEFAULT 0,  -- historical; see the note below

    schema_version  INTEGER NOT NULL,
    rules_version   INTEGER NOT NULL,
    server_build    TEXT,                      -- git sha, for post-hoc triage
    started_at      INTEGER NOT NULL,          -- epoch ms
    ended_at        INTEGER,
    end_reason      TEXT CHECK(end_reason IN
                       ('threshold','dragon','abandoned')),
    abandon_reason  TEXT CHECK(abandon_reason IN            -- NULL unless abandoned
                       ('all_bots','single_player_timeout',
                        'multiplayer_timeout','orphaned_restart')),
    total_rounds    INTEGER NOT NULL DEFAULT 0,
    winner_seat     INTEGER,
    previous_game_key INTEGER,                 -- prior game in the same room; NULL starts a chain
    chain_kind      TEXT CHECK(chain_kind IN ('rematch','lobby_restart'))
);

-- Seat occupancy segments. A new segment starts whenever the occupant changes.
CREATE TABLE mlog_seat (
    game_key        INTEGER NOT NULL,
    seat            INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
    segment         INTEGER NOT NULL DEFAULT 0,
    from_round      INTEGER NOT NULL,
    to_round        INTEGER,                   -- NULL = still occupied at game end
    occupant        TEXT    NOT NULL CHECK(occupant IN
                       ('human','guest','bot_heuristic','bot_ppo')),  -- bot_ppo: historical
    subject_key     TEXT,                      -- pseudonymous human id, or bot profile name
    policy_gen      INTEGER,                   -- bot logic generation; NULL for humans
    policy_ref      TEXT,                      -- legible policy id, e.g. 'modelParameters136500'
    difficulty      TEXT,                      -- frozen tier; NULL on older rows/humans
    bot_mode        TEXT,                      -- adaptive or fixed
    policy_temperature REAL,                   -- exact frozen Adaptive strength
    bot_style       TEXT,                      -- secret PPO persona; never sent to players
    user_id         INTEGER,                   -- NULL for bots/guests; never exported raw
    rating_mu       REAL,                      -- rating at game start, for quality filtering
    rating_sigma    REAL,
    joined_mid_game INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_key, seat, segment)
);

-- One row per round. Holds the deal and the outcome labels.
CREATE TABLE mlog_round (
    game_key     INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    deal         BLOB    NOT NULL,             -- 52 bytes: deal[cardValue] = seat
    start_seat   INTEGER NOT NULL,
    end_reason   TEXT    NOT NULL CHECK(end_reason IN ('normal','dragon','partial')),
    winner_seat  INTEGER,
    ply_count    INTEGER NOT NULL DEFAULT 0,
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    cards_left   TEXT,                         -- JSON [seat0..seat3]
    round_points TEXT,                         -- JSON [seat0..seat3]
    score_after  TEXT,                         -- JSON [seat0..seat3] cumulative
    PRIMARY KEY (game_key, round_number)
);

-- The tape. Authoritative: action, cards_mask, think_ms, source.
-- Derived-for-convenience: hand_type, hand_value (replay must reproduce these).
CREATE TABLE mlog_action (
    game_key     INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    ply          INTEGER NOT NULL,             -- 0-based, monotonic within round
    seat         INTEGER NOT NULL,
    action       INTEGER NOT NULL,             -- 0=pass, 1=play, 2=auto-pass (2♠ rule)
    cards_mask   INTEGER NOT NULL DEFAULT 0,   -- 52-bit; 0 for any pass
    hand_type    INTEGER,                      -- HAND_TYPES ordinal; NULL for pass
    hand_value   INTEGER,
    think_ms     INTEGER,                      -- ms from turn start, clamped (see below)
    source       INTEGER NOT NULL,             -- 0=human, 1=auto-pass pref, 2=bot,
                                               -- 3=server rule, 4=bot fallback (see below)
    flags        INTEGER NOT NULL DEFAULT 0,   -- bit 0: think_ms was clamped
                                               -- bit 1: a disconnect overlapped this turn
    PRIMARY KEY (game_key, round_number, ply)
) WITHOUT ROWID;

CREATE INDEX idx_mlog_game_started   ON mlog_game(started_at);
CREATE INDEX idx_mlog_game_reason    ON mlog_game(end_reason, started_at);
CREATE INDEX idx_mlog_seat_user      ON mlog_seat(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_mlog_seat_occupant  ON mlog_seat(occupant);
CREATE INDEX idx_mlog_game_prev      ON mlog_game(previous_game_key)
                                        WHERE previous_game_key IS NOT NULL;
```

### What the existing tables already cover

`game_history` and `game_participants` cover some of this, and the new store
should not duplicate what they do well. The gaps are why it exists:

| Metadata | `game_history` / `game_participants` | New store |
|---|---|---|
| Short vs standard | `game_mode`, `max_points` — complete | `game_mode`, `point_threshold` |
| Player is a bot | `is_bot`, binary only | `mlog_seat.occupant`, 4-way |
| *Which* bot policy | **absent** | `occupant` (`advanced_bots` while a second policy existed) |
| Bot logic generation | **absent** | `policy_gen`, `policy_ref` |
| Per-ply policy fallback | **absent** | `mlog_action.source = 4` (historical) |
| Bot personality | name string only, unmarked | `subject_key` for identity; `bot_style` for the hidden PPO persona |
| Seat identity across swaps | **lost** | seat + segment |
| Rule-set in force | **absent** | `rules_version`, `server_build` |

Three of those gaps matter enough to call out:

**Bot policy is not recorded anywhere today.** Neither the room's bot setting
nor the per-bot `difficulty` field was persisted. A corpus that cannot separate
one bot policy from another is pooling unrelated policies under one label, which
corrupts opponent modelling and any evaluation that conditions on opponent
strength. That is what `occupant` and `policy_gen` are for, and the argument
outlives the specific policies: the heuristic itself is versioned by
`BOT_LOGIC_VERSION` and has already been through five generations.

> **Amended.** The advanced (PPO) bot has since been removed — it did not
> outplay the heuristic and its Python/TensorFlow worker did not survive on
> Fly.io. Every bot seat written from that point on is `bot_heuristic`, and
> `advanced_bots` is left at its default. `bot_ppo`, `advanced_bots` and
> `source = 4` remain in the schema so games logged before the removal stay
> readable; nothing writes them. The passages below describing the two-policy
> code are kept because they explain why those columns exist.

**Bot names are policy parameters, not labels.** `BotLogic.getBotProfile(name)`
derives variability, patience, and aggression from the bot's name, so `Bot 2`
and `Bot 3` at the same table play measurably differently — that is the point of
the profile system. `subject_key` therefore stores the bot's name for the same
reason it stores a pseudonymous key for humans: it identifies the agent whose
behaviour is being recorded. Bots with no matching profile are fully
deterministic, which is itself worth being able to filter on.

**Seat identity survives occupancy changes.** `game_participants` is
`UNIQUE(game_id, username)` and `replaceWithBot` names its replacement
`Bot (OldName)` (`RoomManager.js:327`) — a different username, so a mid-game
departure inserts a fifth participant row rather than updating the fourth.
Nothing records that the bot inherited the human's hand and score, and the
departed human keeps NULL placement and score forever. Seat-plus-segment makes
the handover explicit and attributable.

### Notes on specific columns

**`previous_game_key` / `chain_kind` — rematch chains.** Two paths create a
successor game in the same room, and both link:

- `startRematch()` (`RoomManager.js:1428`) → `'rematch'`. The players explicitly
  chose to face the same opponents again, which is itself behaviourally
  informative — they were not tilted enough to walk.
- `transitionToLobby()` (`RoomManager.js:1382`) then a fresh `start_game` →
  `'lobby_restart'`. A weaker link: the roster can change in the lobby.

Both mint a new `gameId` while keeping the room, so the `Room` must stash the
outgoing `gameId` as `previousGameId` *before* overwriting it. The store resolves
that to a surrogate key on insert with
`(SELECT game_key FROM mlog_game WHERE game_id = ?)`, which yields NULL if the
predecessor was never logged — an opted-out or failed-write game breaks the
chain rather than corrupting it, which is the right failure.

Roster continuity is deliberately *not* denormalized here: compare `subject_key`
across the two games' `mlog_seat` rows. That matters most for `'lobby_restart'`,
where a chain link does not imply the same people. Nor is there a `session_key` —
a session is the maximal chain, recoverable by traversal, and storing it would
be a second source of truth for something already recorded.

Chains are bounded by room lifetime, not by time in general: a `'finished'` room
is reaped after 5 minutes idle and a `'waiting'` room after 30, so consecutive
games in a chain are always close together. Abandoned games never chain at all,
since both entry points require `gameState === 'finished'`.

**`end_reason` / `abandon_reason` — truncated games.** Abandoned games are kept,
not discarded, because abandonment truncates a *game*, not a *round*. Rounds
flush atomically at `handleRoundOver`, so a game abandoned during round 7 still
carries six rounds with valid deals, complete action sequences, and correct
round-level outcomes — indistinguishable in quality from a completed game for
anything that learns per-decision or per-round.

What survives, by granularity:

| Granularity | Abandoned game |
|---|---|
| Completed rounds | Fully usable |
| In-flight round (`mlog_round.end_reason='partial'`) | Actions valid for imitation; no reward target |
| Game-level labels | Lost — placement, winner, terminal score |

The proportions decide it: a standard game is ~10 rounds and ~500 decisions
against a single game-placement scalar. Discarding abandoned games to protect
that scalar throws away the decisions carrying most of the signal.

**The real hazard is selection bias, not the missing labels.** Games are not
abandoned at random — players leave when losing, tilting, or bored in a
one-sided game — so abandoned games are enriched for bad positions, especially
in their final rounds. A value function fitted on round rewards pooled across
both classes will misprice positions. Behaviour cloning is more robust, since
conditioning on state absorbs much of it, but losing players genuinely do play
differently (dumping high cards), so the learned policy still shifts.

`abandon_reason` records which cleanup rule fired, which maps directly onto how
biased the sample is:

- `all_bots` — no humans, so no behavioural bias.
- `single_player_timeout` (24 h) — almost certainly a closed tab; mild.
- `multiplayer_timeout` (30 min) — someone walked out mid-game; the strongest
  bias, and the class to reweight or exclude first.
- `orphaned_restart` — the process died. Deploys are independent of game state,
  making these an essentially unbiased random sample and the one class of
  truncated game that can be pooled freely.
- `last_human_left` — the last human seat emptied mid-game, leaving only bots,
  and the room was destroyed on that same tick. Same bias class as
  `multiplayer_timeout`, but observed directly rather than inferred from
  inactivity.

Two things have to exist for this to be recorded at all:

1. **Cleanup must write a close-out.** `cleanupInactiveRooms()` returns the rooms
   it reaped, and `index.js` flushes each one through `recordAbandonedGame()`.
   The paths where the last human walks out are wired to the same function,
   because those delete the room immediately and the sweep never sees them.
2. **A startup orphan sweep.** If the process dies, nothing writes anything. On
   boot, mark every `mlog_game` with a NULL `ended_at` as
   `end_reason='abandoned', abandon_reason='orphaned_restart'`. Without it,
   killed games stay indistinguishable from live ones forever.

Both apply to `game_history` as well as to this store; `recordAbandonedGame()`
writes both, and `db.sweepAbandonedGames()` is the `game_history` counterpart of
the boot sweep. That was not always true: for most of the project's life nothing
wrote `'abandoned'` to `game_history` at all, despite it being in the CHECK
constraint and having its own activity-feed filter, so every abandoned game sat
at `'in_progress'` — a status no filter selects.

**Measure this before building.** The existing `game_history` table already
answers how much it matters. Note that the `in_progress` count is only the
historical abandoned count on a database that predates the sweep; after it runs
those rows have been converted, and `in_progress` means genuinely live:

```sql
SELECT status, COUNT(*) FROM game_history GROUP BY status;
```

If abandonment is a large fraction — plausible for a casual web game where most
sessions are one human against bots — then discarding is not an option and the
reweighting question is the only one that matters.

**`policy_gen` / `policy_ref` — bot logic generation.** Which *generation* of bot
logic produced a trajectory, so a model trained later can filter or condition on
it. `occupant` says which family of policy played; these say which version of it.

- `bot_heuristic` → `policy_gen` is `BOT_LOGIC_VERSION`, a new monotonic
  constant in `BotLogic.js`; `policy_ref` is NULL.
- `bot_ppo` → `policy_gen` is the checkpoint's training step (`136500` today);
  `policy_ref` is the checkpoint filename (`'modelParameters136500'`).

Ordering is meaningful **only within a family** — heuristic generation 7 and PPO
generation 136500 are not comparable. Any query that filters on `policy_gen`
must also filter on `occupant`.

This matters more for the heuristic bot than for the PPO weights, which is the
opposite of what you might expect. The checkpoint has never changed. `BotLogic.js`
has ~14 commits, at least ten of them explicitly behavioural — "Rework bot
heuristics around a single scoring currency", several `fix(bot):` commits
adding and then removing penalties for wasting 2s. That is roughly ten
generations of materially different opponents already, and games played against
them are indistinguishable in the current data. **Pre-store history cannot be
backfilled**: start the constant at 1, note in its changelog that it means "as of
the first logged game", and do not try to reconstruct what came before.

Three implementation notes, each a way this gets recorded wrongly:

**Do not read `player.difficulty` to label the policy.** It was decorative at
decision time: `checkBotTurn` branched on the room-wide `settings.useAdvancedBots`
and never consulted `difficulty`, while `replaceWithBot` hardcoded
`difficulty: 'advanced'` — so a bot replacing a departed human in a heuristic
room was labelled "advanced" while actually running the heuristic policy. The
log read the room setting instead. *(Both fields are gone with the advanced bot;
`describeSeats` now labels every bot seat `bot_heuristic` directly. The general
rule stands: label a seat from what actually answers for it, not from a field
set where the bot was created.)*

*(Amended again: a difficulty setting now exists, and it follows exactly that
rule. The tier lives on `room.botPolicy` — the same object `checkBotTurn`
dispatches through — and `describeSeats`, the seat payload and the bot's seated
rating all read `this.botPolicy.difficulty`. There is no per-player
`difficulty` field to disagree with it, because there is no second field at all.
`test/botDifficulty.test.js` asserts the seat description and the dispatching
policy agree, including for a `replaceWithBot` seat, which is the case the
original implementation got wrong. Recorded as `mlog_seat.difficulty`, with
`mlog_game.weakened_bots` as the game-level roll-up; NULL/0 on pre-tier rows,
which is historically accurate.)*

*(The `bot_ppo` occupant and `advanced_bots` are no longer fossils either — the
promoted generation-18 PPO actor is the live policy and both are written on
every production game. `SOURCE.BOT_FALLBACK` is still written by nothing.)*

*(Hidden PPO personas add one intentionally per-seat behavioural field:
`mlog_seat.bot_style`. Unlike the discarded decorative difficulty property,
this is the exact value passed to `PPOBot` for that seat. It is omitted from
`getGameState()` and debug reasoning, retained across an immediate rematch, and
exported only for offline measurement. NULL on older rows means the unmodified
classic actor.)*

**Policy is not stable within a seat.** If `getAdvancedBotMove` rejected, the
catch block fell back to `BotLogic.getBotMove` **for that ply only** and the
game continued on the PPO policy afterwards. A seat-level `policy_gen` would
have quietly mislabelled those plies as PPO decisions when a different policy
produced them. Hence `source = 4` on the action row: the seat carries the
intended policy, the ply records when something else actually answered. *(With
one policy left there is nothing to fall back to, so `source = 4` is never
written now. Reintroduce it, not a new code, if a second policy ever returns.)*

**`BotLogic.js` is not the whole behavioural surface.** `checkBotTurn` builds the
`gameContext` the bot reasons over — card counts, the relative re-indexing of
`trickHistory`, the profile lookup (`RoomManager.js:1144-1193`). Change that and
behaviour changes with `BotLogic.js` untouched and `BOT_LOGIC_VERSION` unbumped.
**Decision: extract it** into `server/game/BotContext.js`, as build step 1. See
below.

### Extracting the observation builder

`gameContext` is the bot's observation — the features the policy sees. It
belongs with the policy, not with room bookkeeping, and it needs to be one
implementation for three independent reasons:

1. **The exporter would otherwise be a third copy.** [§9](#9-export) emits `obs`
   re-indexed to the acting seat exactly as `checkBotTurn` does, so a policy
   trained on exports drops straight in as a bot. If the exporter reimplements
   that indexing, the training data drifts from the thing it is training —
   the same failure the replay-don't-snapshot design exists to prevent,
   reintroduced one layer up.
2. **It is already duplicated.** `botHarness.js:77` builds it under a comment
   promising it matches `checkBotTurn`, which nothing verifies. `npm run bench`
   — the measurement that decides whether a bot change was an improvement —
   runs on that copy. The two are behaviourally equivalent today: the harness's
   extra `&& e.hand` filter is a no-op given that `trickHistory` never stores a
   falsy hand, and its `rng` field is a deliberate addition for reproducible
   benchmarks (`BotLogic.js:1053` defaults to `Math.random`). But one
   intentional divergence has already accumulated, which is how this starts.
3. **It makes the hash boundary honest**, which was the original motivation and
   is the least important of the three.

Signature takes plain state, not a `Room` — the replayer reconstructs state and
never builds `Room` instances:

```js
buildGameContext({ hands, seat, passedSeats, passCount,
                   playedCards, trickHistory, lastPlayedHand, profile, rng })
```

Seat-indexed, no socket IDs, no `Room` coupling. `RoomManager` adapts at the
call site (it already maps `playerId` to index), the harness drops its copy, and
the exporter calls it directly. The harness's `rng` injection survives as a
documented parameter rather than an undocumented extra field.

The move is low-risk: the block reads state and returns an object, with no
mutation, timers, async, or control flow. It also brings the first direct test
coverage of the relative re-indexing, which currently has none despite the
defensive `if (relative === 0) relative = 4; // Shouldn't happen` in
`RoomManager.js:1190`.

**`rules_version`.** A monotonic integer from a single `RULES_VERSION` constant,
bumped by hand whenever any of the following changes:

- hand validity or comparison (`Big2Rules`) — including the A-2-3-4-5 and
  2-3-4-5-6 straight special cases and the flush suit-in-`value` convention;
- the Hong Kong dragon rule (active, and its 39-point penalty);
- the 2♠ single auto-pass rule;
- round scoring, including the 1×/2×/3× penalty tiers (`Scoring.js`);
- who leads (3♦ on the first round, previous winner thereafter).

The list is the contract: if a change is not on it, it does not affect replay.
Keep a changelog table in this document mapping each version to what changed,
because a bare integer in a database three years from now is worthless without
one.

`server_build` (git sha) is the backstop. `rules_version` is a convenience index
that a human maintains and can therefore forget to bump; the sha pins the exact
source that produced the game and cannot be wrong. Record both — when they
disagree, the sha wins.

**Keeping the version constants honest.** `RULES_VERSION` and
`BOT_LOGIC_VERSION` share a failure mode: they are hand-maintained, so they will
eventually be forgotten on a commit that changes behaviour, and the corpus will
silently attribute two different policies to one generation. That is worse than
having no version at all, because it looks trustworthy.

The fix is a golden-hash test, in the existing `server/test/` suite. Pin the
SHA-256 of `BotLogic.js` (and of `Big2Rules.js` + `Scoring.js` for
`RULES_VERSION`) in the test file. When the source changes the test fails with:

> `BotLogic.js` changed. If behaviour changed, bump `BOT_LOGIC_VERSION`.
> Re-pin the hash either way.

Human judgment stays in the loop — only a person can say whether an edit was
behavioural — but the *prompt* becomes automatic and impossible to skip, which
is the part that fails in practice. It is the same shape as a snapshot test.

The known wart: hashing whole files means comment-only edits also trip it,
costing a one-line re-pin. Hashing only behaviour-bearing code would need real
parsing, and that is not worth building to avoid an occasional trivial diff.

**`action = 2` (auto-pass).** When a single 2♠ is played the server marks all
three opponents as passed without asking them (`RoomManager.js:856-869`). These
are server-generated, not decisions, and must never be treated as training
examples for a pass policy. Recording them explicitly — rather than letting the
replayer re-derive them — means a change to that house rule cannot silently
rewrite the meaning of old logs.

**`source`.** Separates a human's deliberate pass from one their auto-pass
preference made for them. Without this, the auto-pass setting quietly poisons
any behaviour-cloning target, because the model learns to imitate a client-side
convenience toggle.

**`think_ms`.** Not derivable, and one of the strongest available signals for
human modelling. Requires a `turnStartedAt` timestamp, set wherever a seat
acquires the turn: `advanceTurn()`, `clearTrickState()`, the trick-win branch of
`playHand()` where the turn stays put, and `startRound()`. Meaningless for bots
(fixed 250 ms timer) — store `NULL`.

**Clamped at `THINK_MS_CEILING = 120_000`.** A disconnected human's turn stalls
rather than auto-passing — nothing in `RoomManager` advances past them — so an
unclamped `think_ms` records how long someone was at lunch, bounded only by the
room cleanup timeouts of 30 minutes (multiplayer) or **24 hours**
(single-player). Two minutes is deliberately generous: it should destroy no
legitimate deliberation, only values nobody would train on either way.

The ceiling is a lossy transform, so it is pinned to `schema_version` — changing
it makes old and new rows incomparable and requires a bump.

Clamping alone would silently blur "thought hard for two minutes" into "walked
away", so `flags` records why:

- **bit 0, clamped** — the raw value exceeded the ceiling.
- **bit 1, disconnect overlapped** — the acting player was disconnected at any
  point during the turn. Detected directly rather than inferred from duration:
  snapshot a per-player disconnect counter (incremented in `markDisconnected()`)
  at turn start, and compare at action time, also treating "already
  disconnected when the turn began" as a hit.

Both are needed. Bit 1 catches a brief drop that reconnects in 20 seconds — an
in-range value that is still not a decision time — while bit 0 catches a slow
human who never disconnected. Any timing model should exclude both; behavioural
models that only care about *what* was played can keep them.

**What is deliberately *not* stored:** hand sizes, whose turn it is, the passed
set, legal-move sets, pile state, trick boundaries, and all
`trickWinPending`/`playOrder` fields. The first five are replay outputs; the
last two are presentation-layer state that affects only client animation timing
and has no bearing on the game.

Legal-move sets in particular are tempting and should be resisted: the PPO
encoding in `server/ai/enumerateOptions.py` is 1695-dimensional, so a stored
mask would dominate the entire corpus. Enumerating it at replay time costs
microseconds.

---

## 6. Write path

### Where the hooks go

The instrumentation surface is unusually small, because every action — human and
bot alike — already funnels through two methods. Bots do not have a side
channel: `checkBotTurn` calls the same `playHand`/`passTurn`
(`RoomManager.js:1219`, `RoomManager.js:1234`).

| Hook | Site | Does |
|---|---|---|
| Open game | `start_game` handler, `index.js:1427` | Insert `mlog_game` (resolving `previousGameId` to `previous_game_key`) + `mlog_seat` segments |
| Chain link | `startRematch()` / `transitionToLobby()` | Stash the outgoing `gameId` as `previousGameId` before regenerating it |
| Capture deal | `Room.startRound()`, after dealing | Buffer the 52-byte deal + `start_seat` |
| Append ply | `Room.playHand()` / `Room.passTurn()`, on the success paths only | Push onto in-memory `room.mlTape` |
| Seat change | `replaceWithBot()` / `replaceBot()` | Close current segment, open the next |
| Flush round | `handleRoundOver()`, `index.js:762` | One transaction: round row + all plies |
| Flush dragon | `handleDragonWin()`, `index.js:627` | Deal only; `end_reason='dragon'`, zero plies |
| Close game | game-over branch of `handleRoundOver()` | Finalize `mlog_game` |
| Flush partial | `cleanupInactiveRooms()`, `RoomManager.js:1607` | Persist the in-flight round as `'partial'`, finalize the game row with `abandon_reason` |
| Orphan sweep | server boot, before accepting connections | Close out games left with NULL `ended_at` as `'orphaned_restart'` |

### Buffer in memory, flush per round

Plies accumulate in a plain array on the `Room` and are written in a single
transaction at round end, alongside the round row. This mirrors the existing
`trackDecisionsBatch` pattern in `db.js:1011` (including its 999-bound-parameter
chunking, which a 60-ply round with 8 columns will not approach but should
inherit anyway).

Per-turn writes are the obvious alternative and the wrong one: they put a disk
write in the path of every card played, for a consumer that reads the data
offline, weeks later, in bulk.

The cost of buffering is that an in-flight round is lost if the process dies.
That is already true of the whole game — rooms are in-memory only and a restart
drops every active game — so the log is no more fragile than the thing it
observes. What it must not do is silently lose *completed* rounds, hence the
flush on cleanup and the `'partial'` marker.

### Failure isolation

**Every log write is wrapped so that a failure logs and returns.** The history
store is an observer. A malformed row, a full disk, or a locked database must
never surface as an error to a player mid-game or abort a round transition. This
is the one hard rule in the write path, and it is worth a test that injects a
throwing store and asserts the game completes normally.

### The dragon case

`startRound()` returns early when a dragon is dealt (`RoomManager.js:657-664`),
before any play happens. The deal still gets logged: a 13-distinct-rank hand is
a genuine ~1-in-millions datum, it explains an otherwise inexplicable game
outcome, and omitting it would bias the deal distribution in the corpus.

---

## 7. Volume

Per game, assuming ~10 rounds and ~50 plies per round:

| Table | Rows/game | ≈Bytes/row | Total |
|---|---|---|---|
| `mlog_game` | 1 | 150 | 150 B |
| `mlog_seat` | 4–8 | 90 | ~500 B |
| `mlog_round` | 10 | 220 | 2.2 KB |
| `mlog_action` | 500 | 35 | 17.5 KB |

**≈20 KB per game.**

| Traffic | Per day | Per year |
|---|---|---|
| 100 games/day | 2 MB | 730 MB |
| 1,000 games/day | 20 MB | 7.3 GB |

The `mlog_action` figure is why `game_key` is an `INTEGER` surrogate rather than
the `TEXT` `game_id` used everywhere else: repeating a 30-byte string across 500
rows per game would roughly double the corpus for no benefit. `game_id` lives on
`mlog_game` alone and joins outward from there.

At 1,000 games/day this outgrows a default 1 GB Fly volume in under two months,
so archival is a requirement rather than a nicety — see below.

---

## 8. Privacy and retention

This store records **what cards every real person held**, plus their
per-decision timing. That is a materially different privacy posture from the
existing aggregate stats tables, and it should be treated as such rather than
absorbed silently.

**There is no per-player opt-out.** Recording applies to every game once
`GAMELOG_ENABLED=1`. That is a deliberate product decision, and it concentrates
the entire privacy posture into the three controls below — there is no user-
facing switch to fall back on, so each of them has to actually hold:

- **Disclosure.** A line in the privacy policy stating that game hands and
  timings are retained for model training, with the retention window. With no
  opt-out this is the *only* thing standing between the store and a player who
  did not expect it, so it should be in place before the first real game is
  logged rather than added afterwards.
- **Deletion must cascade.** There is no account-deletion flow today. When one
  is added it has to reach `gamelog.sqlite`, which is a separate database that
  no existing code path touches — `mlog_seat.user_id` is the join, and clearing
  it leaves the trajectories intact but unattributable, which is usually the
  right outcome. Absent an opt-out, deletion is the only lever a player has.
- **The kill switch is `GAMELOG_ENABLED`.** Unsetting it stops recording
  everywhere without a deploy. Worth knowing it exists before it is needed.
- **Pseudonymization at export.** `user_id` never leaves the server. Exports
  carry `subject_key = HMAC(server_secret, user_id)` — stable across games, so
  per-player modelling still works, but not reversible from the exported corpus
  and not joinable to accounts by anyone who obtains a shard.
- **Retention.** Raw tapes for 180 days, following the precedent already set by
  `DECISION_TRACKING_RETENTION_DAYS = 30` in `db.js:1066`. Exported training
  shards are pseudonymized and may be kept indefinitely.
- **Archival sweep.** A periodic job exports games older than 30 days to
  compressed shards, then deletes them from `gamelog.sqlite`. This is what keeps
  the live database small enough to stay on the volume, and it is the same job
  that enforces retention. It needs `VACUUM` after large deletes, since SQLite
  does not return freed pages to the filesystem on its own.

---

## 9. Export

`server/scripts/export-training-data.js` reads a game range, replays every round
through `Replayer`, and emits gzipped JSONL — one object per decision:

```jsonc
{
  "game": "game_1753412...", "round": 3, "ply": 17,
  "seat": 2, "subject": "h:9f3c...", "occupant": "human",
  "rating_mu": 27.1,
  "obs": {
    "hand": [4, 17, 22, ...],           // acting seat's cards, 0-51
    "pile": { "type": 3, "value": 41, "cards": [...] },
    "pile_owner_rel": 2,                // 1=next, 2=across, 3=previous
    "counts_rel": [7, 3, 11],
    "passed_rel": [false, true, false],
    "played": [0, 1, 5, ...],           // all cards seen this round
    "history": [ /* re-indexed relative plays */ ]
  },
  "hidden": { "hands": [[...], [...], [...], [...]] },  // perfect info, all seats
  "legal": [ /* enumerated legal moves */ ],
  "action": { "type": "play", "cards": [22, 23], "hand_type": 1 },
  "think_ms": 3200, "think_clamped": false, "turn_disconnected": false,
  "labels": {
    "round_points": 0, "round_placement": 1,
    "game_placement": 2, "won_round": true,
    "points_to_go": 14
  }
}
```

Three deliberate choices here:

- **`obs` is relative, `hidden` is absolute.** The observation is re-indexed to
  the acting seat exactly as `checkBotTurn` already does when building
  `gameContext` (`RoomManager.js:1174-1182`), so a policy trained on exports is
  directly usable as a bot without a translation layer. `hidden` stays in
  absolute seat order because a centralized critic wants a consistent frame.
- **`obs` and `hidden` are separate objects, not merged.** Leaking hidden
  information into the observation is the classic way to train an
  imperfect-information agent that scores brilliantly offline and collapses in
  play. Keeping them in separate keys makes the mistake require deliberate
  effort.
- **Labels are attached at export, not at write.** Return-to-go, placement, and
  points-to-go all depend on the future of the game and on how you choose to
  discount. They belong to the training run, not to the store.

Game-level labels are `null` for abandoned games, and round-level labels are
`null` for the truncated final round — so the exporter must emit
`end_reason`/`abandon_reason` alongside them. A consumer that drops rows on a
null `game_placement` silently discards every abandoned game, which is the
outcome [§5](#notes-on-specific-columns) argues against; one that ignores
`abandon_reason` pools a biased sample. Both failures are quiet, so the export
schema should make the fields hard to miss rather than optional.

Optionally emit a second encoder targeting `server/ai/enumerateOptions.py`'s
1695-action index, so exported human trajectories can seed or fine-tune the
existing PPO network directly. The card encodings differ — `inference.py`
converts to a 1-based scheme with Spades at suit 4 (`inference.py:31-44`) — so
this needs a small, tested adapter rather than an assumption that the two
line up.

---

## 10. What this enables

- **Behaviour cloning** — supervised policy from `(obs, legal, action)`,
  filtered to `occupant='human'`, `joined_mid_game=0`, `source=0`, and a rating
  floor.
- **Offline RL / value learning** — `hidden` gives a perfect-information critic;
  `round_points` and placement give the reward. Big 2's scoring is naturally
  dense at the round level, which helps.
- **Opponent modelling** — the pass record is an inference target: "given what
  seat 2 declined to beat, what can they hold?" `BotLogic.buildOpponentModels`
  already does this heuristically and would become a learnable baseline.
- **Counterfactual bot evaluation** — replay a real trajectory to any decision
  point, ask a candidate bot what it would have done, and compare. Evaluation
  against recorded human play, with no need to run live games.
- **Timing and behavioural models** — `think_ms` against decision difficulty,
  excluding rows flagged as clamped or disconnect-overlapped.
- **Within-session adaptation** — traverse `previous_game_key` to get a chain of
  games against a stable opponent set, and ask whether a player's policy shifts
  as they learn the table. Big 2's fixed four-seat structure makes this cleaner
  than it would be in a game with churn mid-match.

---

## 11. Decisions taken during review

No open questions remain; the schema below is buildable as written. Decisions
made while reviewing this design, with where each is argued:

| Question | Decision | Where |
|---|---|---|
| Bot logic generation | Record per seat, heuristic and PPO separately | [§5](#notes-on-specific-columns) |
| Enforcing version bumps | Golden-hash test, not discipline | [§5](#notes-on-specific-columns) |
| Bot reasoning capture | Dropped — cost outweighed speculative value | — |
| `think_ms` when disconnected | Clamp at 120 s, plus a flags bitfield | [§5](#notes-on-specific-columns) |
| Abandoned games | Keep, and record which cleanup rule fired | [§5](#notes-on-specific-columns) |
| Rematch chains | Link, distinguishing rematch from lobby restart | [§5](#notes-on-specific-columns) |
| Observation builder | Extract to `BotContext.js` as build step 1 | [§5](#extracting-the-observation-builder) |

The defaults in [Assumptions](#assumptions) were never explicitly confirmed and
remain the cheapest things to revisit — particularly the privacy posture, which
should be settled before the first game is logged rather than after.

---

## 12. Suggested build order

1. Extract `BotContext.js` and converge `RoomManager` and `botHarness` onto it.
   A prerequisite for both the replayer and the exporter, and the one step that
   pays for itself even if the store is never built.
2. `Replayer.js` + tests, driven by synthetic tapes. Nothing else is safe to
   build until replay is proven, since replay is what makes the format lossless.
3. Schema + `gamelog.js` store module, with the failure-isolation wrapper.
   Land `BOT_LOGIC_VERSION`, `RULES_VERSION`, and the golden-hash tests here,
   **before** the first game is logged — a corpus whose early rows have an
   unenforced version is a corpus you cannot trust the early rows of.
4. Instrumentation hooks, most-contained first: `startRound` deal capture, then
   `playHand`/`passTurn`, then the flush sites.
5. The replay-completeness sweep, run over real logged games. **Run this before
   writing any training code** — it is what tells you the corpus is sound while
   there is still little of it to discard.
6. Exporter and pseudonymization.
7. Archival and retention job.

Steps 1–5 are the store. Steps 6–7 can follow once real data has accumulated,
but the retention window from [§8](#8-privacy-and-retention) should be
disclosed before the first game is logged, not before the first export.

---

## 13. Implementation

### File map

| File | Role |
|---|---|
| `server/game/BotContext.js` | The bot's observation, shared by live play, the benchmark harness, and replay |
| `server/game/TapeCodec.js` | Deal blob, 52-bit card masks, action/source/flag codes, `think_ms` clamp |
| `server/game/GameTape.js` | In-memory per-round buffer held by `Room` |
| `server/game/Replayer.js` | Reconstructs state from a tape via the live `Big2Rules` |
| `server/gamelog.js` | The store: schema, writes, failure isolation, orphan sweep |
| `server/gamelogRecorder.js` | Glue between gameplay and the store; resolves seats to account ids |
| `server/scripts/verify-gamelog.js` | Replay-completeness sweep |
| `server/scripts/export-training-data.js` | JSONL export with observations, legal moves, labels |
| `server/scripts/archive-gamelog.js` | Archival and retention |

### Configuration

| Variable | Meaning |
|---|---|
| `GAMELOG_ENABLED` | Must be exactly `"1"` to record; anything else, including `"true"`, is a no-op. Set in `fly.toml`. |
| `GAMELOG_PATH` | Override the database location. Defaults to `/data/gamelog.sqlite` in production. |
| `GAMELOG_EXPORT_SECRET` | HMAC key for pseudonymizing user ids. Required to export, never to record, so it can be deferred until you first pull data. Set once via `fly secrets set` and never rotate it: changing it changes every `subject`, so a player can no longer be joined across old and new shards. |
| `GIT_SHA` | Recorded as `server_build`. The authoritative record of what produced a game. |

### Running the tools

```bash
cd server/
npm test                  # 106 tests, including the round trips below
npm run gamelog:verify    # replay every logged round; exits non-zero on failure
npm run gamelog:export -- --out data/ --humans-only
npm run gamelog:archive -- --out archive/ --dry-run
```

### How the correctness claims are tested

The design rests on replay being lossless, so that is tested by round trip
rather than by fixture, at three levels:

1. **`replayer.test.js`** plays deterministic self-play rounds, records the tape
   the server would write, replays it, and requires the reconstruction to match
   — including that replayed observations equal what the bot actually saw. That
   last assertion is what makes exported training data trustworthy.
2. **`instrumentation.test.js`** drives a real `Room` through `playHand` /
   `passTurn` and replays the tape those hooks produced. A tape that is
   internally consistent but disagrees with the live game passes (1) and fails
   here.
3. **`export.test.js`** persists real games, sweeps them, exports them, and
   reads the shards back — asserting mainly on what must *not* appear:
   server-generated plies, rounds that failed to replay, raw user ids.

Four bugs surfaced this way and are worth knowing about, because each would
have produced a plausible-looking corpus rather than an obvious failure:

- Replay recorded 2♠ auto-passes in `trickHistory`; `RoomManager` does not, and
  is right not to, since a forced pass answers nothing about what an opponent
  can beat.
- `RoomManager` was internally inconsistent — play entries pushed a clean
  validated hand, pass entries pushed the pile still carrying `playerId`.
- `ON CONFLICT DO NOTHING` leaves node-sqlite3's `lastID` holding a *stale*
  rowid rather than zeroing it, so reopening a game returned another game's key.
- The exporter ended its gzip streams without waiting for them to flush, so
  `process.exit` could truncate the final shard.

### Deviations from the design above

- **`GameTape` and `gamelogRecorder`** are not in the original file plan. They
  keep `RoomManager` free of persistence and `index.js` free of logging logic,
  matching how `db.js` is already used.
- **`trickHistory` now stores `seat` rather than `playerId`.** Required by the
  replayer, which has no socket-id concept — and it fixes a live bug:
  `reconnectPlayer` migrates eight maps to follow a changed socket id but not
  this one, so a reconnecting player's earlier plays vanished from every bot's
  opponent model for the rest of the round.
- **Auto-pass needed a client change.** The client emits an identical
  `pass_turn` with a randomized 1–3s delay chosen so opponents cannot
  distinguish it, which meant the server could not either. It now sends
  `auto: true`; without that, fabricated delays would land in the middle of the
  plausible human deliberation band.
- **`RULES_VERSION`'s fingerprint excludes `RoomManager.js`**, which hosts the
  2♠ auto-pass and lead determination. It changes constantly for unrelated
  reasons, and the tape records both rules explicitly rather than re-deriving
  them.

### Not done

- **Nothing is scheduled.** `verify` and `archive` are CLIs. The server runs the
  orphan sweep at boot but no periodic archival — wire that to a cron or Fly
  machine once recording is actually on and the volume trend is known.
- **No PPO export encoder.** [§9](#9-export) suggests a second encoder targeting
  `enumerateOptions.py`'s 1695-action index. The card encodings genuinely differ
  (`inference.py` uses a 1-based scheme with Spades at suit 4), so that wants a
  tested adapter rather than an assumption.
- **The privacy disclosure.** There is no opt-out by design, so publishing the
  retention window is the whole of the user-facing privacy story and needs to
  happen before the first real game is logged.
- **Deletion cascade.** No account-deletion flow exists to hook into yet; when
  one is added it must clear `mlog_seat.user_id`.
