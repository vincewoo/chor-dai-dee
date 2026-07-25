# Game State History Store — Design

Status: **proposal, not implemented.** This document is the design only; no
schema or instrumentation has been added to the server yet.

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
| Private hands | Record all four hands, with opt-out and retention | [Privacy](#8-privacy-retention-and-consent) |
| Deliverable | Design doc only | — |

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
  be (see [§8](#8-privacy-retention-and-consent)).

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
    advanced_bots   INTEGER NOT NULL DEFAULT 0,
    schema_version  INTEGER NOT NULL,
    rules_version   INTEGER NOT NULL,
    server_build    TEXT,                      -- git sha, for post-hoc triage
    started_at      INTEGER NOT NULL,          -- epoch ms
    ended_at        INTEGER,
    end_reason      TEXT CHECK(end_reason IN
                       ('threshold','dragon','abandoned','partial')),
    total_rounds    INTEGER NOT NULL DEFAULT 0,
    winner_seat     INTEGER
);

-- Seat occupancy segments. A new segment starts whenever the occupant changes.
CREATE TABLE mlog_seat (
    game_key        INTEGER NOT NULL,
    seat            INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
    segment         INTEGER NOT NULL DEFAULT 0,
    from_round      INTEGER NOT NULL,
    to_round        INTEGER,                   -- NULL = still occupied at game end
    occupant        TEXT    NOT NULL CHECK(occupant IN
                       ('human','guest','bot_heuristic','bot_ppo')),
    subject_key     TEXT,                      -- pseudonymous human id, or bot profile name
    policy_gen      INTEGER,                   -- bot logic generation; NULL for humans
    policy_ref      TEXT,                      -- legible policy id, e.g. 'modelParameters136500'
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
    think_ms     INTEGER,                      -- ms from turn start to action
    source       INTEGER NOT NULL,             -- 0=human, 1=auto-pass pref, 2=bot,
                                               -- 3=server rule, 4=bot fallback (see below)
    PRIMARY KEY (game_key, round_number, ply)
) WITHOUT ROWID;

-- Optional. Bot policy internals, for distillation and for debugging regressions.
CREATE TABLE mlog_bot_decision (
    game_key     INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    ply          INTEGER NOT NULL,
    reasoning    TEXT NOT NULL,                -- JSON: scored alternatives, factors
    PRIMARY KEY (game_key, round_number, ply)
) WITHOUT ROWID;

CREATE INDEX idx_mlog_game_started   ON mlog_game(started_at);
CREATE INDEX idx_mlog_game_reason    ON mlog_game(end_reason, started_at);
CREATE INDEX idx_mlog_seat_user      ON mlog_seat(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_mlog_seat_occupant  ON mlog_seat(occupant);
```

### What the existing tables already cover

`game_history` and `game_participants` cover some of this, and the new store
should not duplicate what they do well. The gaps are why it exists:

| Metadata | `game_history` / `game_participants` | New store |
|---|---|---|
| Short vs standard | `game_mode`, `max_points` — complete | `game_mode`, `point_threshold` |
| Player is a bot | `is_bot`, binary only | `mlog_seat.occupant`, 4-way |
| *Which* bot policy | **absent** | `advanced_bots` + `occupant` |
| Bot logic generation | **absent** | `policy_gen`, `policy_ref` |
| Per-ply policy fallback | **absent** | `mlog_action.source = 4` |
| Bot personality | name string only, unmarked | `subject_key` |
| Seat identity across swaps | **lost** | seat + segment |
| Rule-set in force | **absent** | `rules_version`, `server_build` |

Three of those gaps matter enough to call out:

**Bot policy is not recorded anywhere today.** `useAdvancedBots` is a
`start_game` parameter that lands in `room.settings`, and each bot carries
`difficulty: 'easy' | 'advanced'`. Neither is persisted. A corpus that cannot
separate heuristic-bot games from PPO-bot games is pooling two unrelated
policies under one label, which corrupts opponent modelling and any evaluation
that conditions on opponent strength.

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

**Do not read `player.difficulty` to label the policy.** It is decorative at
decision time. `checkBotTurn` branches on the room-wide
`settings.useAdvancedBots` (`RoomManager.js:1250`) and never consults
`difficulty`. `replaceWithBot` hardcodes `difficulty: 'advanced'`
(`RoomManager.js:330`), so a bot replacing a departed human in a heuristic room
is labelled "advanced" while actually running the heuristic policy. Read
`settings.useAdvancedBots`. The inconsistency in the game code is arguably worth
fixing on its own, but the log must not depend on that happening first.

**Policy is not stable within a seat.** If `getAdvancedBotMove` rejects, the
catch block silently falls back to `BotLogic.getBotMove` **for that ply only**
(`RoomManager.js:1265`) and the game continues on the PPO policy afterwards. A
seat-level `policy_gen` would quietly mislabel those plies as PPO decisions when
a different policy produced them. Hence `source = 4` on the action row: the seat
carries the intended policy, the ply records when something else actually
answered. Fallbacks should be rare, so a non-trivial count of `source = 4` is
also a useful health signal that the PPO worker is failing in production.

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
human modelling and for detecting AFK or disconnected-and-stalling play. It
requires a `turnStartedAt` timestamp, set in `advanceTurn()` and in
`clearTrickState()`. Meaningless for bots (they run on a fixed 250 ms timer) —
store `NULL`.

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
| Open game | `start_game` handler, `index.js:1427` | Insert `mlog_game` + `mlog_seat` segments |
| Capture deal | `Room.startRound()`, after dealing | Buffer the 52-byte deal + `start_seat` |
| Append ply | `Room.playHand()` / `Room.passTurn()`, on the success paths only | Push onto in-memory `room.mlTape` |
| Seat change | `replaceWithBot()` / `replaceBot()` | Close current segment, open the next |
| Flush round | `handleRoundOver()`, `index.js:762` | One transaction: round row + all plies |
| Flush dragon | `handleDragonWin()`, `index.js:627` | Deal only; `end_reason='dragon'`, zero plies |
| Close game | game-over branch of `handleRoundOver()` | Finalize `mlog_game` |
| Flush partial | `cleanupInactiveRooms()`, `RoomManager.js:1607` | Persist the in-flight round as `'partial'` |

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

**≈20 KB per game**, or ~60 KB with `mlog_bot_decision` enabled.

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

## 8. Privacy, retention, and consent

This store permanently records **what cards every real person held**, plus their
per-decision timing. That is a materially different privacy posture from the
existing aggregate stats tables, and it should be treated as such rather than
absorbed silently.

- **Opt-out.** Add `ml_logging_opt_out` to `user_preferences`. If any seated
  human has opted out, the game is not logged at all. Partial logging is not
  offered: a deal with one hand redacted is useless for the perfect-information
  training this store exists to enable, so it would cost the privacy without
  buying the data.
- **Disclosure.** One line in the privacy policy stating that game hands and
  timings are retained for model training, with the retention window.
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
  "think_ms": 3200,
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
- **Timing and behavioural models** — `think_ms` against decision difficulty.

---

## 11. Open questions

1. **Bot reasoning capture.** `mlog_bot_decision` triples the corpus size and is
   currently only produced when `debugMode` is on (`RoomManager.js:1197`).
   Sampling it — say 5% of bot decisions — probably gives most of the
   distillation value at a fraction of the cost. Needs a decision before the
   table is created rather than after.
2. **Disconnected players.** A disconnected human's turn currently stalls rather
   than auto-passing, so their `think_ms` can be minutes. Either clamp it at
   write time or add a `stalled` flag; otherwise the timing distribution has a
   long tail that means "went to lunch", not "thought hard".
3. **Abandoned games.** Rooms are reaped after 30 minutes of inactivity
   (multiplayer) or 24 hours (single-player). Truncated games are still useful
   for round-level supervision but not for game-placement labels. The
   `end_reason` column carries the distinction; the export filter needs to
   actually respect it.
4. **Rematch chains.** `startRematch()` mints a new `gameId` but keeps the same
   players in the same room. Linking consecutive games would enable
   within-session adaptation modelling — a `previous_game_key` column on
   `mlog_game` is nearly free if it is added now rather than backfilled.

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
but the retention window from [§8](#8-privacy-retention-and-consent) should be
disclosed before the first game is logged, not before the first export.
