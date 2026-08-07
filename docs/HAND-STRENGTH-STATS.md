# Deal Strength vs. Outcome

A statistic that answers: *given the cards you were dealt, did you do better or
worse than you should have?*

**Status: implemented.** `server/game/DealStrength.js` holds the metric and the
baseline, `GET /api/stats/:username/hand-strength` serves it, and the Stats page
renders it as a Tier 3 card. Regenerate every constant with
`node server/test/dealStrength.bench.js`.

Every number in this document was measured, not guessed. The measurement
scripts are described in [Reproducing the numbers](#reproducing-the-numbers).

## The idea

Win rate conflates two things: how good you are, and how good your cards were.
A player who wins 30% of rounds while being dealt monsters is not the same
player as one who wins 25% off scraps. If we score the *deal* before a card is
played, we can subtract the luck out and leave the skill.

This is the same move as expected goals in football or all-in EV in poker:
build a baseline from the starting position, then measure the gap between the
baseline and what actually happened.

Two headline numbers fall out:

- **Deal Luck** — the average strength of the hands you have been dealt.
  Pure variance. Should trend to average over time; short-term it is the
  answer to "I keep getting garbage."
- **Edge** — your actual results minus the results expected from those deals.
  Deal-luck-neutral. This is the skill number, and it is the point of the
  whole feature.

## Where a player sees this

Two places, and they show deliberately different things.

**Career stats** (`/api/stats/:username/hand-strength`) show **Edge**, because
only there is the sample big enough — `MIN_ROUNDS_FOR_EDGE` is 50, and the
residual SD of 0.415 means ±10pp needs ~67 rounds.

**The game-over screen** shows **deal luck only, never Edge.** A game is six to
ten rounds, so an Edge figure there would be noise presented as a verdict.

Each standings row reads `Deal strength: 1st (61st percentile)` — the player's
rank by deal quality across the whole game, and the mean percentile behind it.
It replaces the finishing place, which the number in the left gutter already
gives. A "Round by round" drill-in opens a rounds × players grid
(`tableV2/RoundReviewPanel.jsx`). That grid is **primarily a scoreboard**: each
cell shows the points that round cost, with the deal's percentile underneath as
the context that says whether a bad round was bad luck or bad play — a 39 under
a 12 is a different story from a 39 under an 88. The round winner's cell is
accent-tinted, and a Total column closes it out.

Colour bands the percentile — 67+ accent, 34–66 neutral, under 34 red — not the
points (already legible as a number) and not the rank at the table: rank is
relative, so in a round where all four hands were scraps somebody still places
first, and colouring that gold would call a bad hand good. Where a player placed
stays in the cell tooltip.

Points are filled in by `updateScores` at round end, matched on the round number
rather than by position. A round that was dealt but never scored keeps
`points: null` and renders as a dash — zero is the winner's score, so it cannot
double as "unknown".

### Why the headline is a percentile and not a tier label

The first version averaged the *tier index* and printed the bucket. Measured
over 16,000 simulated 12-round player-games:

| Aggregate | p5 | p50 | p95 | spread |
|---|---|---|---|---|
| mean tier index | 1.17 | 1.83 | 2.50 | 1.33 |
| mean raw | −1.75 | 0.17 | 2.08 | 3.83 |
| **mean percentile** | 35.7 | 49.8 | 63.6 | 27.9 |

Rounding the mean tier to a bucket prints **"Average" 77.3% of the time**, and
"Rough" and "Premium" are unreachable — a whole line of UI carrying no
information, which is exactly how it looked on screen with all four players
reading the same label.

Mean **raw** separates players but is uninterpretable ("your deals averaged
0.17"). Mean **percentile** separates them *and* reads on its own. It still
compresses — p5–p95 is only 36–64 — but that is the truth about twelve random
deals rather than a defect: luck genuinely averages out. 36 against 64 is a
difference a player can see; "Average" against "Average" is not.

Tiers remain correct for a *single* deal, which is what they were built for, and
survive per-round in the grid's tooltip. Rank is never averaged.

Reproduce the table by sampling `calculateDealStrength` over dealt hands; the
percentile itself comes from `percentileFor`, fitted on 200k random deals.

`Room.dealHistoryByName` accumulates this across a game, keyed by name for the
same reason `roundsWonByName` is: `roundPlayStats` is keyed by socket id and has
to be hand-copied between ids on every reconnect and bot swap. It resets on
`roundNumber === 0`, the room's only "new game" signal.

**The rank must never reach a client mid-round.** It compares all four dealt
hands, so it is a live read on opponents' holdings. `Room.describeRoundReview()`
has exactly one caller — the game-over handler — and is deliberately absent from
`getGameState()` and from `round_over`. `dealStrength.test.js` pins that
boundary by serializing room state and asserting the fields are absent.

## Part 1: scoring a dealt hand

### Why not reuse `calculateHandStrength`

`DecisionAnalyzer.calculateHandStrength` already exists, but it is built for a
different job — scoring a *partial* hand mid-round to judge one decision. It
subtracts a penalty proportional to hand size, so it is entangled with how far
into the round you are, which is exactly the wrong property for scoring a deal.
Its output is also bunched: over 20k random 13-card deals it runs p10=19.8,
p50=33.4, p90=50.5 on a nominal 0–100 scale, so "your hand scored 33" reads as
terrible when it is in fact dead average.

It should keep doing its current job. Deal strength wants a separate function.

### What actually predicts winning

Two properties of a 13-card hand, and they pull in different directions:

1. **Control** — cards that win a trick outright. 2s, then aces, then kings.
   Control is what lets you take the lead back and dictate the shape of the round.
2. **Plays needed** — the minimum number of turns to shed all 13 cards, once
   you partition them into legal combinations. A hand that sheds in 6 plays
   needs to win 6 tricks; a hand that needs 10 has to win 10.

Measured separately against 4,000 rounds of bot self-play (16,000 player-rounds),
correlation with winning the round:

| Metric | Correlation with round win |
|---|---|
| `calculateHandStrength` on the deal | 0.237 |
| Control only | 0.242 |
| Plays needed only | 0.116 |
| **Control and plays needed combined** | **0.282** |

Neither component alone gets there. A hand full of 2s that takes 10 plays to
shed loses to a hand of three tidy combinations.

### The formula

```
control      = 2·(number of 2s) + 1·(aces) + 0.5·(kings) + 0.5·(holds 2♠)
playsNeeded  = minimum plays to shed all 13 cards
                (greedy partition: 5-card hands first, then rank groups)

dealStrengthRaw = 2·control − playsNeeded
```

The 2:1 weighting of control against plays is a plateau, not a knife edge — a
sweep of control weights 1–3 against play weights 0.5–2 moves correlation only
between 0.235 and 0.284. That is worth stating plainly: the metric is robust to
its own constants, so nobody needs to defend the exact numbers, and it is not
overfitted to the bots it was tuned on.

`playsNeeded` uses a greedy partition rather than an exact minimum. Exact
partitioning is a search, greedy is a single pass, and the difference did not
show up in correlation. Not worth the cost.

Raw scores run from −9 to +19 over 200k random deals, mean 0.16.

### Tiers, not percentiles

Raw score is integer-valued and coarse, so percentile deciles come out lumpy —
bucket sizes ranged from 3,290 to 7,329 in a 48,000-row sample, because ties
cannot be split. Fixed named tiers are honest about that and easier to read:

| Tier | Raw score | Share of deals | P(win round) | Avg round points |
|---|---|---|---|---|
| Rough | ≤ −4 | 18.5% | 9.6% | 4.83 |
| Below average | −3 … −1 | 28.9% | 17.2% | 3.53 |
| Average | 0 … 1 | 18.0% | 24.6% | 2.85 |
| Strong | 2 … 4 | 20.7% | 34.0% | 2.22 |
| Premium | ≥ 5 | 14.0% | 48.4% | 1.50 |

A five-fold spread in win rate from the deal alone, monotone across every tier.
The metric is measuring something real.

Keep a percentile alongside the tier for display ("stronger than 78% of deals") —
it is friendlier than a raw score — but bucket on tiers.

### The second axis: rank at the table

Absolute strength is not the whole story, because you play against three
specific hands, not against the deck. The server sees all four, so ranking them
costs nothing and needs no calibration table at all:

| Rank at table | P(win round) | Avg round points |
|---|---|---|
| 1st (best deal) | 42.9% | 1.71 |
| 2nd | 27.0% | 2.76 |
| 3rd | 18.5% | 3.44 |
| 4th (worst deal) | 11.6% | 4.45 |

This is where the user-facing highlight lives. **11.6% of rounds are won by the
player holding the weakest hand at the table** — call those *steals*, and their
mirror image (finishing 3rd or 4th holding the best deal) *squanders*. Those two
counters are the most legible form of the whole feature, and they need no
statistical literacy to appreciate.

> **Security note.** `dealRank` is derived from all four hands. It must never
> reach a client mid-round — it leaks information about opponents' holdings.
> Compute it at deal time, keep it server-side, persist it at round end, and
> expose it only through the stats API after the fact. This is the one part of
> this design that can actually break the game if implemented carelessly.

## Part 2: the outcome side

For each recorded round we now have a deal tier and an actual result. The
baseline table above gives the expectation. Three derived stats:

**Win Rate Above Expected (WRAE)** — the headline Edge number.
```
WRAE = (your wins − Σ P(win | tier of each deal)) / rounds
```
Positive means you win more than your cards deserve.

**Points Saved per round** — the same idea against round points, which has more
resolution because it is graded rather than binary.
```
PointsSaved = Σ (expected points for tier − actual round points) / rounds
```

**Tier breakdown** — your win rate in each of the five tiers against the
baseline. This is the chart, and it is where the user's actual question gets
answered: whether someone overperforms with junk and coasts with monsters, or
the reverse.

### How many rounds before this means anything

Residual SD per round, after removing the deal expectation, is 0.415 for the win
indicator and 4.25 for round points. That gives:

| Statistic | 95% CI of ±10pp / ±0.5pt | ±5pp / ±0.3pt | ±3pp / ±0.2pt |
|---|---|---|---|
| Win Rate Above Expected | 67 rounds | 265 rounds | 735 rounds |
| Points Saved per round | 278 rounds | 771 rounds | 1,735 rounds |

Single-round variance in this game is enormous, and pretending otherwise would
make the feature actively misleading — a player 20 rounds in would read noise as
a verdict on their skill. So:

- Below **50 rounds**: show Deal Luck and the steal/squander counters only.
  Both are descriptive, neither claims to measure skill.
- **50–250 rounds**: show Edge with a visible confidence interval.
- Above **250 rounds**: show it as a headline number.

The tier chart needs ~20 rounds per tier to be worth drawing. Since Average is
only 18% of deals, that means ~150 rounds before the full chart fills in; grey
out tiers that are still thin rather than drawing a bar off 3 samples.

## Part 3: where the baseline comes from

Two options, and the answer is both, in order.

**Ship with the simulated baseline.** The table above, as constants. Available
on day one, no cold start, identical for every player, and reproducible from a
committed script. Its bias is known and worth stating: it is derived from bots
playing bots, so it reflects how much a good deal is worth *under competent
play*. Human tables will differ somewhat.

**Recalibrate from real rounds later.** Once `round_stats` holds enough human
rounds, recompute P(win | tier) from the population and swap the constants.
Version the baseline (`baseline_version` on the row) so old rows stay
interpretable and a recalibration does not silently rewrite history.

This is why the schema below stores **`deal_strength_raw`, not just the tier**.
Raw score plus the tier cutoffs regenerates everything downstream; storing only
a derived bucket would make every future recalibration a backfill you cannot
perform. Cheap now, expensive to retrofit.

(For games recorded with `GAMELOG_ENABLED=1` the deal itself is already in
`mlog_round`, so those rounds could be recomputed from scratch. But the gamelog
is opt-in and lives in a separate database, so the stats path cannot depend on
it.)

## Part 4: implementation sketch

Six touch points, in dependency order.

**1. `server/game/DecisionAnalyzer.js`** — add `calculateDealStrength(hand)`
returning `{ raw, tier, percentile }`, plus the `DEAL_STRENGTH_BASELINE` table
and its `baselineVersion`. Leave `calculateHandStrength` untouched; the two
serve different purposes and merging them would break bot decision scoring.

**2. `server/game/RoomManager.js`, `startRound()`** — after dealing and sorting,
compute all four scores, rank them, and stash on the room:

```js
this.roundDealStrength = { [playerId]: { raw, tier, percentile, rank } };
```

Do this **before the dragon check returns early** (RoomManager.js:711). A dragon
is by definition the strongest possible deal, and losing those rows would bias
the top tier — the same reasoning the tape code already applies at that spot.

**3. `server/index.js`, round end** — three more fields on the `roundData`
object built around index.js:834.

**4. `server/db.js`** — four columns on `round_stats` (`deal_strength_raw REAL`,
`deal_tier INTEGER`, `deal_rank INTEGER`, `baseline_version INTEGER`), added via
the existing `PRAGMA table_info` / `ALTER TABLE` migration pattern at db.js:381.
Existing rows keep NULL and must be excluded from aggregates rather than treated
as zero. Add `getDealStrengthStats(userId, mode)` to aggregate by tier.

**5. `GET /api/stats/:username/hand-strength?mode=`** — tier breakdown, WRAE
with CI, points saved, steals, squanders, round count.

**6. `client/src/components/Stats.jsx`** — a Tier 3 card alongside
`CardAwarenessCard` / `VarianceCard`, following their existing shape.

### Caveats worth encoding rather than hiding

- **Bot tables.** A round against three bots is not a round against three
  humans. Rounds store `human_opponents`, and the API returns three scopes —
  `all`, `vsBots`, `vsHumans` — which the card exposes as tabs. Bot rounds are
  the bulk of play, so they are reported rather than discarded, but kept
  separable so farming bots does not read as general strength. Note also that
  the shipped baseline is *derived* from bot self-play, so it is at its most
  accurate exactly where most rounds happen.
- **Turn order.** The 3♦ holder leads round 1 and the previous winner leads
  after, which is worth a small amount of win rate that deal strength does not
  capture. It will average out across many rounds; it will not average out in
  a 20-round sample.
- **Deal strength ignores fit.** Two identical scores play differently against
  different opponents. The metric is a summary, not a simulation — correlation
  0.28 is real signal, and it is also very far from determinism. The UI copy
  should say "expected" and never "should have."

## Reproducing the numbers

All figures come from `server/test/botHarness.js` self-play, the same harness
`npm run bench` uses, with the real `BotLogic` in all four seats:

- Metric correlations and quintiles: 4,000 rounds, seed 99.
- Tier baselines and rank table: 12,000 rounds (48,000 player-rounds), seed 7777.
- Deal distribution and tier shares: 200,000 random deals, seed 1.
- Residual SD and sample-size table: same 12,000-round sample.

These live in `server/test/dealStrength.bench.js`, which prints the percentile
table and the tier baseline in paste-ready form. Rerun it and bump
`BASELINE_VERSION` whenever the bots, the rules, or the formula change — the
baseline describes what a competent player gets from a deal, so it drifts as
the definition of "competent" does.

## Should the bot use this too?

Not this metric — measured, and it makes the bot worse. An own-hand strength
signal was tested in both static (deal-anchored) and live (recomputed each turn)
forms, against two levers, and degraded play monotonically as it gained
influence. The existing retention-cost heuristics already read hand quality
situationally, so a scalar bias on top only distorts them.

A *relative* signal did work, and shipped: `roundLostness` reads opponents' card
counts to detect a round that cannot be won, at which point the bot values
ducking under the 10-card (2×) and 13-card (3×) penalty tiers. Worth −0.069
round points per round at 3.2σ. The difference is that deal strength duplicated
what the bot already knew about its own cards, while this reads the table.

Both results, with numbers, are in `docs/BOT-HEURISTICS-REVIEW.md` §§ 11–12.
