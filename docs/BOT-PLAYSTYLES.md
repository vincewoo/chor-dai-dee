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
| Keeper | Preserve aces and twos until an opponent is near going out |
| Pressure | Spend strong cards freely to take and retain control |
| Builder | Leave useful pairs, triples, and five-card shapes behind |

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
