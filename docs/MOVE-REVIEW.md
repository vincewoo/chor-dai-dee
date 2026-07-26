# Move Review

Post-game coaching: the handful of decisions in a game worth a second look,
with the position, the alternative, and the reason.

Nothing about a review is written at play time. A review is derived from the
game log on request, replayed through the same rules the server plays with, and
cached in memory.

---

## Why it works at all

Three pieces already existed and happened to line up.

**`MoveQuality.evaluateMove`** prices every legal option in a position with
`BotLogic`'s retention-cost model and ranks the move actually played among them.
It has always run on every human decision. It returns the quality band, the
normalized loss, the rank, and the cards the model preferred.

**`Replayer`** reconstructs full game state from the tape in `gamelog.sqlite`,
using the same `Big2Rules` the live server uses. Its snapshots carry `obs`, built
by `BotContext.buildGameContext` — byte-identical to what `RoomManager.buildSeatContext`
feeds the live grader.

**Both databases key on the same id.** `game_history.game_id` and
`mlog_game.game_id` are both `room.gameId`, so "review the game I just finished"
is a lookup rather than a migration.

Together these mean **a decision graded from the tape gets the grade it got
live**. That is not incidental — it is the anti-drift property `Replayer` was
built for, and it is pinned by test.

What was missing was never the grading. It was deciding which of a few hundred
graded decisions to show a person.

---

## The endgame gap (fixed first)

`MoveQuality`'s header used to claim `BotLogic`'s policy shortcuts "are not
carrying anything the score misses". Measured over 400 rounds of self-play,
that was wrong:

| | before | after |
|---|---|---|
| Small-hand decisions graded a mistake | 30% | — |
| Share of a strong player's flagged mistakes at ≤5 cards | 96% | — |
| False blunders per game, strong player | 15.4 | **0.1** |
| Flag rate, deliberately weak player | 53.4/game | 39/game |
| Separation between the two | 3.3x | **583x** |

`BotLogic.selectBestMove` hands off to `solveEndgame` at five cards. The cost
model prices cards; it does not search. Once a hand is small enough to read out,
search is the operative question — so a review shipped on the old behaviour
would have told good players they blundered in nearly every endgame.

Breaking the flagged moves down by which shortcut produced them: **78%** were
`solveEndgame`'s non-guaranteed "power" pick, **13%** the last-card block, **9%**
a genuinely forced win. Those needed different answers.

**Where search proves an answer, defer to it.** A move that cannot be beaten and
leaves a remainder playing out as one hand is a forced win, scored as one.
Enumerated over the *full* candidate set: `solveEndgame` returns the first
forcing move because it only needs one to play, but a grader crediting only that
one flags every other route to the same guaranteed win as a mistake.

**Where the shortcut is only a second opinion, decline to assert an error.**
Small hands with no win on the board, and positions where the next player is on
their last card, report `confident: false`. The score still stands — aggregate
rates are unchanged — but no coaching surface may present those as errors.

A win on the board restores confidence by either route, play-out or force:
"you had a win and did not take it" is the most certain grade available and must
not be suppressed by the rule that hides endgame guesswork.

> **Note on the aggregates.** The forced-win override changes the score on ~1.7%
> of decisions. `card_awareness_stats` is cumulative, so totals now mix two
> yardsticks. The change only ever converts a false non-optimal into an optimal,
> so the direction is a correction, but a player's lifetime best-move rate is not
> strictly comparable across the change.

---

## Highlight kinds

Ranking purely by loss produces a list of unexplained numbers. A player can act
on a named mistake and cannot act on a percentile, so each highlight is a
situation with a reason statable in a sentence.

| Kind | Tone | Tier | Fires when |
|---|---|---|---|
| `missed_win` | bad | proven | An option played the hand out and won; you played something else |
| `missed_forced_win` | bad | proven | An unbeatable move would have won next turn |
| `failed_gamble` | bad | costly | Risky play, beaten, **and** the model disliked it |
| `blunder` | bad | costly | `lossFraction > 0.40` and the loss clears `MATERIAL_LOSS` |
| `found_forced_win` | good | credit | You took a forced win a non-winning play was also available for |
| `won_gamble` | good | credit | Risky play, held the lead, top-ranked |
| `hard_position` | good | credit | Top move among ≥8 widely-spread options |

**Ordering is two-level** — tier, then `absoluteLoss` within a tier. Sorting
purely by loss lets the `1e6` win sentinel win every comparison by arithmetic
rather than importance; sorting purely by kind puts a 46-point failed gamble
above a 500-point blunder.

**One slot is reserved for something that went right** when the list would
otherwise be all errors. The credit kinds exist because reading one is why a
player opens the next review.

### The refusals matter as much as the firings

- Nothing fires where `confident` is false.
- Nothing fires below `MATERIAL_LOSS`, anchored to `SHED_VALUE_PER_CARD` so the
  floor is the cost model's own smallest unit of progress rather than a fitted
  number.
- A gamble that was beaten is only an error if the model disliked the move too.
  Coaching on outcome alone teaches exactly the wrong habit.
- Taking a forced win is credited only when a non-winning play was also legal.
  With two cards left and one the only legal answer, taking the win is not a
  find, and applauding it is flattery.
- A play that emptied the hand is never coached.

---

## Cost

Measured over 20 standard games of self-play (24 rounds/game, ~1150 plies).

**Storage: nothing new.** The tape already costs ~37 KiB/game and is already
written. A review adds zero bytes; the in-memory cache holds ~200 entries.

**Processing: on request, never on the play path.**

```
db read      6.4 ms
replay       3.7 ms
grading     25.1 ms   (0.09 ms per decision)
─────────────────────
total       ~35 ms avg, ~73 ms p95   ·  ~16 KiB on the wire
```

Immutable once the game ends, so the cache never goes stale. The one caveat is
that this is synchronous CPU in the Node event loop — rare enough not to matter,
but not free.

The cross-game examples lookup replays up to `EXAMPLE_GAME_LIMIT` (8) games,
so ~250ms cold. Per-game reviews are cached, so the second topic a player opens
is nearly free.

---

## Surfaces

| Route | Shows |
|---|---|
| `GET /api/review/:gameId?username=` | One finished game's highlights |
| `GET /api/review/examples/:username?topic=&mode=` | Worked examples across recent games |
| `/review/:gameId` | The per-game review page |
| `/training?topic=` | Examples of one kind, across games |

Reached from the Recent-games list on the home screen (the primary path), from
the game-over screen, and from the decision-quality numbers on the stats page —
a rate is only useful if a player can get from it to the moves behind it.

`ReviewMoment` renders a highlight and is shared by both pages, on the same
reasoning as `RoundLogRows`: two surfaces showing the same thing must not be able
to drift apart.

### Refusals

A review is unavailable far more often than it is wrong, and each reason is
phrased as a fact rather than a failure.

| Reason | Status | Meaning |
|---|---|---|
| `no_tape` | 404 | Predates logging, or aged out of retention |
| `game_in_progress` | 409 | Not finished yet |
| `not_a_participant` | 403 | You did not sit in this game |
| `logging_disabled` | 503 | `GAMELOG_ENABLED` is off |
| `unknown_topic` | 400 | Examples lookup only |

**`game_in_progress` is a security guard, not an inconvenience.** A review
replays the deal and therefore knows every hand at the table. Without that
refusal the endpoint is a way to read the table mid-game.

The server closes a game's tape just *after* it emits `game_over`, so arriving
straight from the game-over screen can beat the write. The client retries once
after 1.5s to cover that window.

### Seat attribution

Resolved per round via `occupantAtRound`, reused from the export pipeline rather
than reimplemented, so a review and a training shard cannot disagree about whose
decisions these were. A player who leaves after round 3 is neither credited nor
blamed for what the bot that took their seat did afterwards.

---

## The honest caveat

A chess engine's evaluation is near ground truth. `BotLogic` is a tuned
heuristic that `docs/BOT-HEURISTICS-REVIEW.md` documents getting beaten, and
Big 2 is a game of imperfect information — some genuinely correct plays will
grade badly.

So "mistake" means *differs from the cost model*, not *objectively wrong*. Both
pages say this once, at the bottom, rather than hedging on every card.

Note also that the strong-player false-blunder rate of 0.1/game is partly
tautological: outside the shortcuts, profile-free `BotLogic` **is** the
cost-model argmax, so agreement is expected. It demonstrates the grader is now
self-consistent. It does not validate the yardstick against human play — only
real games can do that.
