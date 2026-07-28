# Bot difficulty

Three tiers, chosen by the host in the waiting room, applying to every bot seat
at that table.

## The dial

The live bots run the promoted generation-14 PPO actor. Before this feature they
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
| `competitive` (default) | `sample: false, overrideMargin: 0.02` | 25.0 (`DEFAULT_MU`) |
| `balanced` | `sample: true, temperature: 4.5` | 19.83 |
| `casual` | `sample: true, temperature: 8` | 12.85 |

`competitive` is byte-identical to the pre-difficulty bot. It is the default, so
a player who never opens the setting sees no change at all, and the great
majority of recorded games stay on-distribution for the checkpoint the training
pipeline is fitting.

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
else. The seat payload (`getGameState().players[].botDifficulty`), the game log
(`describeSeats().difficulty`), the bots' seated rating and the round-stats
record all read `this.botPolicy.difficulty`.

This is the direct fix for the failure documented in
`GAME-STATE-HISTORY-STORE.md`: the previous difficulty attempt kept a decorative
`player.difficulty` on each seat while `checkBotTurn` branched on a room-wide
setting, so a bot replacing a departed human was labelled "advanced" while
running the heuristic. There is no second field here to disagree, so the label
cannot lie.

`Room.setBotDifficulty` validates the id and rebuilds the policy, and is refused
outside the `waiting` state — the per-room policy snapshot exists so an
in-flight game can never change how its bots play, and a mid-game rebuild would
make the tape describe a bot that never played the earlier rounds.
`replaceWithBot` needs no special handling for the same reason: the replacement
seat has no policy of its own and is answered for by the room's.

## Rating

Bots never receive rating updates, but they are rated *opponents*: their `mu` is
what `calculateNewRatings` weighs a human's placement against. Leaving a weakened
bot at `DEFAULT_MU` would pay a human the same for beating a casual table as a
full-strength one.

`RatingSystem.botRatingForDifficulty` supplies the per-tier `mu`, and both bot
creation sites in `RoomManager` use it. Nothing else changed — the values flow
through `playersWithStats` untouched, so the scoring math is the same. Sigma
stays at `DEFAULT_SIGMA`: it expresses uncertainty about an opponent, which a
difficulty tier says nothing about.

The values are **fitted, not chosen**. For each tier, `mu` is the value at which
openskill's `predictWin` gives a `DEFAULT_MU` player against three such bots the
win rate the bench actually measured. An unknown tier falls back to `DEFAULT_MU`
— an unrecognised setting must never be a route to cheap rating.

Simulated over 900 rounds per tier, expected `mu` drift for a full-strength
player is more negative on easier tiers (−0.12 competitive, −0.19 balanced,
−0.28 casual per round), so farming casual bots loses rating rather than earning
it. The absolute figures there are an artifact of modelling per-round what is
actually a per-game update; only the ordering is meaningful. The fit is a fit,
not an identity — if it proves unstable, the fallback is to skip rating for
weakened rooms entirely.

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
