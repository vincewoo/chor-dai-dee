# Review: #148 - fix(mobile): round-log order cues, PWA safe-area color, denser table, pile label placement

**PR**: https://github.com/vincewoo/chor-dai-dee/pull/148
**Author**: julo15
**Branch**: julo/round-log-order → main
**Date reviewed**: 2026-07-30
**Head reviewed**: `5ae6ce4` (local; the pushed PR head is `8536fe2` — the third commit, "fix(mobile): tappable leaderboard podium; keep toasts off the login form", is **not yet pushed**. It is included in this review per the requested scope.)

## Summary

Six independent mobile/PWA polish fixes found by playing the merged #147 build as an installed PWA on iPhone: round-log ordering cues, PWA safe-area/theme color, a denser mobile table, a pinned pile label, a winner-row styling swap, and a game-review fix that adds the reviewed player's own hand and rotates opponent hands to the reviewed seat. Eleven client files, one server file, one new server test.

## How It Works

The PR is six unrelated changes sharing a discovery context, not one mechanism. Traced individually:

1. **Round-log order cues.** `RoundLogRows` already reversed the log for display (`[...log].reverse()`); it now also computes `moveNo = total - i` per row, so the bottom row is `#1` and the top row is `#N`, and both containers state the direction — `RoundLogPanel`'s desktop rail appends `· newest first` to its count, `RoundLogSheet` adds a second baseline-aligned label beside its title. The arithmetic is correct given the invariant that `log` arrives chronologically ascending (it does — see Correctness for the caveat on what `log` actually contains).

2. **PWA safe-area color.** In a standalone PWA the status-bar and home-indicator bands sit outside the inset-aware app shell (`.h-screen-safe` + `mt-safe`) and paint the `body` background, which was unset (white). `client/src/index.css` now sets `body { background-color: #0c3a23 }`, and `client/index.html`'s `theme-color` plus the `vite-plugin-pwa` manifest in `client/vite.config.js` are moved to the same value. `#0c3a23` is genuinely the last stop of `FELT_BASE` (`client/src/theme/tableTheme.js:11`) — verified, the comments are accurate. The literals are copies by convention: `FELT_BASE` is a browser-only ES module string that neither the static HTML nor the Node-side vite config can import.

3. **Denser table.** `MOBILE_LAYOUT`/`MOBILE_COMPACT_LAYOUT` seat offsets move up (96/178 → 72/142 mainline; 62/128 → 58/114 compact) and the reclaimed space goes to the pile well (`top` 268 → 236 / 200 → 194; `maxHeight` 216 → 248 / 232). The frame stays top-and-bottom anchored, so the #147 structural guarantee (the well shrinks rather than sliding under the controls) is preserved. Tier selection is unchanged: `useIsShortViewport()` = `(max-height: 760px)`.

4. **Pinned pile label.** In `CenterPile` the label chip moves from `position: relative` inside the well's flex column to `position: absolute; top: 10`, and the card-stack div gains `marginTop: round(26 * scale)` to reserve the vacated band. The label keeps `zIndex: 8` (above the cards' max `zIndex` of 5) and gains `maxWidth: calc(100% - 24px)` + ellipsis clamping.

5. **Winner-row styling.** `RoundCelebration`'s rank-1 row swaps a `linear-gradient` fill + `0 0 22px` blurred glow for a solid `rgba(255,255,255,.07)` fill + a `0 0 0 3px` ring, on the theory that iOS Safari paints the gradient/blur combination square at the rounded corners.

6. **Game review.** Server-side, `reviewRound`'s `opponentHands` moves from `snap.hands.map((h, s) => s === seat ? null : h.map(wireCard))` (absolute-seat-indexed) to a new exported `relativeOpponentHands(hands, seat)` that returns `null` at index 0 and `hands[(seat + offset) % 4]` thereafter — matching the client's long-standing index→`['You','Next','Across','Prev']` mapping in `ReviewMoment`. Client-side, `ReviewMoment` additionally renders a `YOUR HAND` row from `h.hand`, a field the server has always sent (`git show origin/main:server/game/MoveReview.js:285`) but that no client ever read. The review payload is computed on demand from the raw tape (`server/gamelogReview.js`), memoized only in an in-process `Map` — nothing is persisted, so there are no old-shaped rows to migrate.

7. **(Unpushed commit `5ae6ce4`)** `LeaderboardV2`'s podium entries become `<button>`s wired to the existing `onPlayerClick`, and `PWAUpdatePrompt` renames `inGame` → `bottomIsLoadBearing`, adding `pathname === '/'` (the login route) to the set of screens where optional toasts are suppressed and an update collapses to a top pill.

## Complexity & Risk

**Medium.** 14 files, ~119 additions / 24 deletions, all trivially revertible; no schema changes, no persisted data, and the one server change is a pure function with a test. Lint and both suites were independently re-run and the PR's claims hold exactly: **lint 0 errors** (12 pre-existing warnings, none in changed files), **client 39/39**, **server 334/334**, including the new rotation test.

The riskiest parts:

- **The PWA color change is the only item whose correctness is invisible from a desktop browser, and it is the one that is partially wrong.** A stale checked-in `client/public/manifest.json` wins over the plugin-generated one (see Critical #1) — verified by building.
- **The table geometry is hand-tuned pixel literals with no runtime or test safeguard.** `client/test/layoutTiers.test.js` pins *structural* parity between the tiers but asserts nothing about the values, so a retune that reintroduces an overlap cannot fail CI. The seat/pile numbers moved by 20-30px each; the compact tier's pile well is now within a pixel of not fitting its own content (see Suggestions #1).
- **The `opponentHands` semantics change reinterprets a field under an unchanged name, shape and length.** Nothing would throw on a mismatch. It happens to be safe here — the review payload is never persisted, client and server ship in one Docker image, and the old client's naive index→label mapping already assumed the *new* convention — but that safety is emergent, not asserted.
- The seat rotation itself was traced end-to-end and is **correct**: `RoomManager.advanceTurn()` uses `(currentTurnIndex + 1) % 4`, so offset 1 is genuinely next-to-act, and this matches `CenterPile`'s existing `(playerIndex - viewerIndex + 4) % 4` relative-seat convention. Offset 3 = "Prev" is likewise right.

## Findings

### Critical

**C1. The PWA manifest color change has no effect — a stale `client/public/manifest.json` wins, and it carries entirely different colors.**
`client/index.html:15` hardcodes `<link rel="manifest" href="/manifest.json">`, which resolves to the checked-in `client/public/manifest.json`. `vite-plugin-pwa` *additionally* injects `<link rel="manifest" href="/manifest.webmanifest">`. I built the client and confirmed both links ship, in that order:

```
<link rel="manifest" href="/manifest.json" />        <- theme_color #1e293b, background_color #0f172a
<link rel="manifest" href="/manifest.webmanifest">   <- theme_color #0c3a23, background_color #0c3a23  (this PR's change)
```

Per the HTML spec the manifest is the **first** `link` in tree order with `rel=manifest`, so installing browsers take `/manifest.json` — a file this PR never touched, still on slate `#1e293b`/`#0f172a`, values that match neither the old `#166534` nor the new `#0c3a23`. The PR description's "the manifest colors align with it" and "Manifest/splash colors need a PWA re-install to take effect" are both incorrect: they will not take effect on any re-install.

The same build also shows `client/index.html:25`'s `<meta name="msapplication-TileColor" content="#166534">` still on the **old** value — a partially-updated color set inside the very file whose line 14 was updated.

The user-visible white-band symptom (item #2's actual complaint) *is* fixed, by the `index.css` body background, which is independent of all this. But the manifest/splash half of the stated goal is not delivered.

*Fix:* decide whether `client/public/manifest.json` is still needed now that the plugin generates one. If not, delete it and drop the hardcoded `<link rel="manifest">` from `index.html`. If it must stay, sync its `theme_color`/`background_color` to `#0c3a23`. Either way update `msapplication-TileColor` in the same pass. Files: `client/index.html:15,25`, `client/public/manifest.json`.

**C2. The rotation never reaches a test at a non-zero seat — every integration-level test runs at seat 0, where the rotation is the identity.**
`server/test/moveReview.test.js`'s new test exercises the exported `relativeOpponentHands` helper directly and covers all four seats correctly. But the existing `reviewGame`-level tests that inspect the highlight payload (`a highlight carries the position, the alternative and the reason`, and the self-play test) all pass `seatForRound: () => 0`. Rotating a 4-element array by 0 is a no-op, so those tests pass identically against the old absolute mapping and the new rotated one — they cannot distinguish the two implementations. A regression that reverted `server/game/MoveReview.js:309` to the unrotated form while leaving the tested helper untouched would ship green, reintroducing exactly the bug this commit fixes for three of every four players.

*Fix:* add a `reviewGame`/`reviewRound` case with `seatForRound: () => 2` (or varying) that asserts `h.opponentHands[0] === null` and that offsets 1-3 equal `snap.hands[(seat + offset) % 4]` wired through the real `wireCard`. Rated 8/10 by both the testing and correctness passes. File: `server/test/moveReview.test.js`.

### Suggestions

**S1. The pile-label overlap is reduced, not eliminated — and the residual case is the compact tier at the very viewport the PR was verified on.**
Two independent computations (mine and the correctness pass) converge on the same numbers. At the `minHeight` clamp the flex item's required box exceeds the well:

| Tier | stackHeight | marginTop | required | frame minHeight |
|---|---|---|---|---|
| Mainline | 118 | `round(26×1)` = 26 | 144 | 132 |
| Compact | 104 | `round(26×0.9)` = 23 | 127 | 124 |

Because the well is `justifyContent: center`, `marginTop` only displaces the stack by *half* its value in the fitting case, and in the clamped case the content overflows symmetrically. Working the compact tier at 402×650 (well height = 650 − 194 − 330 = 126): the stack box starts at ≈22, its centre is at ≈74, and the second card in the fan (`OFF[1]`, `dy = -20 × 0.9 = -18`, card height `90 × 0.9 = 81`) lands with its top edge at ≈16. The label spans ≈10→31. The card is still under the label, and the label still has `zIndex: 8` against the card's max of 5 — so it still paints over the cards it names, which is the bug being fixed. The mainline tier at its `minHeight` gives the same result (card top ≈14, label 10→32).

This only bites with ≥2 plays in the current trick, which is plausibly why the screenshots looked clean. The fix is a real improvement in the common case (near `maxHeight` there is ~38px of clearance) — this is a partial delivery, not a non-delivery.

*Fix:* size the reserve against `minHeight` rather than the nominal `stackHeight` — e.g. `marginTop >= labelBandHeight + max(|OFF.dy|)` and verify the sum fits `frame.minHeight` — or give the label reserved flex space instead of removing it from flow. Worth a devtools check at 402×650 with a 3-card trick before deciding. Files: `client/src/components/tableV2/CenterPile.jsx:71-82`, `client/src/components/tableV2/layout.js`.

**S2. `#N` asserts a chronological fact the client-side log cannot guarantee.**
`useRoundLog` reconstructs the round log purely from the `lastPlayed` field of successive `game_update` snapshots; its own header says "this log is advisory". The server's authoritative `trickHistory` (`RoomManager.js:59`) is passed only to bot context and never reaches the client — `getGameState()` does not include it, and the `reconnected` payload is just `getGameState()` plus the hand. So on a **PWA relaunch, page reload, or mid-round reconnect** the log restarts empty and picks up at most four entries (one `lastPlayed` per player), which the new code will label `#1`-`#4` even though they were, say, moves 11-14. Same for a spectator joining mid-round.

Before this PR the log was merely incomplete, which reads as "I joined late". Now it makes a specific, checkable, and wrong claim. (The `TRICK N` divider has the same flaw today — it restarts at 1 — so this is an existing class of inaccuracy the PR extends with a sharper claim, not a new one.)

*Fix:* either send the round log from the server (it already exists as `trickHistory`) so the numbering is authoritative, or suppress/qualify the numbering when the log is known-partial (e.g. the hook can flag that it started mid-round, and the panel can render `…` above the first row). Files: `client/src/components/tableV2/RoundLogRows.jsx:28`, `client/src/hooks/useRoundLog.js`.

**S3. The new winner ring will be clipped left and right, and is probably too faint to read.**
`RoundCelebration.jsx`'s rows live in a container with `overflowY: 'auto'` (line ~54). Per CSS, a non-`visible` value on one axis computes `visible` on the other to `auto`, and `box-shadow` is not part of the scrollable overflow region — so it is clipped, not scrolled to. The rows are full-width flex items (`align-items: stretch`), so the ring's outer 3px on the left and right edges falls outside the container's padding box and is cut. The result is a ring present on the top and bottom edges and sliced off at the sides — arguably a worse artifact than the corner square it replaces.

Separately, `soft` is `rgba(255,201,77,.18)` (`tableTheme.js:8`) — an alpha tuned for a 22px blurred halo. As a crisp 3px band at 18% opacity, next to an existing `1px solid ${acc}77` border, it will be barely visible.

*Fix:* use an inset ring (`box-shadow: inset 0 0 0 3px …`), which follows `border-radius`, needs no space outside the border box, and cannot be clipped; or thicken the border instead. Either way consider a higher-alpha colour than `soft` for a hard-edged ring. File: `client/src/components/tableV2/RoundCelebration.jsx:63-73`.

**S4. The desktop log rail was changed but not in the stated verification, and its header may now wrap.**
`RoundLogPanel`'s header is a `space-between` flex row with `gap: 8` inside `LOG_RAIL_WIDTH = 304` minus 32px padding = 272px of content. `PLAYED THIS ROUND` (10px/800/`letterSpacing: 2`, 17 chars) plus `12 plays · newest first` (11px/700, ~23 chars) estimates to ~285-290px — over budget, and with `min-width: auto` on both items the excess resolves as a wrap, which will look wrong under `alignItems: 'baseline'`. The estimate is rough (±10%), but the PR's verification was Playwright at 402×650 and 390×844 only, so the desktop rail was never looked at.

*Fix:* check it at 304px. If it wraps, shorten to `newest first` alone (the row count is already implied by the numbered rows), or move the direction to a second line. File: `client/src/components/tableV2/RoundLogPanel.jsx:20-22`.

**S5. The felt colour now exists as five hand-typed literals with no build-time link and no guard.**
`#0c3a23` appears in `client/index.html:14`, `client/src/index.css:29`, `client/vite.config.js:51-52` (×2), and is *supposed* to track `FELT_BASE` in `client/src/theme/tableTheme.js:11`. `FELT_BASE` is a browser-only ES module string, so neither the static HTML nor the Node-side vite config can import it — the copies are drift-prone by construction and the only synchronisation mechanism is three comments. C1 is what that looks like when it fails.

*Fix:* extract the value once into a dependency-free module (`.mjs`/`.json`) importable by both `vite.config.js` and `tableTheme.js`, and template the `index.html` meta tag via a Vite define or html-transform. At minimum add a `client/test/` assertion that all the literals equal `FELT_BASE`'s last stop, so a future edit to the gradient is forced to touch them.

**S6. `client/test/layoutTiers.test.js` pins the tiers' shape but none of their geometry.**
The existing tests assert key parity, top-and-bottom anchoring, and banner/hand inheritance — all still passing — but nothing about the values, which is precisely what this PR changes by hand. Nothing would have caught S1, and nothing will catch the next retune.

*Fix:* add geometric invariants to the same file: side-seat `top` ≥ top-seat `top` + a seat-height constant; `pile.frame.top` ≥ side-seat `top` + seat height; and `pile.frame.minHeight >= stackHeight + labelReserve` (which fails today for both tiers — see S1, and would have caught it).

**S7. `CenterPile`'s new constants encode a coupling that nothing enforces.**
`top: 10` and `marginTop: round(26 * scale)` are hand-derived from three values elsewhere: `OFF`'s max `|dy|` of 20 (lines 8-14), the label's `fontSize: 12 * scale`, and its `padding: '4px 12px'`. The comments describe the coupling accurately, but if a sixth fan position with a larger `dy` is added, or the label font changes, `26` silently becomes wrong and the bug returns. Note that this same file explicitly imports `MOBILE_LAYOUT.pile.frame` as `DEFAULT_FRAME` with the comment "the single source of truth in layout.js, not a hand-mirrored copy that could drift" — the new constants don't follow that convention.

*Fix:* derive them (`const maxDrift = Math.max(...OFF.map(o => Math.abs(o.dy)))`, and compute the label band from the same font/padding constants used to render it), or move them into `layout.js` alongside `frame`/`scale`/`stackHeight` for both tiers. File: `client/src/components/tableV2/CenterPile.jsx:8-14,72,82`.

**S8. `OpponentSeat.jsx:78-83` still hardcodes the old seat offsets.**
The `placement` fallback is `{ top: 96 }` / `{ top: 178 }` — the pre-PR mainline values, now stale. It is dead today (both `GameTableMobile.jsx:131` and `GameTableDesktop.jsx:172` always pass `placement`), so this is not a regression, but it is the exact "hand-mirrored copy that could drift" the sibling `CenterPile` comment warns against, and it has now drifted.

*Fix:* import `MOBILE_LAYOUT.seats[position]` as the default, matching `CenterPile`'s `DEFAULT_FRAME` pattern, or drop the fallback and make `placement` required.

**S9. `relativeOpponentHands`'s injectable `wire` parameter is production API surface added for test convenience.**
`server/game/MoveReview.js:137-139` — the sole production call site never passes it; it exists so `server/test/moveReview.test.js:394` can inject `(c) => c.rank`. The file's other exported helpers (`classify`, `playOutcome`, `byImportance`) are tested against real data shapes without such a seam, and `{rank:'3', suit:'D', value:0}` is not meaningfully harder to assert against than `'3'`.

*Fix:* drop the third parameter and assert against real `wireCard` output.

**S10. The review payload has no schema-version marker.**
`opponentHands` changed meaning while keeping its name, shape and length, so a mismatched consumer reinterprets rather than errors. This is safe *here* — the payload is computed on demand and never persisted (`server/gamelogReview.js`, in-process `Map` only, `CACHE_LIMIT = 200`), client and server ship in one image, and the old client's index→label mapping coincidentally already assumed the new convention, so even a cached old client renders the new payload correctly. But the safety is emergent, and the next change to this field may not be so lucky.

*Fix:* before this payload is touched again, either give the field a convention-explicit name or add a `reviewSchemaVersion` the client asserts against. Not blocking for this PR.

**S11. Two iOS/PWA gotchas belong in `CLAUDE.md`, not only in code comments.**
The repo has an established venue for exactly this category — see the `SuitWatermark.jsx` entry in `CLAUDE.md` (~lines 210-216) recording the Apple Color Emoji finding inline in a component's architecture bullet. This PR discovered two of the same shape, currently captured only as JSX/CSS comments: (a) iOS Safari paints a `gradient + blurred box-shadow` square at a rounded row's corners; (b) safe-area bands in a standalone PWA render the plain `body` background, not the app shell's. Per the user's standing "docs over memory" rule and the repo's own precedent, add one line each. Nothing in `docs/` or `CLAUDE.md` is *stale* as a result of this PR — `opponentHands` is never documented at field level, and the `layout.js` bullet cites no pixel values.

### Nits

- **`'You'` is unreachable.** `ReviewMoment.jsx:149`'s `['You','Next','Across','Prev'][offset]` can never select index 0, because `relativeOpponentHands` always nulls it and line 146 filters on `oppHand &&`. Harmless (the own hand is now rendered separately as `YOUR HAND`), but a reader can't tell whether `'You'` is deliberate index alignment or a leftover — and a future "fix" could make it render. Add a note on the array itself, or use `['', 'Next', 'Across', 'Prev']` with a named constant.
- **Seventh copy of the button reset.** `LeaderboardV2.jsx:179`'s `{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }` already exists verbatim in `CoachBubble.jsx:207`, `Login.jsx:257,309`, `ReviewMoment.jsx:69`, `HomeScreenV2.jsx:305`, `HudBar.jsx:22`, `StatsV2.jsx:133`. More jarring is that the rest-of-list button 20 lines below (`:202-206`) uses the opposite idiom (supply-full-style rather than reset-then-restyle) — the file's two most closely related buttons now model two patterns.
- **`0 plays · newest first`.** `RoundLogPanel.jsx:21` renders the direction hint even when the log is empty, right above "Nothing played yet this round."
- **Implicit route coupling.** `PWAUpdatePrompt.jsx:14`'s `'/game/'` and `'/'` duplicate route knowledge from `App.jsx:102-114`, and there is no routes-constants module in this codebase (confirmed — this is the only route matcher outside `App.jsx`). Extracting one for a single call site would be premature; a cross-reference comment at the `<Route path="/">` declaration would make the coupling discoverable.

### Questions

1. **Is `client/public/manifest.json` still needed?** It predates `vite-plugin-pwa` and is now shadowing it. Deleting it plus the hardcoded `<link rel="manifest">` is the clean fix for C1, but only if nothing else depends on that path.
2. **Was the desktop log rail looked at?** The stated verification is two mobile viewports; `RoundLogPanel` is desktop-only (`wide && <RoundLogPanel …>`), so S4 would not have surfaced.
3. **Is `self-end` on the podium button deliberate?** The parent is already `flex items-end`, so `self-end` restates the inherited alignment. Harmless, but if it was added to work around something, that something is worth knowing.
4. **How was `marginTop: 26` arrived at?** If it was measured against a well near `maxHeight`, S1's clamped case simply wasn't in the sample.

## Correctness

Verified correct and explicitly cleared:

- **Seat rotation direction and labels.** `RoomManager.advanceTurn()` (`server/game/RoomManager.js:1689-1700`) uses `(currentTurnIndex + 1) % 4`, so offset 1 is next-to-act; this matches `CenterPile`'s unchanged `(playerIndex - viewerIndex + 4) % 4` relative-seat convention (offset 1 = right) and the mobile/desktop seat placement. Offset 3 = "Prev" is the seat acting immediately before the reviewed seat. No mislabeling.
- **`h.hand` exists.** `git show origin/main:server/game/MoveReview.js:285` already had `hand: snap.hands[seat].map(wireCard)`; the client change is purely additive. `server/gamelogReview.js` is the single producer for both the review and training endpoints, so there is no second path that omits it.
- **Move-number arithmetic.** `moveNo = total - i` over the reversed log yields `#total` at the top and `#1` at the bottom. Correct given a chronologically-ascending `log` (see S2 for what `log` can actually contain).
- **`PWAUpdatePrompt`'s `'/'` check.** `App.jsx:102` routes `/` to `Login` when logged out and redirects to `/lobby` otherwise, so `pathname === '/'` is the login screen exactly when the login form is on screen.
- **`LeaderboardV2` podium button.** `className="flex … "` overrides the button's default `display`, `flex-1` works normally on a flex item regardless of tag, no nested interactive elements in the podium (unlike the rest-of-list rows, which have an archetype span with `stopPropagation`).
- **Label truncation.** `maxWidth: calc(100% - 24px)` with `translateX(-50%)` clamps correctly — the transform does not affect layout width.
- **`#0c3a23` is the felt edge stop.** `FELT_BASE` = `radial-gradient(…,#0c3a23 100%)`. The comments' claim is accurate.

Open correctness findings are S1 (pile overlap at the `minHeight` clamp), S2 (move numbers vs. a reconstructed log) and S3 (clipped ring), detailed above.

## Test Coverage Gaps

| Area | Rating | Regression it would miss |
|---|---|---|
| `reviewRound`/`reviewGame` at a non-zero seat (C2) | **8** | Reverting the rotation at the call site while the helper test stays green — the exact shipped bug, for 3 of 4 players |
| `layoutTiers.test.js` geometric invariants (S6) | 7 | Any seat/pile retune that reintroduces an overlap; would have caught S1 |
| `RoundLogRows` move-number arithmetic | 6 | A wrong-direction or off-by-one numbering after an upstream ordering change. Would need extracting `moveNo` into a pure helper — consistent with how `client/test/layoutTiers.test.js` tests `layout.js` |
| Review payload schema/contract test (S10) | 4 | Any future breaking change to `/api/review/:gameId` or `/api/review/examples/:username` |
| `ReviewMoment` YOUR HAND gating | 4 | Fail-safe (row is omitted), and the client has no component-render infrastructure |
| `PWAUpdatePrompt` route gating | 3 | Cosmetic (pill vs. card) |
| `LeaderboardV2` podium click wiring | 2 | Pure event wiring to an already-untested sibling handler |

Infrastructure note for whoever acts on this: the client suite is **plain `node --test` over `client/test/*.test.js`** importing directly from `client/src/**` — no vitest, no jsdom, no Testing Library. "Client tests 39/39" means pure-logic tests only. Do not add component-render tests without first adding that infrastructure; extract pure helpers instead, as `layoutTiers.test.js` does.

## Maintainability

Covered above as S5 (five drifting colour literals with no build-time link), S7 (`CenterPile`'s unenforced constants), S8 (`OpponentSeat`'s stale fallback), S9 (the test-only `wire` seam), and the button-reset and unreachable-`'You'` nits.

One residual note: `MOBILE_COMPACT_LAYOUT` overrides `seats` and `pile` wholesale — only `banner` and `hand` are actually inherited through `...MOBILE_LAYOUT`. That predates this PR, but it means every retune costs two hand-maintained parallel literal sets, and `layoutTiers.test.js` pins shape parity without being able to catch a value that drifts in one tier only. S6 is the cheap mitigation.

## Documentation

Nothing in `docs/` or `CLAUDE.md` is made stale by this PR — verified by reading all eight files in `docs/` plus `CLAUDE.md` and `README.md`. `opponentHands` and the review wire payload are never documented at field level (`docs/MOVE-REVIEW.md` covers the system, not the shape); the `layout.js` bullet in `CLAUDE.md` describes the tier mechanism in prose and cites no pixel values; there is no PWA/theme-color doc at all. No `AGENTS.md` exists.

The one worthwhile addition is S11: fold the two newly-discovered iOS/PWA rendering gotchas into `CLAUDE.md`, following the `SuitWatermark.jsx` precedent already in that file.

## API Contract

`opponentHands` changed meaning under an unchanged name, shape (`[null|Card[]]`) and length (4) — see S10. Three risks were investigated and **cleared**:

- **Persistence:** none. `server/gamelogReview.js:12-14,92-167` computes reviews on demand from `mlog_round.deal` + `mlog_action`; the only cache is an in-process `Map` (`CACHE_LIMIT = 200`) that dies with the process. `server/db.js` has no table storing computed highlights. No old-shaped rows can be served after deploy.
- **Consumers:** exactly one renderer, `ReviewMoment.jsx`, updated in the same PR. `GameReviewV2.jsx:158` and `TrainingV2.jsx:157` render through it; `GameReview.jsx` and `Training.jsx` are fetch-only wrappers; `Coach.js` imports other symbols. No export, replayer, or analytics path touches the field.
- **Stale PWA client:** benign, and the initial hypothesis was backwards. The client's label lookup is byte-identical before and after (the diff renames `seat` → `offset` and adds a comment); it always mapped array index straight to `['You','Next','Across','Prev']`. So a cached pre-PR client renders the **new** relative payload *correctly*, and it was the **old** absolute payload it rendered wrong — the very bug `8536fe2` fixes. The dangerous pairing would be a newer client against an older server, which cannot occur: client and server ship in one Docker image (`fly.toml`, `server/index.js:3380-3384`).

Pre-existing and out of scope, but worth knowing: `registerType: 'autoUpdate'` is set in `client/vite.config.js`, yet the update is applied only on an explicit user click, and there are two independent SW registration paths (`client/src/main.jsx:15-22` and `PWAUpdatePrompt.jsx`). That is the mechanism that would let a genuinely-incompatible pairing linger.

## Files Changed

| File | Change |
|---|---|
| `client/index.html` | `theme-color` `#166534` → `#0c3a23`. **Still has stale `msapplication-TileColor: #166534` (C1) and the shadowing `<link rel="manifest" href="/manifest.json">`.** |
| `client/src/index.css` | `body { background-color: #0c3a23 }` — the change that actually fixes the white safe-area bands. |
| `client/vite.config.js` | PWA manifest `theme_color`/`background_color` → `#0c3a23`. **Inert as shipped (C1).** |
| `client/src/components/PWAUpdatePrompt.jsx` | `inGame` → `bottomIsLoadBearing`, adds `pathname === '/'`. Route check verified correct. |
| `client/src/components/tableV2/CenterPile.jsx` | Label pinned absolute at `top: 10` with ellipsis clamping; stack gains `marginTop: round(26 × scale)`. See S1, S7. |
| `client/src/components/tableV2/LeaderboardV2.jsx` | Podium entries `div` → `button` with `onPlayerClick` + `aria-label`. Correct; see nits. |
| `client/src/components/tableV2/ReviewMoment.jsx` | New `YOUR HAND` row from `h.hand`; `seat` → `offset` rename + comment. |
| `client/src/components/tableV2/RoundCelebration.jsx` | Winner row: gradient + 22px glow → solid fill + `0 0 0 3px` ring. See S3. |
| `client/src/components/tableV2/RoundLogPanel.jsx` | Header count gains `· newest first`. See S4. |
| `client/src/components/tableV2/RoundLogRows.jsx` | Per-row `#N` chronological move number. See S2. |
| `client/src/components/tableV2/RoundLogSheet.jsx` | Title gains a baseline-aligned `newest first` label. |
| `client/src/components/tableV2/layout.js` | Seat offsets 96/178 → 72/142 and 62/128 → 58/114; pile `top` 268/200 → 236/194, `maxHeight` 216 → 248/232. See S1, S6. |
| `server/game/MoveReview.js` | New exported `relativeOpponentHands(hands, seat, wire)`; `reviewRound` uses it at line 309. See C2, S9, S10. |
| `server/test/moveReview.test.js` | One new test covering the helper at all four seats. Passes. See C2 for what it does not cover. |
