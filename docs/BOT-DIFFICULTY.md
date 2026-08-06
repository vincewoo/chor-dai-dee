# Bot difficulty

Difficulty is independent from the hidden move-preference personas documented
in [BOT-PLAYSTYLES.md](BOT-PLAYSTYLES.md). Temperature controls how hard a bot
tries; persona changes what similarly rated alternatives it tends to prefer.

Bot strength is selected automatically, with one opt-in override:

- A solo human plays against `adaptive` bots at the continuous PPO temperature
  chosen from that player's persistent placement calibration.
- A table with multiple humans averages every player's saved calibration and
  uses that middle temperature for its `adaptive` bots. Guests and players
  without any placement history contribute the neutral cold-start estimate.
- **Max difficulty bots** (waiting room, host only, off by default) pins the
  room to `MAX_BOT_DIFFICULTY` — currently `competitive`, the argmax policy —
  instead of the roster average. It is a deliberately quiet, advanced control:
  Adaptive is the right experience for almost everyone, and this exists for
  players who have outgrown it and want a fixed, known-strongest opponent.

The override is held as `Room.forceMaxBots`, not by leaving `botDifficulty` on
`competitive`, because `configureBotPolicyForRoster()` re-applies Adaptive at
every game boundary and would otherwise silently undo the choice. Like the
tier itself, it can only change while the room is `waiting`.

The former `casual` and `balanced` ids remain valid so old preferences, logs,
replays and command-line benchmarks keep their meaning. They are not shown in
the waiting room.

The selected room average is frozen for the complete game. Each registered
human's placement evidence updates their own estimate after the game; the
aggregate is never persisted over an individual player.

## Adaptive calibration

`AdaptiveBotController.js` owns a separate, dimensionless skill estimate.
Calibration measures decision quality to choose a challenge; hidden OpenSkill
rates the completed result against the frozen bots' independently modelled
strength. Neither continuous value is shown to the player.

The first five to ten completed games are calibration games. Completion needs
both a minimum game count and enough evidence, with ten games as the hard stop.
Evidence is measured rather than inferred from the mode label:

- profile-free move-quality decisions count only when they were scored and the
  evaluator was confident;
- at most eight decisions per round count, because choices in one deal and
  board trajectory are correlated;
- round placement is compared with the rank of the original deal, after the
  round ends.

This is why a Standard game usually moves confidence further than a Short game
without being assigned an arbitrary 2x multiplier. It actually contains more
rounds and confident decisions.

The next temperature moves by at most 2 during calibration and 0.75 after it,
with a 0.5 deadband. `Room.startGame()` snapshots that value into `botPolicy`;
no event inside the game can rebuild it.

Game-log seats record `difficulty='adaptive'`, `bot_mode='adaptive'` and the
exact `policy_temperature`. `round_stats` records the same effective
temperature with the deal. Adaptive games set `weakened_bots=1`, so their human
actions remain available while biased outcome/value labels can be filtered.

## The dial

The live bots run the promoted generation-18 PPO actor. Before this feature they
ran it in pure argmax mode: `BotPolicy.ppoPolicy()` built `new PPOBot(model, {
overrideMargin })` and never passed `sample` or `temperature`, so every bot
always played its single best move — which is both why they felt sharp and why
all four played identically.

Difficulty is that one unused knob. `PPOBot` samples from the actor's own
distribution when `sample` is true, and `PPOModel.evaluate(rows, temperature)`
feeds the temperature into `stableSoftmax`. Nothing else changes: same
checkpoint, no retraining, `PPOBot.js` untouched.

Temperature was chosen over the alternatives because it is the only candidate
that is unbounded, monotone and measurable. The others were measured, not
assumed — see the table below.

| Tier | knobs | bot `rating_mu` |
|---|---|---|
| `competitive` (internal fixed-policy default) | `sample: false, overrideMargin: 0.02` | 25.0 (`DEFAULT_MU`) |
| `balanced` | `sample: true, temperature: 4.5` | 19.83 |
| `casual` | `sample: true, temperature: 8` | 12.85 |

`competitive` is byte-identical to the pre-difficulty bot. It remains the
factory default for internal callers, historical tests and fixed-policy
benchmarks. New player accounts explicitly start on Adaptive.

## Measured ladder

`npm run bench:difficulty` seats one fixed full-strength reference player against
three bots of a single tier and reports how often the reference wins. Neutral is
25%; higher means an easier table. 2000 rounds × 2 seeds, seats rotated:

| tier | REF win% | REF pts | bot win% | bot pts |
|---|---|---|---|---|
| casual | 39.6% | 2.24 | 20.1% | 3.53 |
| balanced | 32.8% | 2.61 | 22.4% | 3.27 |
| competitive | 24.7% | 3.11 | 25.1% | 3.21 |

The script exits non-zero unless each tier is at least 3pp easier than the one
above it, and unless `competitive` lands on neutral — a tier that is not
measurably easier than its neighbour is not a tier, it is a duplicate menu entry.

### What the calibration ruled out

Temperature sweep, and the two alternative mechanisms, same harness:

| candidate | REF win% |
|---|---|
| argmax (today) | 25.0 |
| T=1 | 25.3 |
| T=1.5 | 25.4 |
| T=2 | 27.9 |
| T=3 | 28.4 |
| T=6 | 36.0 |
| T=9 | 43.8 |
| T=12 | 47.1 |
| T=20 | 55.4 |
| Heuristic, name-derived profiles | 26.8 |
| Heuristic, no profile | 25.3 |
| Heuristic, forced `variability` 3 / 6 / 12 | 30.3 / 34.6 / 39.8 |
| PPO `sample`, T=0.05 (≈argmax, guard bypassed) | 24.9 |

Four things follow, each of which changed the design:

1. **Temperature below ~2 does nothing.** A table of T=1 bots is
   indistinguishable from argmax — the sampled policy picks the argmax move 79%
   of the time at T=1, and the individually-small errors cancel across three
   symmetric opponents. The usable band is T≈3 to T≈12. An early draft used
   T=2.5 for the middle tier; that is only ~3pp off the default, which a player
   would not feel.
2. **The heuristic is not a usable bottom rung.** With its real name-derived
   profiles it costs the reference only ~1.4pp versus PPO argmax, consistent
   with the PPO-vs-heuristic numbers in `RL-VALUE-BOT.md`. Forcing its
   `variability` up stretches it to ~40%, where temperature reaches 55%, and it
   would change policy *family* mid-ladder — a tape from the bottom tier would
   then differ in kind, not just in sharpness.
3. **The heuristic-override guard is worth ~0.1pp.** `PPOBot.js` gates it on
   `!sample`, so enabling sampling disables it. That coupling is deliberate and
   should stay: the guard pulls near-tie deviations back to the heuristic move,
   which is precisely the class of deviation that produces the weakening.
   Re-applying it after sampling would partly undo each tier and make the ladder
   non-monotone at low temperature.
4. **The bots degrade gracefully.** Average cards left at round end rises only
   2.33 → 3.19 between argmax and T=6. The median decision has ~4.7 legal
   options across a whole round (~23 at a free lead with a full hand), so
   sampling means "sometimes takes the second- or third-best line" rather than
   flailing. No structural handicap — stripping opponent modelling or
   penalty-tier awareness from the observation — is needed, and none should be
   added: it would put the network off-distribution with unpredictable, possibly
   non-monotone effects, and break the invariant that live play, `Replayer`,
   the harness and `MoveQuality` all see an identical observation.

The reference is a bot, not a human, so the ladder's *ordering* is safe but its
*spacing in human terms* is an estimate. If a median human still wins under 35%
of rounds at `casual`, raise the temperature rather than inventing a mechanism;
T=12 and T=20 are already measured.

## Where the tier lives

`room.botPolicy` — the object `checkBotTurn` dispatches through — and nowhere
else. The game log (`describeSeats().difficulty`), the bots' hidden opponent
rating and the round-stats record all read `this.botPolicy.difficulty`. Seat
payloads deliberately say only that the occupant is a bot; they expose neither
the hidden opponent rating nor the exact Adaptive temperature.

This is the direct fix for the failure documented in
`GAME-STATE-HISTORY-STORE.md`: the previous difficulty attempt kept a decorative
`player.difficulty` on each seat while `checkBotTurn` branched on a room-wide
setting, so a bot replacing a departed human was labelled "advanced" while
running the heuristic. There is no second field here to disagree, so the label
cannot lie.

`Room.setBotDifficulty` remains an internal primitive for tests, benchmarks and
historical replay compatibility: no socket or preference API selects an
arbitrary tier. Production game boundaries call
`Room.configureBotPolicyForRoster`, and the only player-facing control is the
binary `set_max_bots` socket event (host only, waiting only), which chooses
between the roster average and `MAX_BOT_DIFFICULTY`. The per-room policy
snapshot exists so an in-flight game can never change how its bots play.

**Max difficulty suspends placement.** Adaptive calibration is recorded only
while the room is on the `adaptive` policy — see the `difficulty === 'adaptive'`
guards in `RoomManager.recordAdaptiveRoundPlacements` and the game-end handler
in `server/index.js`. A game played against max-difficulty bots therefore
contributes no placement evidence, so players in that room make no progress
toward completing placement and a still-placing player stays Unranked. Hidden
rating still updates as normal. This applies to everyone at the table, not just
the host who set it.
`replaceWithBot` needs no special handling for the same reason: the replacement
seat has no policy of its own and is answered for by the room's.

## What a viewer is shown

`game_history.bot_difficulty` records the frozen tier for the whole game,
written from `room.botPolicy.difficulty` at every `saveGameHistory` call site.
The activity feed, the home screen's Recent list and the score dialog they open
render exactly one thing from it: a gold **⚔️ MAX BOTS** chip
(`tableV2/MaxBotsChip.jsx`), and only on a game that was pinned to
`MAX_BOT_DIFFICULTY` *and* actually contained a bot.

**Adaptive strength is never shown, and that is the whole design.** It is a
continuous hidden temperature derived from the table's private skill
calibration, and the feed is global — a per-game difficulty label would publish
every player's hidden estimate to everyone else, and would let anyone
reverse-engineer their own by watching their feed. Max difficulty is the
opposite kind of setting: opt-in, host-chosen, and worth showing off, which is
why it gets the accent colour rather than the caveat styling that `QUIT` and
`PRIVATE` wear.

Three consequences worth keeping:

- **The client never compares tier ids.** `db.getActivityFeed` derives one
  boolean, `maxBots`, against `MAX_BOT_DIFFICULTY_ID` — db.js's local copy of
  the ceiling, pinned to `BotPolicy.MAX_BOT_DIFFICULTY` by
  `botDifficulty.test.js`. A retune that moves the ceiling moves the badge.
- **The "were there bots" half is answered in the same place.** Max difficulty
  is a *room* setting, so a table that filled with four humans carries it with
  nothing to apply it to.
- **NULL is never backfilled.** Rows written before difficulty tiers existed all
  ran full-strength argmax, so reconstructing them from `round_stats` would badge
  almost the entire archive and make the chip meaningless. Unknown is the honest
  label and simply shows nothing.

Nothing continuous belongs in `game_history`: `getActivityFeed` selects
`page.*`, so every column on that table is shipped to every client. A
`bot_temperature` there would publish the hidden dial by accident.

## Rating

`rating_mu` and `rating_sigma` are now shadow state. They update after every
completed rated game, including Adaptive placement games, but are removed from
stats, leaderboard and room API payloads. Players see only Iron, Bronze, Silver,
Gold, Platinum, Diamond or Champ.

The visible rank is persisted separately. Players remain Unranked until
Adaptive placement is complete, then the shadow score supplies the initial rank
with a hard cap at Platinum. Diamond and Champ must therefore be earned after
placement. Crossing the next rank's hidden threshold starts a three-result
promotion series; three top-half finishes promote. Demotion uses a 75-point
hidden buffer plus three bottom-half finishes. Consequently one result can move
shadow skill without making the public rank flicker, and a visible promotion
represents sustained play around the next level rather than a direct numeric
mapping.

The seven-rank rollout resets unfinished placement players to Unranked and restores
their shadow OpenSkill values and partial Adaptive calibration to neutral
defaults, because their historical games were rated against substantially older
bots. Completed placement players keep their rating and calibration, with their
initial public rank capped at Platinum.

Bots never receive rating updates, but they are rated *opponents*: their hidden
`mu` is what `calculateNewRatings` weighs a human's placement against. Leaving a
weakened bot at `DEFAULT_MU` would pay a human the same for beating it as a
full-strength one.

`RatingSystem.botRatingForDifficulty` supplies the per-tier `mu`, and both bot
creation sites in `RoomManager` use it. Adaptive interpolates a monotone hidden
`mu` from the complete game's frozen temperature. The fixed T=4.5 and T=8
anchors retain their benchmark fits; the rest of the initial curve is
provisional and is versioned for re-fitting from logged temperatures. Sigma
stays at `DEFAULT_SIGMA`.

The values are **fitted, not chosen**. For each tier, `mu` is the value at which
openskill's `predictWin` gives a `DEFAULT_MU` player against three such bots the
win rate the bench actually measured. An unknown tier falls back to `DEFAULT_MU`
— an unrecognised setting must never be a route to cheap rating.

Simulated over 900 rounds per fixed tier, expected `mu` drift for a full-strength
player is more negative on easier tiers (−0.12 competitive, −0.19 balanced,
−0.28 casual per round), so farming casual bots loses rating rather than earning
it. The absolute figures there are an artifact of modelling per-round what is
actually a per-game update; only the ordering is meaningful. The fit is a fit,
not an identity, so the continuous Adaptive curve must be checked against live
outcomes and re-fitted rather than treated as permanent.

## Training data

**Labelled, not dropped.** Games against easier bots are recorded with
`mlog_seat.difficulty` per seat and `mlog_game.weakened_bots` per game (one
weakened seat taints the whole game, since round utility is zero-sum across all
four seats).

| Row type | Still usable? |
|---|---|
| Human **action** labels (behaviour cloning) | **Yes.** Genuine human decisions; only the state distribution shifts, because the board states arose against weaker play. |
| Human **outcome / value** labels | **Biased.** Round utility earned against weak opposition overstates the actions that earned it. Reweight, condition on the tier, or exclude at training time. |
| Weakened **bot** rows | Not for imitating or distilling the promoted policy — but valid league opponents, which the pipeline already has a concept of. |
| Promotion gates, paired benchmarks | **Unaffected.** They run offline against fixed lineups and never read production tapes. |

`export-training-data.js`, `convert-human-export.js` and
`convert-human-ppo-export.js` therefore emit everything by default and offer
`--competitive-only` for the clean subset. Labelling is the irreversible half: a
filter can be applied at any point later, but data exported without provenance
can never be sorted out afterwards. With few players, the default is to keep.

The `vsBots` hand-strength scope splits the same way, into `vsBots` and
`vsCasualBots`, because its whole stated purpose is that farming bots should not
read as general strength.

Not de-contaminated, and stated here rather than left to be discovered: overall
wins, the leaderboard, head-to-head records and the Tier-3 aggregates still
count a casual-bot win as a plain win. `round_stats.bot_difficulty` is the hook
for fixing that later.

## Changing the tiers

1. Edit `BOT_DIFFICULTIES` in `server/game/BotPolicy.js`.
2. Run `npm run bench:difficulty` (raise `--rounds` for a tighter interval).
3. Re-fit the `mu` values in `BOT_RATING_BY_DIFFICULTY` against the new win
   rates and update the table above.
4. `npm test` — `botDifficulty.test.js` pins the knobs, the provenance
   agreement, the rating ordering and per-tier legality.
