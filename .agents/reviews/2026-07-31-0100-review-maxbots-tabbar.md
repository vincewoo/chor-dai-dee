# Review: PR #150 "feat(lobby): optional max-difficulty bots" (stacked on #149 "fix(pwa): absorb the home-indicator inset into the tab bar")

**PRs**: https://github.com/vincewoo/chor-dai-dee/pull/150 (base `julo/pwa-tabbar-inset`) · https://github.com/vincewoo/chor-dai-dee/pull/149 (base `main`)
**Author**: julo15
**Branch**: `julo/max-difficulty-bots` → `main` (full stack: `git diff main...julo/max-difficulty-bots`)
**Commits reviewed**: `6dbe343` (#149), `26b4044` (#150)
**Review round**: 1
**Date reviewed**: 2026-07-31

## Summary

Two stacked changes. #149 makes the mobile PWA tab bar absorb the home-indicator
inset (`max(8px, env(...))`) instead of stacking it on top of the buttons' own
padding. #150 adds an opt-in, host-only, waiting-room-only "Max difficulty bots"
toggle that pins a room to the argmax `competitive` policy instead of the
roster-averaged `adaptive` one.

Verified green: server `npm test` 338/338, client `npm run lint` 0 errors
(12 pre-existing warnings), client `npm run build` ok, and the compiled CSS
emits `.pb-safe-bar{padding-bottom:max(8px,env(safe-area-inset-bottom))}` with
no bare `.pb-safe` remaining.

## How It Works

**#150 — the flag.** `Room` gains a `forceMaxBots` boolean
(`server/game/RoomManager.js:140`, default `false`). The reason it is a separate
flag rather than just leaving `botDifficulty` on `competitive` is sound and
correctly identified in the PR: `configureBotPolicyForRoster()`
(`RoomManager.js:1022`) is called at every game boundary — from
`configureBotsForRoom()` in `server/index.js:47-65` on `start_game`, and from
`Room.startRematch()` at `RoomManager.js:2166` — and it unconditionally wrote
`'adaptive'`. It now reads
`this.botDifficulty = this.forceMaxBots ? MAX_BOT_DIFFICULTY : 'adaptive'`, so
the choice survives.

`MAX_BOT_DIFFICULTY = 'competitive'` (`server/game/BotPolicy.js:75`) is a real
ceiling, not just the lowest temperature: `competitive` is the only tier with
`sample: false` (`BotPolicy.js:46-51`), so it is argmax and cannot play below its
own best judgement. The doc's claim checks out.

`Room.setForceMaxBots(enabled)` (`RoomManager.js:1039`) refuses unless
`gameState === 'waiting'`, sets the flag, re-derives `botDifficulty`, and calls
`refreshBotPolicy()`. `getGameState()` (`RoomManager.js:1926`) now reports
`forceMaxBots`, and the socket handler `set_max_bots`
(`server/index.js:1719-1738`) resolves the room via `findRoomBySocketId`,
checks `player.name === room.hostUsername`, and re-broadcasts `room_update`.
The client renders a pill switch in `WaitingRoomV2.jsx:282-320`, gated on
`isHost && onSetMaxBots`, wired from `GameRoom.jsx:1124` and `Lobby.jsx:361`.

**#149 — the bar.** `.pb-safe` (`padding-bottom: env(safe-area-inset-bottom)`)
is deleted; `.pb-safe-bar` (`padding-bottom: max(8px, env(...))`) replaces it at
`client/src/index.css:93-95`. `HomeScreenV2.jsx:421`'s mobile `<nav>` switches to
it, and each nav button's inline padding goes from `'4px 2px 8px'` to
`'4px 2px 0'` so the two no longer stack.

## Complexity & Risk

**Medium.** 10 files, ~182 insertions. The server half is small, well-guarded,
and easy to revert; the two commits are independent.

The riskiest parts are not in the server logic:

1. The Lobby mount's client wiring — the fix for it exists in the working tree
   but is **not in the pushed commit** (Critical 1).
2. A side effect on persistent per-player state that the PR does not discuss:
   turning the flag on stops adaptive placement calibration for everyone at the
   table (Critical 2).
3. The tab-bar change reduces the nav buttons' tap target below the platform
   minimum on every device (Critical 3).

The `forceMaxBots` state machine itself is clean: no cross-room leakage (rooms
are deleted when empty, `server/index.js:2057`), no bypass path (the only caller
of `setForceMaxBots` is the guarded handler; `setBotDifficulty`'s only
production caller is `index.js:371`, hardcoded to `'adaptive'`), and the
"frozen for a complete game" invariant holds even across the `await` window in
`start_game`, because `configureBotPolicyForRoster()` is the last synchronous
write in `configureBotsForRoom()` and re-reads `forceMaxBots` at that point.

## Findings

### Critical

**1. The `forceMaxBots` propagation fix in `Lobby.jsx` is uncommitted — as
pushed, the toggle is one-way and blind in the Lobby waiting room.**
`client/src/components/Lobby.jsx:67-83`

`handleRoomUpdate` merges an explicit allowlist of fields, not the whole
payload. In the pushed commit (`git show 26b4044:client/src/components/Lobby.jsx`,
lines 69-74) that allowlist is `players`, `hostUsername`, `gameMode` — and
nothing else:

```js
setRoomLobbyData(prev => ({
    ...prev,
    players: state.players || prev.players,
    hostUsername: state.hostUsername || prev.hostUsername,
    gameMode: state.gameMode || prev.gameMode,
}));
```

The initial `setRoomLobbyData` at `Lobby.jsx:51-55` doesn't carry it either (it
is built from `location.state`, and the `lobby_ready` payload at
`server/index.js:2253-2257` only sends `roomId`/`players`/`hostUsername`). So
`roomLobbyData.forceMaxBots` is permanently `undefined` in this mount. The
toggle still renders — `isHost` and `onSetMaxBots` are both truthy — so from the
room-lobby screen (the post-game "back to lobby" path) the host sees:

- the label permanently stuck on "Off — bots match the table", and
  `aria-checked={false}`, regardless of the real server state;
- every click emitting `{ enabled: true }`, because `!forceMaxBots` is always
  `true` — the setting can be turned **on** but never **off** or observed from
  this screen.

The working tree already contains the correct fix (`forceMaxBots:
state.forceMaxBots ?? prev.forceMaxBots`, with a good comment on why `??` and
not `||`), but it is **unstaged and uncommitted** — `git status` shows
`M client/src/components/Lobby.jsx`. Commit it and re-push before merge.

Worth noting for the future: the allowlist merge is the structural cause here.
Any field added to `getGameState()` has to be remembered in a second place, and
there's no test that would catch forgetting.

**2. Enabling max-difficulty bots silently freezes adaptive placement
calibration — for every human at the table, not just the host.**
`server/index.js:1154`, `server/game/RoomManager.js:1089`

The post-game calibration update is gated on
`if (room.botPolicy.difficulty === 'adaptive')` (`server/index.js:1154`), and
`recordAdaptiveRoundPlacements()` returns early on the same condition
(`RoomManager.js:1089`). With `forceMaxBots` on, `botPolicy.difficulty` is
`'competitive'`, so **no round evidence is collected and `bot_calibration` is
never written for that game**.

That is not just an internal detail. `rank_placement_complete` is derived from
`bot_calibration.calibration_complete` (`server/db.js:1263-1300`, consumed by
`server/game/PublicRank.js:67`), and per `docs/BOT-DIFFICULTY.md:188-190`
players remain **Unranked** until Adaptive placement completes. So a player who
plays under this setting makes no progress toward a public rank — indefinitely,
if the setting stays on. Rating (`rating_mu`) still updates normally, because
`botRatingForDifficulty('competitive')` correctly returns `DEFAULT_MU`; it is
specifically placement/rank progression that stalls.

Two things make this worth blocking on rather than filing away:

- It is a **host-set, room-wide** flag. A non-host human at that table has their
  placement progression frozen by someone else's choice, with nothing in the UI
  saying so. The toggle's subtitle says "Always the strongest bots" — it does
  not say "and this game won't count toward your rank".
- Neither the PR description nor `docs/BOT-DIFFICULTY.md` mentions it, so it
  reads as unnoticed rather than accepted.

For the stated target audience (players who have already outgrown Adaptive, and
therefore already completed placement) this is harmless — which may well make
"accept and document" the right answer. But it should be a decision. Options:
gate the toggle on the host having completed placement; surface a line in the
toggle's subtitle when any seated human is still in placement; or simply state
the consequence in the doc and the UI copy.

**3. The tab-bar change drops the nav buttons below the minimum touch target on
every device.** `client/src/components/tableV2/HomeScreenV2.jsx:432`

The button's own hit box is
`paddingTop(4) + icon(19) + gap(3) + label line-height(15) + paddingBottom`.
Tailwind v4's Preflight sets `html { line-height: 1.5 }` and nothing overrides
it for the 10px label, so:

| | button hit box |
|---|---|
| before (`padding: '4px 2px 8px'`) | 4+19+3+15+8 = **49px** |
| after (`padding: '4px 2px 0'`) | 4+19+3+15+0 = **41px** |

41px is under Apple's 44pt HIG minimum, under WCAG 2.5.5, and well under
Android's 48dp guideline.

The nav's `pb-safe-bar` padding does **not** compensate: it is padding on the
`<nav>`, outside every button's box, so the bottom strip of the bar is now dead
to taps. `items-stretch` doesn't rescue it either — all five buttons are the
same height, so there is no taller sibling to stretch to. And because the loss
is in the button's own padding, it is independent of `env(safe-area-inset-bottom)`
and hits **every** device: Android phones, home-button iPhones, mobile-width
desktop, and notched iPhones alike. On a device with no inset the bottom 8px of
the bar is simply unresponsive where it used to be part of the button.

This affects all five destinations (How to play / Leaders / Activity / Stats /
Sign in-out) on the app's primary navigation.

Suggested fix — keep the intent of #149 (don't stack the inset) without giving
up the target:

```js
style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex',
         flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
         gap: 3, padding: '4px 2px 0', /* ... */ }}
```

`min-height` grows the hit box without re-introducing padding below the label,
so the "labels sit directly above the indicator" result the PR measured is
preserved.

### Suggestions

**4. `docs/BOT-DIFFICULTY.md:173-177` now contradicts the change this PR
made.** The "Where the tier lives" section still says:

> `Production game boundaries call Room.configureBotPolicyForRoster`, and no
> socket or preference API exposes the choice.

`set_max_bots` is exactly such a socket API. The PR carefully updated the top of
the doc (including the "never a lobby choice" line) but left this one behind,
and it is precisely the section a maintainer would read to find the API surface.
Suggested: "...and no socket or preference API exposes arbitrary tier selection.
The one exception is the binary max-difficulty override: `set_max_bots`
(host-only, waiting-state-only) toggles `Room.forceMaxBots`, plumbed through to
`WaitingRoomV2.jsx`."

**5. Document the calibration consequence from Critical 2** in the same doc,
adjacent to the "frozen for the complete game" paragraph
(`docs/BOT-DIFFICULTY.md:25-27`) — that paragraph currently says placement
evidence updates after the game, which is no longer unconditionally true.

**6. Move the host check inside `setForceMaxBots`, matching `setPrivacy`.**
`server/game/RoomManager.js:1039` vs `:1117`

`setPrivacy(isPrivate, requesterUsername)` and `kickPlayer` (`:409`) both
re-check `requesterUsername !== this.hostUsername` inside the `Room` method, in
addition to the socket handler's check. `setForceMaxBots` follows the
`setGameMode` precedent instead and trusts the handler entirely. Not exploitable
today — there is exactly one caller and it checks correctly — but it has a
concrete secondary cost: **the entire authorization for this feature is
currently untestable at the level this codebase tests things.** There is no
socket-level test harness anywhere in `server/test/`, so adding
`requesterUsername` is the cheapest route to actually covering the guard.

**7. Test the host guard.** (Rated 8/10 by the coverage pass.) New
authorization logic with zero tests. With suggestion 6 applied this becomes a
plain unit test: "a non-host cannot enable max-difficulty bots". Also worth
covering: `set_max_bots` from a socket in no room.

**8. Prove persistence through the real rematch path, not a direct call.**
`server/test/botDifficulty.test.js:236-259`

The sticky-flag test calls `room.configureBotPolicyForRoster()` directly on a
room that never played a game. The production paths are `Room.startRematch()`
(`RoomManager.js:2133-2169`, which filters bots out of the roster and resets
state *before* the roster call) and `configureBotsForRoom()`
(`server/index.js:47-65`). A regression in either would not be caught. Suggest
extending the existing "adaptive effort is frozen for a complete game" pattern:
enable the flag while waiting, play to `finished`, `startRematch()`, assert the
policy is still `MAX_BOT_DIFFICULTY`.

**9. Extract the duplicated precedence rule.** `server/game/RoomManager.js:1029`
and `:1044` both contain, verbatim:

```js
this.botDifficulty = this.forceMaxBots ? MAX_BOT_DIFFICULTY : 'adaptive';
```

One private helper would give the "forceMaxBots outranks the roster average"
rule a single home. Today a third precedence source would have to be added in
two places, and only one existing test would notice a divergence.

**10. Return-shape drift.** `server/game/RoomManager.js:1046` returns
`{ success: true, forceMaxBots }`; every sibling setter (`setPrivacy`,
`setGameMode`, `setBotDifficulty`, `configureBotPolicyForRoster`) returns bare
`{ success: true }`. The extra field has no consumer — the handler
(`server/index.js:1732`) only reads `.error` and then re-broadcasts
`getGameState()`. Only the new test asserts it. Either conform to
`{ success: true }` or apply the richer shape consistently.

**11. Extract a shared `Switch` component.** `WaitingRoomV2.jsx:297-316`

The new 44×26 pill switch is a third distinct accessible-switch implementation.
`SettingsModal.jsx` already copy-pastes an ON/OFF variant six times (lines 76,
102, 130, 155, 182, 231). Note the two neighbouring rows in *this same panel*
(Room privacy, Voice chat) use `SegButton`, not a switch — so the new control is
also the only switch idiom in the waiting room. A shared
`<Switch checked onChange label />` would clean up all eight sites.

**12. Prop-parity between the two `WaitingRoomV2` mounts** (pre-existing, but
directly adjacent to Critical 1). `Lobby.jsx:357-382` omits `isPrivate`,
`onSetPrivacy`, and `onOpenSettings`, which `GameRoom.jsx:1114-1142` passes — so
the Room-privacy row silently never renders in the Lobby mount and the gear icon
is inert there. Not introduced by this PR, but it is the same failure mode as
Critical 1 and there's no structural guard against the next prop repeating it.

**13. Inaccurate error string.** `server/game/RoomManager.js:1041` returns
"Cannot change bot difficulty during game" for any non-`waiting` state,
including `'finished'` — where the game is over, not in progress. Currently
unreachable from the UI (`GameRoom.jsx:1113` only renders `WaitingRoomV2` when
`gameState === 'waiting'`), so cosmetic. Note that `configureBotPolicyForRoster`
deliberately accepts `'finished'` while this accepts only `'waiting'`; that
asymmetry is correct but undocumented.

**14. `CLAUDE.md`'s socket event list is missing `set_max_bots`** — but that list
already documents only 10 of 27 `socket.on` handlers, so this is consistent with
existing practice rather than a regression. Low priority; flagging mainly
because if that list is ever meant to be trustworthy it needs a separate sweep.

### Nits

- `WaitingRoomV2.jsx:298-309` — the new switch has no `focus-visible` styling.
  `SettingsModal.jsx`'s switches all carry
  `focus-visible:ring-2 focus-visible:ring-green-500`; keyboard users get no
  visible focus on this one.
- `WaitingRoomV2.jsx:301` — `aria-label="Max difficulty bots"` duplicates the
  visible label text. `aria-labelledby` pointing at the existing label div is
  the convention used in `SettingsModal.jsx` and keeps the two in sync.
- `HomeScreenV2.jsx:425-429` — a `//` line comment sits inside the `<button>`
  opening tag, between attributes. It parses and lints fine, but a `{/* */}`
  block above the element is the more conventional placement and is not
  sensitive to what follows on the line.
- `BotPolicy.js:68` / `:75` — `DEFAULT_BOT_DIFFICULTY` and `MAX_BOT_DIFFICULTY`
  are both `'competitive'`. They genuinely mean different things and both are
  well commented individually, but neither comment mentions the other, so a
  reader can't tell whether the coincidence is load-bearing. One cross-reference
  line would settle it.
- `Lobby.jsx:362` — `onSetMaxBots` is an inline arrow while the neighbouring
  handlers in that file are `useCallback`s, and it omits `roomId` where
  `handleGameModeChange` (`Lobby.jsx:137`) includes it. The server ignores
  `roomId` for both (it uses `findRoomBySocketId`), so this is consistency only.

### Questions

- **Is `forceMaxBots` meant to be room-scoped or host-scoped?** It currently
  survives `transferHost()` (`RoomManager.js:2173`) and
  `removePlayerPostGame()` (`:2187`), so a new host inherits the previous host's
  choice. That matches how `isPrivate` and `gameMode` already behave and is
  visible in the UI, so it's defensible — but it is neither tested nor stated.
- **Should a max-difficulty game count toward rating but not placement?** That's
  the current behaviour (see Critical 2) and it may well be the right call —
  just confirming it's intended.
- The PR notes an intermittent `start_game` that leaves the room `waiting` with
  no error emitted, reproducing with the feature off and predating the branch.
  Is that captured anywhere yet? It's worth an issue so it isn't lost with the
  PR.

## Correctness

No logic bugs found in the server-side state machine. Specifically checked and
clean:

- **Room reuse / leakage** — `forceMaxBots` initialises to `false` per `new
  Room()` (`RoomManager.js:140`); rooms are deleted when the last player leaves
  (`server/index.js:2057`) and when only bots remain (`:2079`), so it cannot
  leak to an unrelated set of players. `transitionToLobby()` and
  `startRematch()` deliberately preserve it, matching `isPrivate`/`gameMode`.
- **Bypass** — `setForceMaxBots` has exactly one caller, and it is guarded.
  `setBotDifficulty` is not socket-exposed; its only production caller is
  `server/index.js:371`, hardcoded to `'adaptive'`. `configureBotPolicyForRoster`
  only reads the flag.
- **The `start_game` race** — there is a real window where a `set_max_bots`
  event can land during `await configureBotsForRoom(room)` while `gameState` is
  still `'waiting'`. It self-heals: `configureBotPolicyForRoster()` is the last
  synchronous write in that function and re-derives `botDifficulty` from the
  current `forceMaxBots`, and `room.startGame()` follows with no further awaits.
  The rematch path can't race at all, since `gameState` is `'finished'` there
  and `setForceMaxBots` requires `'waiting'`. See testing gap below — this
  property is load-bearing but unasserted.
- **`DEFAULT_BOT_DIFFICULTY === MAX_BOT_DIFFICULTY`** — a bare `new Room()` does
  start internally at `competitive`, but `server/index.js:365-371` calls
  `setBotDifficulty('adaptive')` synchronously in the same tick before anything
  is emitted, so there is no observable window where the client sees
  `forceMaxBots: false` alongside bots actually playing at max.
- **`GameRoom.jsx`** sets `gameState` wholesale from server payloads
  (`:220/:225/:241`), so `gameState.forceMaxBots` is always fresh there. This is
  what makes Critical 1 specific to the Lobby mount.
- **`isHost`** is derived correctly in both mounts (`GameRoom.jsx:1118`,
  `Lobby.jsx:353`).

## Test Coverage Gaps

`server npm test` → 338/338 pass. `client npm test` → pass. (Note: `CLAUDE.md`
correctly documents both suites; the "no test framework configured" line quoted
in some older context no longer exists in the repo.) There is no jsdom/RTL
harness on the client and no socket-level harness on the server — both
pre-existing.

| Gap | Rating | Regression it would allow |
|---|---|---|
| `set_max_bots` host guard, "not in a room" path, broadcast (`server/index.js:1719-1738`) | 8 | A refactor silently drops the host check; any player forces max bots on a shared table |
| `Lobby.jsx` `room_update` field propagation | 8 | **Already regressed** — this is Critical 1, and no test failed |
| `forceMaxBots` through real `startRematch()` / `configureBotsForRoom()` (`RoomManager.js:2166`, `server/index.js:47`) | 6 | Rematch roster churn clobbers the flag |
| `configureBotPolicyForRoster()` remaining the last write in `configureBotsForRoom()` | 5 | A reorder breaks the self-healing start_game race |
| `forceMaxBots` across `transferHost()` / `removePlayerPostGame()` | 4 | Undocumented behaviour changes without notice |
| `WaitingRoomV2` toggle rendering/wiring in both mounts | 4 | Blocked on absent component-test infra |

The three new tests themselves are good — they assert specific values, and the
`seatedRoom('casual')` assertion in the mid-game test is load-bearing (it proves
the guard short-circuits *before* mutating, catching the check-then-mutate-anyway
bug class). No existing test needed updating: the pre-existing
`configureBotPolicyForRoster()` assertions build fresh rooms where the flag
defaults to `false`.

## Maintainability

Covered in Suggestions 9-13. The server-side changes read well and the comments
are unusually good — the "why a flag, not a tier" rationale is stated at the
field, at the method, and in the doc. The main structural notes are the
duplicated precedence line (9), the return-shape drift (10), the third switch
idiom (11), and the two-mount prop-parity hazard (12) that Critical 1 is an
instance of.

## Documentation

`docs/BOT-DIFFICULTY.md`'s new paragraphs are accurate — verified field name,
`MAX_BOT_DIFFICULTY`, the waiting-only constraint, and the argmax claim against
`BOT_DIFFICULTIES`. Two gaps, both in that same file: the stale "no socket or
preference API exposes the choice" line (Suggestion 4) and the unmentioned
calibration consequence (Suggestion 5). No other doc in `docs/` describes bot
difficulty, `getGameState()`'s shape, or the socket protocol, so nothing else
went stale.

The `.pb-safe-bar` convention is well documented in place — the comment at
`client/src/index.css:84-92` explicitly distinguishes "bars that sit ON the home
indicator" from "content that merely has to clear it", which is exactly what a
future dev needs.

## Security

No vulnerabilities found.

- The host guard in `set_max_bots` is byte-identical in shape to `set_privacy`
  (`server/index.js:1652`) and `set_game_mode` (`:1676`).
  `findRoomBySocketId` (`RoomManager.js:2273`) matches on `p.id === socketId`
  and excludes disconnected players, so a socket can only ever reach its own
  room. Duplicate human names within a room are rejected at join, so the host
  can't be impersonated by name. `hostUsername` is only `null` before any human
  joins, at which point no player-bound socket exists to fire the event.
- **No DoS via toggle spam**: `refreshBotPolicy()` → `createBotPolicy()` →
  `loadPPO()` memoises the model in a module-level cache keyed by path
  (`BotPolicy.js:152-161`), so repeated calls don't re-read from disk.
- **No new information exposure**: `forceMaxBots` is a plain boolean on a
  payload already scoped to room members and spectators.
- Residual, pre-existing: `({ enabled })` is destructured with no guard, so an
  argument-less emit throws — caught only by the process-wide
  `uncaughtException` handler (`server/index.js:3552`), which logs without
  exiting. Identical to `set_privacy` and `set_game_mode` and dozens of others;
  not a regression, but this PR adds one more instance.

## Files Changed

| File | Change |
|---|---|
| `server/game/BotPolicy.js` | `MAX_BOT_DIFFICULTY = 'competitive'` constant + export |
| `server/game/RoomManager.js` | `Room.forceMaxBots` field, `setForceMaxBots()`, precedence in `configureBotPolicyForRoster()`, `forceMaxBots` on `getGameState()` |
| `server/index.js` | Host-guarded `set_max_bots` socket handler |
| `server/test/botDifficulty.test.js` | 3 tests: survives re-calibration, refused mid-game, off by default |
| `client/src/components/tableV2/WaitingRoomV2.jsx` | Host-only pill switch below the existing settings rows |
| `client/src/components/GameRoom.jsx` | Wires `forceMaxBots` / `onSetMaxBots` (correct — reads whole `gameState`) |
| `client/src/components/Lobby.jsx` | Wires the same props — **but the `room_update` merge fix is uncommitted (Critical 1)** |
| `client/src/index.css` | `.pb-safe` removed; `.pb-safe-bar` added with `max(8px, env(...))` |
| `client/src/components/tableV2/HomeScreenV2.jsx` | Mobile nav uses `.pb-safe-bar`; button bottom padding → 0 (**Critical 3**) |
| `docs/BOT-DIFFICULTY.md` | New override bullet + rationale (two remaining gaps, Suggestions 4-5) |
