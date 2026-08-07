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
- **Max difficulty bots wear no persona.** A room with the waiting room's Max
  Bots toggle on deals `classic` to every bot seat, so there is nothing to read
  and nothing to exploit — see [Max Bots](#max-bots) below.

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
rollback path; production room bots use the four personas above, except at the
ceiling.

## Max Bots

`Room.personasEnabled()` is false while `Room.forceMaxBots` is on, so a Max Bots
room deals `classic` to every bot seat — the roster at `startGame`, and any
mid-game `replaceWithBot` replacement.

A persona is not free, and this is where that matters. `competitive` is argmax,
so the promoted actor's logits are taken at face value; but the style adjustment
is applied *before* the argmax, so a persona seat is by construction willing to
play a move the model did not rate highest. That is the whole point of a persona
at every other tier — it is what makes a bot readable and rememberable — and it
is exactly the wrong trade for a control whose contract is "the strongest
opponent the server has". Max Bots therefore gets the promoted generation-18
actor taking its own top-scored move, every time.

Measured with one full-strength `classic` argmax reference seat against three
argmax bots on paired deal streams (`npm run bench:maxbots`, 96k rounds per
lineup), a persona table gives that reference **25.32%** of rounds versus
**24.89%** for a classic table — a paired delta of
**+0.43pp ± 0.09pp (4.6 sigma)**. Small in absolute terms, but unambiguous and
in the direction the design predicts. The pairing matters: the between-matchup
spread from the deals alone is several times the effect, so an unpaired
comparison at this size reads as noise (1.4 sigma at 8 matchups).

Two consequences. The flag is `forceMaxBots` rather than
`botPolicy.difficulty === MAX_BOT_DIFFICULTY`, because `MAX_BOT_DIFFICULTY` and
`DEFAULT_BOT_DIFFICULTY` are the same string and testing the tier would strip
personas from every bare `new Room()` — benchmarks, tests, every internal caller
that never opted in. And `mlog_seat.bot_style` records `classic` for these
seats, so the log keeps describing the policy that actually played rather than
one the room would have dealt.

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
