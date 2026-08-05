# Hidden Bot Personas

Production PPO bots receive secret playstyle personas. The goal is not another
difficulty ladder: it is an opponent a player can read, remember, and exploit
over a multi-round game and its immediate rematches.

## Player contract

- A persona changes preferences among server-legal moves; it never changes the
  rules or allows the actor to invent an action.
- Every bot samples independently after the roster is known. Multiple bots may
  share a persona; the table does not force artificial variety.
- The assignment is frozen for every round of a game.
- An immediate rematch keeps each named bot's persona. Returning to the lobby
  starts a new matchup and deals fresh personas.
- Bot names, room state, game state, and debug reasoning do not reveal the
  assignment. Players learn it only from play.

## Personas

| Persona | Preference |
|---|---|
| Sprinter | Shed more cards and avoid passing with a playable response |
| Keeper | Preserve aces and twos until the next player is near going out |
| Pressure | Spend strong cards freely to take and retain control |
| Builder | Leave useful pairs, triples, and five-card shapes behind |

### Endgame urgency

Every persona damps its signature preference as the **next player** approaches
going out, through `BotStyle.nextPlayerUrgency`. Keeper releases its controls,
Pressure leans harder into strength, Sprinter stops valuing width over strength,
and Builder stops hoarding shapes it will not live to play.

The seat matters and is not interchangeable with "an opponent". Turn order is us
-> next -> across -> previous, so only the next player can be handed the lead by
our move. Keeper and Pressure originally read `opponent_at_one` /
`opponent_at_two`, which `RLValueBot.encodeCandidate` computes as a min over all
three opponents; they consequently went urgent for a seat they could not affect
and stayed relaxed for the one they could. That is the same widening the
heuristic measured at -4.77pp before rejecting it
(`docs/BOT-HEURISTICS-REVIEW.md` sections 15 and 18). Sprinter and Builder had no
endgame term at all.

`nextPlayerUrgency` is derived from the existing `next_cards` feature rather than
from a new one, deliberately: `RLValueModel.load` asserts an artifact's
`featureNames` match `FEATURE_NAMES` exactly, so adding a feature would
invalidate the promoted checkpoint and turn a bug fix into a retrain.

The unmodified generation-18 actor remains `classic`. It is the compatibility
default for benchmarks, training collectors, the coach, and the heuristic
rollback path; production room bots use the four personas above.

## Implementation boundary

`BotStyle.js` adds a bounded adjustment to the promoted actor's logit for each
legal candidate. The adjustment is clamped to `[-2.5, 2.5]`. Difficulty still
controls sampling and temperature, while persona changes relative move
preferences. The actor checkpoint and critic are untouched.

Assignments live only on server-side bot seat objects. `mlog_seat.bot_style`
records the effective persona privately, and exports carry `bot_style`, so an
offline analysis can measure recognition, adaptation across rounds, and whether
players improve against the same persona in a rematch. Rows predating personas
have `NULL`, which means classic behavior.

## Calibration

Run the same deterministic deal stream for every persona:

```bash
cd server
npm run bench:styles -- 12000 91827
```

The report includes win rate and penalty alongside pass rate, cards per play,
action strength, control spending, and remaining hand structure. A persona is
not ready merely because its name describes its weights: its measured signature
must be distinct, its moves must remain legal, and it must not collapse the
adaptive difficulty calibration.
