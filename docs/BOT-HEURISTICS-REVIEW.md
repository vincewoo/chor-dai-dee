# Bot Heuristics Design Review

A review of `server/game/BotLogic.js` (2,514 lines) focused on the reported symptom:
**bots are very aggressive early and spend high singles far too loosely.**

All measurements below were produced by driving `BotLogic.getBotMove()` directly against
constructed and randomly dealt positions. Numbers are reproducible, not estimates.

> **Status: implemented.** Every finding below has been addressed. See
> [Implementation results](#10-implementation-results) at the end for the measured
> before/after. Reproduce with `npm test` and `npm run bench` in `server/`.

---

## 1. Headline finding

The symptom is real, it is measurable, and it has one dominant cause.

Across 400 random positions per hand size, measuring how often the bot beats a **low single
(rank ≤ 9)** using a **K, A, or 2** when it held a cheaper legal beater:

| Cards in hand | Phase (per `getGamePhase`) | Burns a K/A/2 anyway |
|---|---|---|
| 13 | early | 3% |
| 11 | early | 4% |
| **9** | **mid** | **64%** |
| **7** | **mid** | **55%** |

The cliff is not gradual — it is a step function at exactly 10 → 9 cards, and it is caused by
a single scoring rule.

### Root cause: the anti-hoarding bonus fires on the wrong side of the decision

`selectBestMove()` — BotLogic.js:1513

```js
if (gamePhase === 'mid') {
    // Shed high singles to avoid hoarding
    if (move.type === HAND_TYPES.SINGLE && ['K', 'A'].includes(move.cards[0].rank)) {
        score += 60;
    }
```

Two problems compound here:

1. **The block is not gated on `!lastPlayedHand`.** Anti-hoarding is a *leading* concept —
   "don't sit on high cards forever, use them to take a trick you want." Applied to a
   *response*, it becomes "when someone leads a 7, prefer to answer with your King." That is
   precisely the behaviour being reported. Every other lead-shaping rule in this function
   (Priority A/B/C, opponent-weakness exploits) lives inside the `if (!lastPlayedHand)` branch;
   this one escaped it.

2. **`gamePhase === 'mid'` starts at 9 cards** (`getGamePhase`, BotLogic.js:416) — roughly the
   second or third turn of a round. What a player calls "early game" is mostly the bot's
   "mid game." So the anti-hoard rule is live for almost the entire period the user is
   complaining about, while the protections that *would* restrain the bot
   (`Early Game: Save 2s`, `Early Game: Save Aces`, BotLogic.js:1484-1499) switch **off** at the
   same boundary.

Observed directly — 8 cards, responding to a `7D`:

```
hand: 4S 6C 8H 10C JD KD AH 2C   toBeat: 7D
DECISION: KD  [Mid-Game: Shed High Singles (Anti-Hoard)]
    107  KD    Weak Position:-30 | Expected Value:17 | Anti-Hoard:60
     95  AH    Weak Position:-30 | Expected Value:11 | Anti-Hoard:60
     70  8H    Weak Position:-30 | Expected Value:22
     61  10C   Weak Position:-30 | Expected Value:20
```

The bot holds an `8H` that beats the `7D` for almost nothing, and plays the King. It also rates
the **Ace above the 8 and the 10**.

**Fix:** move the whole `gamePhase === 'mid'` anti-hoard block inside `if (!lastPlayedHand)`,
and make it conditional on the card actually being stranded (not part of a pair, and we hold
surplus control) rather than a flat bonus on rank.

---

## 2. The "prefer the cheapest sufficient card" signal is an order of magnitude too weak

BotLogic.js:1393 — the base term for every move:

```js
score += (100 - move.value);
```

`move.value` is `rankIndex * 4 + suitIndex`, so it spans 0–51. The entire "play low cards before
high cards" preference is therefore worth **51 points across the whole deck** — about 4 points
per rank step. Meanwhile individual heuristics award 60, 80, 100, 150, 200, 300, 500.

This means the base preference is not a preference at all; it is a tiebreaker that any single
heuristic overrides. It is why a +60 anti-hoard bonus is enough to jump a King over an 8 — the
rank gap between them is only worth 20 points.

It is also linearly wrong. In Big 2 the value gap between a 2 and an Ace is enormous, and
between an 8 and a 9 is nearly nothing. A linear rank term models the opposite.

**Fix:** replace the linear term with an explicit convex *retention cost* per card, on the same
scale as the heuristics — e.g. 3–7 ≈ 0-10, 8–10 ≈ 20, J/Q ≈ 45, K ≈ 80, A ≈ 140, 2 ≈ 220,
2♠ ≈ 320 — and subtract the summed cost of the cards being spent. Then delete the ad-hoc
`Save 2s` / `Save Aces` / `Save 2S` / `Break High Pair` penalties scattered through the function,
because a proper cost curve expresses all of them at once and cannot be accidentally bypassed by
a phase check.

---

## 3. The combo-preservation penalty inverts card selection

BotLogic.js:1670 — any move touching a card reserved by `organizeHand()` takes a flat `-150`.

`organizeHand()` greedily reserves five-card hands first, and low cards are far more likely to
be inside a straight than high cards are. The net effect is that **low singles get penalised and
high singles do not**, which pushes the bot toward exactly the cards it should be protecting.

Early game, responding to a `9D`, holding `3S 4S 5S 6S 7S 10C KD 8H 9H JC QS 2D AH`:

```
     64  9H     Cheap Shedding:20
   -109  10C    Breaks Organized Hand:-150
   -113  JC     Breaks Organized Hand:-150
   -119  QS     Breaks Organized Hand:-150
```

Here the outcome is fine (`9H` is loose and cheap), but only by luck. The `10-J-Q-K-A` straight
has swallowed every mid card, so had the bot lacked the `9H` it would have been choosing between
four equally-penalised options with the *cheapest* one no longer favoured — the −150 is identical
whether it breaks the straight with the 10 or the Ace.

**Fix:** make the penalty proportional to what is actually lost. Breaking a straight to spend its
*lowest* card is cheap (the straight often survives via another card, or was speculative anyway);
breaking it to spend the Ace is expensive. Scale by the reserved hand's preservation priority and
by the rank of the card being pulled out, rather than a flat constant. Also cap it below the
retention-cost scale so it can never invert the low-before-high ordering.

---

## 4. Live play and the debug panel make different decisions

BotLogic.js:128 — early exit when only one legal move exists:

```js
if (candidates.length === 1 && !captureReasoning) {
    return candidates[0].cards;
}
```

This returns **before** `shouldStrategicPass()` runs (line 133). When the bot has exactly one
legal response, it always plays it — including its lone 2♠ against a 9, which the Price Rule
exists specifically to prevent.

Worse, the bypass is gated on `!captureReasoning`, so the **BotDebugPanel takes the other path**:

```
Only legal beater is 2S, opponent led 9D:
  live play   (captureReasoning=false): 2S
  debug panel (captureReasoning=true) : PASS  | "Price of trick too high (wasting 2)"
```

The tool built to diagnose bot behaviour is hiding the bug. Any reasoning capture must be a pure
observer — never a control-flow condition.

**Fix:** move the early exit below the strategic-pass check, and make it unconditional on
`captureReasoning` (synthesise the trivial reasoning object instead).

---

## 5. Opponent inference is dead where it is used

`inferFromPasses()` (BotLogic.js:2204) returns immediately if `lastPlayedHand` is null:

```js
if (!lastPlayedHand || passCount === 0) return { opponentsLikelyWeak: false, confidence: 0 };
```

But every consumer of that inference is inside `if (!lastPlayedHand)` — the lead branch
(BotLogic.js:1538-1571: *Opponents Weak in Singles - Exploit*, *Weak in Pairs*, *Save 5-Card*,
and the reduced *Weak Follow-Up* penalty). Those five branches **can never fire.**

```
inferFromPasses(null, 3, ...)          -> { opponentsLikelyWeak: false, confidence: 0 }
inferFromPasses(<7D>, 3, ...)          -> { opponentsWeakInSingles: true, confidence: 0.9, ... }
```

The structural cause: `RoomManager` clears `lastPlayedHand`, `passedPlayers` and `passes` the
moment a trick is won (RoomManager.js:1096-1099). So the single most valuable piece of
information in the game — *who just passed on what* — is destroyed at exactly the moment the
trick winner would use it to choose a lead.

**Fix:** keep a per-round `trickHistory` on the room (who played what, who passed on what) that
survives trick boundaries, and pass it into `gameContext`. This also unlocks section 6.

---

## 6. The entire opponent-modelling layer is unreachable

`createOpponentModel`, `updateOpponentModel`, `estimateOpponentStrength` (BotLogic.js:1904-2041),
plus `plan2MoveSequence` (611) and `analyzeHandComposition` (1224) are **defined once and never
called** — verified by grep across `server/` and `client/`. That is roughly 250 lines of
per-opponent tracking (`unlikelyCards`, `likelyHas2s`, `aggressionScore`, pass/play history)
sitting inert.

This is the biggest missed opportunity for human-like play. Humans do not evaluate a position
from card counts alone; they track *"the player on my left has passed on two singles above a 9,
so their Kings are gone."* The machinery exists. It needs the trick history from section 5 and a
call site in `getBotMove`.

---

## 7. Two paths bypass the heuristic layer entirely

**Multi-step planner** (BotLogic.js:1303). On a free play with 6-10 cards in the `mid` phase, if
`winProbability > 0.7` the bot returns the planner's first move and skips all scoring:

```
free play, 9 cards -> "3-move sequence with 85% win probability"
```

That 85% is not a probability. `winProbability` derives from
`terminalScore / 1000` (BotLogic.js:681) where `evaluateTerminalPosition` routinely returns over
1000 for a 6-card hand, then gets multiplied by 0.9 per ply. It exceeds 0.7 easily, so this path
fires often. When it does, the move is chosen by `evaluateMoveValue` (BotLogic.js:817), which has
**no protection for 2s, Aces, or pairs at all** — it only likes shedding many cheap cards. The
planner also assumes free play at every ply, i.e. it assumes opponents never contest.

**Monte Carlo** (BotLogic.js:1459). Runs 20 simulations for promising candidates at 7-9 cards,
worth up to +150. But `simulateGame` (878) has opponents play a **random legal move from their
own hand while ignoring the pile entirely** — no `canBeat` check anywhere in the loop. The
resulting win rate is noise, injected at a magnitude larger than most real heuristics.

**Fix:** gate the planner on a real bound (e.g. only when it finds a genuine forced sequence —
every ply's move unbeatable given outstanding cards), and either make `simulateGame` legal or
delete the Monte Carlo path. Currently it costs ~3.4ms per decision to add randomness.

---

## 8. Smaller items

- **`nextPlayerLow` is `< 5`** (BotLogic.js:1253) and only inspects the *next* seat. It swings
  scores by up to 350 points (`Freeze: Avoid Low Single` −200, `Freeze: Play High Single` +150).
  Triggering full panic mode because one opponent reached 4 cards, while we ourselves hold 11,
  is too loose — it should scale with our own hand size and with how many tricks they plausibly
  need.
- **Move-independent terms are wasted computation.** `positionAdvantage` and the
  `Weak Follow-Up: Avoid Leading` penalty are added identically to every candidate, so they
  cannot change the ranking — they only inflate the numbers shown in the debug panel. Hoist them
  out (they matter only if a play/pass threshold is ever introduced).
- **`hasStrongFollowUp` is almost always true** (any five-card hand, *or* 2 pairs, *or* 2 control
  cards, *or* ≤3 cards), so the lead-strength gate rarely engages.
- **The hand-organisation cache never hits.** `gameContext._handOrgCache` is written to the
  `gameContext` object, but `RoomManager.checkBotTurn` builds a fresh one every turn
  (RoomManager.js:1132).
- **`getAllValidMoves` prunes flushes and straights to lowest/highest representatives only**
  (BotLogic.js:2340, 2400). Reasonable for speed, but it means the bot cannot construct a
  middle-value flush to beat a specific pile cheaply — it will jump from its lowest to its
  highest.
- **`solveEndgame` claims `guaranteedWin` without verifying control** (BotLogic.js:1041): any
  move leaving two cards that form a pair is labelled a guaranteed win, regardless of whether
  opponents can beat the first move. It also short-circuits on the first candidate satisfying
  that test, and candidate order is hand order — effectively arbitrary.
- **Decisions are fully deterministic and all four bots share one personality.** Identical
  positions always produce identical plays, and three bots at a table reason identically. This
  reads as robotic even when the individual choices are sound.

---

## 9. Recommended direction

The current design is a flat list of ~30 additive bonuses discovered incrementally, each tuned in
isolation. The failure mode is structural: every new rule can silently outweigh every old one,
because nothing establishes a common scale. Sections 1, 2 and 3 are all instances of that.

Suggested restructuring, in order of value:

1. **Establish one currency.** A convex per-card retention cost (section 2), with every heuristic
   expressed as a bonus *relative to* that cost. Delete the redundant save-rules.
2. **Split lead scoring from response scoring** into two functions. Most of the current bugs are
   lead heuristics leaking into responses (section 1) or vice versa. The two decisions share
   almost no logic and should not share a scoring loop.
3. **Add a "price of the trick" model for responses.** The one rule that already does this
   (Price Rule, BotLogic.js:1144) is hard-coded to 2s against 3-9. Generalise it: spend a card
   only if `retentionCost(card) < expectedValue(winning this trick)`, where the trick's value
   rises with our proximity to going out and with opponents' card counts. This alone fixes the
   reported symptom in a principled way.
4. **Wire up the opponent models** (sections 5-6) with a persistent per-round trick history.
5. **Fix or remove the bypass paths** (section 7) — they currently override the heuristics they
   should be refining.
6. **Add per-bot personality and controlled noise.** Give each bot small multipliers on
   aggression / risk / patience, and pick from the top-scoring moves with softmax rather than
   strict argmax. Two bots that play the same position differently feel far more human than one
   that always finds the same answer — and it makes the remaining rough edges read as style
   rather than as bugs.
7. **Recalibrate the phase boundaries** (BotLogic.js:416). 9 cards is not mid-game. Consider
   deriving phase from cards played at the table rather than our own hand size, and cross-fading
   between phases instead of stepping.

Items 1-3 are the ones that address the reported feedback directly; item 4 is where genuinely
human-like play comes from.

---

## 10. Implementation results

All nine findings were implemented. `BotLogic.js` went from 2,514 to ~1,790 lines, with
703 of those lines removed as verified-dead code.

### Measured outcome

One new bot seated against three copies of the old bot, 2,000 rounds, seats rotated so
position cannot bias the result. Four identical bots score ~25% each by construction.

| Configuration | Win rate | Avg points/round |
|---|---|---|
| Old bot (baseline) | 25.0% | 3.15 |
| New bot, strict argmax | **38.8%** | 2.58 |
| New bot, with per-bot profile | **36.9%** | 2.70 |

The reported symptom, measured directly — answering a single of rank ≤ 9 with a K/A/2
while holding a cheaper legal beater:

| Cards in hand | Before | After |
|---|---|---|
| 13 | 3% | 0.3% |
| 11 | 2% | 0.5% |
| 9 | **59%** | **2.3%** |
| 7 | **57%** | **1.8%** |

Decision cost also fell: 0.40 ms for a free play (was 0.9 ms, and 3.4 ms on the Monte
Carlo path), 0.04 ms for a response.

### What changed, by section

1. **Anti-hoarding** — moved inside the free-play branch and re-expressed through the
   phase cost multiplier, so high cards get progressively cheaper to play as the hand
   shrinks rather than jumping in value at a hard boundary.
2. **Scoring currency** — `100 - move.value` replaced by a convex per-card retention
   cost (`RANK_RETENTION_COST`, 0 for a 3 up to 320 for the 2♠), discounted by phase and
   by combination size. This subsumed and replaced the `Save 2s`, `Save Aces`, `Save 2S`,
   `Break Pair of 2s`, `Triple 2s`, `Quad 2s`, and `Full House 2s` rules.
3. **Combo preservation** — flat −150 replaced by `comboBreakPenalty`, scaled by the
   combination's preservation priority and by the rank of the card being pulled out.
4. **Debug/live divergence** — the single-candidate fast path now runs after
   `shouldStrategicPass` and is no longer gated on `captureReasoning`. Locked in by a
   test asserting the two paths agree over 60 random positions.
5. **Pass inference** — replaced with `inferFromHistory`, reading a per-round
   `trickHistory` now maintained by `RoomManager` and surviving trick boundaries. Tracks
   each opponent's lowest declined single as a ceiling, and stops trusting that read once
   an opponent demonstrates they pass strategically.
6. **Opponent modelling** — `buildOpponentModels` replays the round's history into the
   previously unreachable model functions. Feeds `estimateControlProbability`.
7. **Bypass paths** — the fake-probability multi-step planner and the Monte Carlo
   sampler (whose simulated opponents ignored the pile entirely) were deleted rather than
   repaired; neither was estimating what it claimed to.
8. **Smaller items** — `dangerLevel` replaces the `< 5` next-seat check and scales with
   our own hand size; move-independent terms removed; `solveEndgame` now verifies the
   first move is genuinely unbeatable (`isUnbeatable`) before claiming a forced win.
9. **Human-like play** — `getBotProfile` derives stable per-bot variability, patience and
   aggression from the bot's name, and `pickScoredMove` samples from moves within a small
   window of the best instead of always taking the argmax. Bots with no profile stay
   deterministic so tests and the benchmark are reproducible.

The profile costs about 2 percentage points of win rate against the old bot. That is the
intended trade: the goal was bots that feel human, not bots that are maximally strong.

### Verifying

```bash
cd server/
npm test     # 14 regression tests, ~1s
npm run bench  # self-play benchmark + leakage metrics, ~15s
```

`server/test/botHarness.js` is a dependency-free self-play harness that mirrors
`RoomManager`'s trick flow and validates every move for legality. To A/B a future change,
copy `BotLogic.js` aside before editing and seat the old copy against the new one.

### Not done

- Phase boundaries (`getGamePhase`) still key off our own hand size at 9/5 cards. The
  cost multiplier now cross-fades the behaviour that used to step at that boundary, so
  the sharp edge is gone, but deriving phase from cards played at the table would still
  be more accurate.
- `getAllValidMoves` still prunes flushes and straights to lowest/highest representatives,
  so the bot cannot construct a middle-value flush to win a trick cheaply.

## 11. Tried and rejected: own-hand global strength

When `DealStrength.js` was added for the stats, the obvious next question was whether the
bot should read the same signal — know its hand is globally strong or weak and adjust for
the trick. It was measured rather than assumed, and it does not work.

Both formulations were tested, one seat running the variant against three current bots,
seats rotating, 8,000 rounds per configuration:

- **Deal-anchored** — score the 13-card deal once, use it all round.
- **Live** — recompute control-per-card from the current hand every turn, so the signal
  cannot go stale as the bot spends its 2s.

Each fed two levers: scaling `evaluateTrickValue` by strength (strong hand → contest
harder) and adding a shed bonus when weak (round points are cards left, so a hand that
cannot win the race should dump volume instead).

| Bias strength | Win rate vs baseline | Round points |
|---|---|---|
| Weak (0.2–0.6) | within ±1σ, no effect | +0.08 |
| Moderate (1.5) | +0.5pp (0.9σ) | +0.48 |
| Strong (3) | −3.5pp (6.4σ) | +3.31 |
| Very strong (6) | −7.0pp (13.2σ) | +7.02 |

Monotonically worse as the signal gains influence, never better, in both formulations and
on both levers. Inverting the sign did not help either, which rules out a simple direction
error. A control run with the patch installed but zeroed reproduced the baseline, and a
separate check confirmed the patch really does change decisions (2.3% of them at moderate
strength), so the null result is real rather than a no-op.

The reason is redundancy, not staleness — the live variant failed the same way as the
static one. `evaluateTrickValue` already reads `handOrganization.trash` and
`fiveCardHands`, `dangerLevel` reads the table, and `estimateControlProbability` prices
individual cards against what is still out. Those are the same facts deal strength
summarises, except they are situational, and a scalar bias on top mostly just distorts
prices the retention-cost model had already set correctly.

What *did* work was the follow-up in § 12: not "how strong am I" but "am I still in this
round".

## 12. Shipped: penalty-tier awareness in a lost round

The successor to § 11, and the contrast is instructive. Deal strength failed because it
was an absolute property of our own cards, duplicating what the retention model already
knew. This signal is *relative* — it reads opponents' card counts — and it targets a
specific decision the bot was getting wrong.

### The gap

`getGamePhase` keys purely on our own hand size, so a bot holding 11 cards while an
opponent sits on 1 still reads as `early` and pays a full `PHASE_COST_MULTIPLIER` of 1.0.
It hoards its 2s for a round that is already over.

Worse, that hoarding is measuring the wrong thing entirely. **Round points count cards,
not ranks.** A held 2 and a held 3 are both worth exactly one point. Once a round is
unwinnable, retention cost — which prices high cards as expensive to give up — is pricing
an asset that has stopped existing.

And the scoring tiers make it sharper still: 10–12 cards doubles the penalty, 13 triples
it. Going from 10 cards to 9 turns 20 points into 9.

### What was measured

Three levers, gated on `roundLostness`, one seat against three current bots, seats
rotating, 12,000 rounds × 4 seeds:

| Lever | Points/round vs control | Win rate |
|---|---|---|
| Refund retention cost | −0.04 | **−1.3pp** — bad trade |
| Flat shed bonus | −0.02 | −0.1pp |
| **Penalty-tier crossing** | **−0.07** | −0.24pp |

Only the tier lever paid. Refunding retention cost wholesale cost more than a point of
win rate for almost no points gain — the bot needs its control cards even in a losing
round, because taking the lead is how it gets to dump.

The shipped rule reproduces the benchmark: **−0.069 points per round (3.2σ), improving on
all four seeds**, with rounds ending at 10+ cards down 0.35pp — the mechanism the rule
targets, moving in the direction it was designed to move.

### Why it is priced at 1×

The bonus is `pointsSaved × SHED_VALUE_PER_CARD`, which values a penalty point at exactly
what the bot already pays to shed a card. Raising the multiplier keeps gaining, but
barely — 0.065 at 1×, 0.088 at 5× — and it does so by overweighting a rule that is
already correctly priced. Per § 9, a new rule earns its place by being denominated in the
existing currency, not by being handed a magnitude that wins a benchmark.

### Note on the state's frequency

`roundLostness > 0` on 37% of scored decisions and `> 0.5` on 13% — the state is common,
not exotic. The gain is modest not because the situation is rare but because the bot was
already shedding reasonably; the rule sharpens the tail rather than changing the plan.

Reproduce with the scripts described in `docs/HAND-STRENGTH-STATS.md`.

## 13. Tried and rejected: table-aware game phase

§ 12 exposed that `getGamePhase` keys purely on our own hand size, so a bot with 11 cards
facing an opponent on 1 still reads as `early`. That looks like a bug. It was tested as
one, and the naive fix is worse:

| Phase definition | Points/round | Win rate |
|---|---|---|
| unchanged | +0.007 (0.3σ) | −0.42pp |
| `min(own, opponents)` | −0.014 (0.4σ) | **−3.09pp** |
| average across all four | −0.022 (0.7σ) | −0.71pp |
| blend of own and leader | −0.012 (0.4σ) | −1.71pp |

12,000 rounds × 4 seeds. Nothing reaches significance on points, and making phase track
the leader costs three points of win rate: the bot reads "late", discounts its retention
cost, dumps control, and loses rounds it could still have won.

The conclusion is that phase is own-hand-only *by design*, not by oversight. It answers
"how much is my control still worth to me", and our own hand is the right clock for that.
"How close is the round to ending" is a genuinely different question, and it is answered
by `dangerLevel` and `roundLostness` — which is why the § 12 fix was targeted rather than
a re-plumbing of phase.

For the record, the bot is not otherwise blind to the table: `dangerLevel`,
`buildOpponentModels`, `solveEndgame`, `estimateControlProbability` and two explicit
"next player has one card" checks all read `playerCardCounts`.

## 14. Shipped from a playtest report: 2s buried in five-card hands

Reported from play, not from a benchmark: bots spend 2s inside full houses and quads far
more than a human would.

It reproduced immediately. **23.5% of every 2 the bot plays is spent inside a five-card
hand** — 23.3% with per-bot profiles, i.e. the configuration real rooms use.

### Cause

`COST_WEIGHT_BY_SIZE[5] = 0.35` discounts every card in a five-card hand to 35% of its
retention cost, on the stated premise that a card "locked inside" a combination is not
available as standalone control.

That premise is false for a 2, and only for a 2. A 2 can always be pulled out and played
as a single that cannot be beaten — the very fact `TWO_OF_SPADES_PREMIUM` encodes. The
discount priced away an option the bot still held. The arithmetic was stark: a full house
of `2-2-2-3-3` cost `(3 × 215) × 0.35 ≈ 226`, while a single 2 cost `215`. Dumping three
2s cost about the same as spending one.

### What ships

`standaloneControlSurcharge` charges the discount back, for 2s only, and lifts once
`roundLostness` fires — in a lost round points count cards, so dumping the combination is
correct. Extending it to aces and below measured worse: those cards genuinely are more
constrained inside a combination, so the existing discount is closer to right for them.

Effect: **23.5% → 12.0%** of 2s burned in combinations, +0.31pp round win rate, +0.040
round points.

### Why ship a rule that costs round points

Because the points cost does not survive to the level that decides a match. Full games to
50, won by lowest cumulative score:

| Sample | Variant vs its own control |
|---|---|
| 6,000 games | +0.82pp |
| 18,000 games | +0.99pp |

Consistent in direction across two independent runs, and neither conclusive — the control
alone swung from +0.36pp to −0.62pp between them, which is the effect size. Game-level
measurement cannot resolve this without far more compute than it is worth.

So the benchmark is not the argument. The argument is that the code justified a discount
with a claim that is factually wrong for this card, and the error was visible to a player
before it was visible in any metric. Fixing a false premise is worth doing at
benchmark-neutral; the round-win gain and the play-feel improvement come free.

Worth remembering as a limit of the harness: bot-vs-bot round statistics found nothing
here, and a human noticed it in an evening of play.
