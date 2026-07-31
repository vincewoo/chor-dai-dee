# Review: #147 - fix(mobile): resolve layout collisions and usability issues on phone viewports

**PR**: https://github.com/vincewoo/chor-dai-dee/pull/147
**Author**: julo15
**Branch**: julo/fix-mobile-usability → main
**Date reviewed**: 2026-07-30
**Head reviewed**: `32bc479` (the branch advanced from `e359b4c` to `32bc479` while this review ran; both follow-up commits were reviewed and are folded in below)

## Summary

Client-only PR fixing mobile usability: layout collisions on short viewports in the v2 game table, iOS viewport-height handling (`100svh`), PWA toast placement, a lobby reconnect-probe error race, a shared `timeAgo` util, and an eslint ignore for the generated `dev-dist/`. Two follow-up commits landed mid-review: `32bc479` (plain-CSS safe-area helper for the toast — fixes a real bug in `e359b4c`, see Correctness) and `600708e` (server test de-flake, unrelated hardening, looks correct).

## How It Works

The v2 mobile table (`GameTableMobile.jsx`) previously consumed a single set of pixel tokens (`MOBILE_LAYOUT`, tuned on a ~844px phone) with top-anchored seats/pile and a bottom-anchored controls/hand stack; anything shorter made the two collide. The PR introduces a second tier, `MOBILE_COMPACT_LAYOUT` (spread of `MOBILE_LAYOUT` with `seats`/`pile` overridden — `banner`/`hand` inherit), selected at render time by a new `useIsShortViewport()` hook (`matchMedia('(max-height: 760px)')` via the existing `useSyncExternalStore`-based `useMediaQuery`). Three structural changes make the geometry robust rather than merely re-tuned:

1. **Pile frame is anchored top AND bottom** (`{top, bottom, maxHeight, minHeight}` instead of fixed `height`), spread directly into `CenterPile`'s inline style — on tall viewports `maxHeight: 216` clamps to the exact old box; on short ones the frame shrinks instead of extending under the controls.
2. **`StatusBanner` moves into the bottom stack's normal flow** (`placement=null`, which `StatusBanner` handles by omitting `position: absolute`) as the first child of the bottom-anchored flex column, so it structurally cannot overlap the pile; because the stack is bottom-anchored, mounting/unmounting the banner (coach bubble up) only moves the stack's top edge — Pass/Play/hand never shift.
3. **Sort/Reset merge into the chips row** in `ControlsRow` (pinned right of a `flex: 1` scroll area with an edge-fade mask), removing one row of vertical stack height.

Independently: `.h-screen-safe`/`.min-h-screen*` prefer `100svh` (valid because `html/body` are `overflow: hidden`, so the browser toolbar never collapses and the small viewport is the truth); the PWA toasts move to a bottom-anchored fixed wrapper (`pointer-events-none` with `[&>div]:pointer-events-auto`, positioned by the new plain-CSS `.bottom-safe-20` helper from `32bc479`), and the offline toast auto-dismisses after 4s; `Lobby.jsx` suppresses "Room not found" errors unless a user-initiated join is in flight, tracked via `isJoiningRef` (a ref because the socket handler's effect deps would otherwise capture stale state), with error toasts auto-dismissing after 5s; the `timeAgo` inline function in `ActivityFeedV2` is extracted byte-identically to `client/src/utils/timeAgo.js` and now also replaces `HomeScreenV2`'s cruder inline hours/minutes formatter.

## Complexity & Risk

**Medium.** 13 files in the original commit + 3 in follow-ups, all client-side; trivially revertible (no schema/API/server-logic changes). The riskiest surfaces:

- The game table is the app's hot path, and the fix is hand-tuned pixel literals with **no runtime safeguard** — correctness at each height tier was verified by screenshot, and nothing automated would catch drift (see Test Coverage).
- The `100svh` change affects every screen's height sizing across three CSS classes; it is well-reasoned (shell never scrolls) but is inherently device-behavior-dependent and untestable in CI.
- The original commit `e359b4c` contained a real, silent CSS bug (Tailwind v4 drops arbitrary values with bare `env()`) that the author caught and fixed in `32bc479` — evidence that this territory is easy to get wrong silently.
- The Lobby race fix narrows the spurious-toast window substantially but does not eliminate misattribution when a user join races an in-flight reconnect probe (see Findings).

## Findings

### Critical

1. **In-game PWA update toast can cover and intercept taps on Pass/Play** — `client/src/components/PWAUpdatePrompt.jsx:79` + `client/src/App.jsx:118`. `PWAUpdatePrompt` is mounted globally (outside `<Routes>`), so it also renders over `/game/:roomId`. The new mobile placement (`bottom: calc(5rem + safe-inset)` ≈ 80px) puts the ~140-160px-tall `needRefresh` card at roughly y=80–230 from the viewport bottom — squarely over the hand top and the Pass/Play row (~y=145–193). The toast is `z-[60]` vs the controls' `z-index: 30`, and the visible card has pointer events enabled, so it intercepts taps. Unlike the new `offlineReady` 4s auto-dismiss, `needRefresh` has no timer — and this repo auto-deploys `main` on push (Fly.io CI), so a deploy landing mid-game is a routine event that would block gameplay controls until manually dismissed. The old top-3 placement was also bad in-game (covered the HUD), but the HUD is not tap-critical the way Pass/Play are. **Fix**: scope the toast out of the game route (or collapse `needRefresh` to a small badge while a game is active), or add an auto-dismiss + reposition clear of the bottom stack.

2. **New shared util `timeAgo.js` has zero tests despite trivially available infra** — `client/src/utils/timeAgo.js`. A brand-new exported pure function, now relied on by two components, with the exact kind of boundary math (59s/60s, 23h/24h, 6d/7d, 29d/30d, 364d/365d, null/invalid iso, future timestamps) that regresses silently — and the client already runs pure-function tests via `node --test test/*.test.js`. A `client/test/timeAgo.test.js` is a ~20-line, zero-infra add. (The PR's "26/26 client tests pass" is accurate but none of those tests touch any file in this diff.)

### Suggestions

1. **`isJoiningRef` conflates concurrent `join_room` requests** — `client/src/components/Lobby.jsx:299-309`. The reconnect probe fires on mount and on every socket `connect`; `isJoiningRef` is a single boolean across all in-flight `join_room` emits, and the `error` handler cannot tell which request an error belongs to. If a user's Create/Join click overlaps an outstanding probe: (a) the probe's "Room not found" can surface as if it were the user's (misattributed toast — notably "Create a room" can never legitimately produce that error); (b) the handler unconditionally resets `isJoining`, re-enabling the button while the real request is still outstanding; (c) a genuine "Room not found" for the user's join can be suppressed if the probe's error already consumed the ref. The window is one server round-trip, so this is much better than the old behavior — but the same class of bug survives under a narrower trigger. Consider correlating responses to requests (socket.io ack callback on `join_room`, or a dedicated reconnect-probe event/error so probe responses are distinguishable by construction).

2. **`StatusBanner`'s default `placement` is stale and a trap** — `client/src/components/tableV2/StatusBanner.jsx:12`. The default `{ bottom: 308, left: 0, right: 0 }` is the exact old `MOBILE_LAYOUT.banner` value this PR deleted. Both callers now pass `placement` explicitly (both `null`), so the default is dead code — and if a future caller omits the prop, it silently reintroduces the banner/pile collision this PR fixes. Default to `null` or make the prop required. (Same pattern-risk applies to `CenterPile.jsx:18`'s `DEFAULT_FRAME`, which is hand-mirrored from `layout.js` and currently unreachable — importing `MOBILE_LAYOUT.pile.frame` as the default, or dropping the default, removes the second source of truth. Note the "leaf-default convention" is already inconsistent: `MobileHandV2`/`SpectatorHandV2`'s `geometry` has no default.)

3. **Edge-fade mask applies even when chips don't overflow** — `client/src/components/tableV2/ControlsRow.jsx:134`. The mask is a static style, not gated on `scrollWidth > clientWidth`, so when the chips fit (few hand types late in a round; desktop, where the PR description itself says "all chips + Sort fit inline") the first and last chips get a permanent ~12px fade with nothing to scroll — reading as the very "layout bug" look the mask was added to avoid. Consider gating on actual overflow (and ideally on scroll position, so a fully-scrolled edge isn't faded).

4. **Extract the "Room not found" suppression predicate for testability** — `client/src/components/Lobby.jsx:303`. The core race-condition fix of this PR is one inline boolean expression inside a socket callback — untestable as written. A pure exported `shouldShowJoinError(err, isJoiningInFlight)` plus a 5-line node:test would pin the highest-risk logic in the PR. Pairs well with hardening the ref/state mirroring: the ref is manually paired with `setIsJoining` at 4 call sites; a `beginJoin()` helper or a `useEffect(() => { isJoiningRef.current = isJoining })` sync (the codebase's own precedent: `pusoyModeRef` in GameRoom.jsx) would make missing a site impossible.

5. **Add a layout-tier shape test** — `client/src/components/tableV2/layout.js`. `MOBILE_COMPACT_LAYOUT` is safe today only because it spreads `MOBILE_LAYOUT` and overrides `seats`/`pile` wholesale. A pure-object test (key parity with `MOBILE_LAYOUT`; `pile.frame` key parity; `banner`/`hand` inherited) would catch the silent-`undefined`-placement failure mode when a third tier or a non-spread edit arrives.

6. **Very short viewports (< ~654px) and landscape phones still collide** — `client/src/components/tableV2/layout.js:50`. In the compact tier, once `viewportHeight − 200 − 330 < minHeight (124)` the pile's bottom edge is pinned at 324px from the top while the ~275px bottom stack doesn't shrink, so the pile well extends behind the controls (z-index keeps controls tappable; the played cards get obscured). iPhone SE landscape (667×375) is width < 768 → mobile table, height ≤ 760 → compact tier → heavy overlap. This is not a regression (landscape was equally broken before) and is below the PR's stated ~650px target — flagging as a known limitation. If landscape matters, either add a more aggressive tier below ~650px or show a rotate-your-device prompt.

7. **CLAUDE.md is now stale in two places this PR directly changes** (the repo's full 770-line CLAUDE.md, not the abbreviated excerpt):
   - Gameplay Helpers → Quick Select says "Reset and Sort live in a separate right-aligned row below the chips" — now factually wrong; they are pinned in the same row.
   - The v2 architecture section describes exactly two breakpoints (`useIsDesktop`, `useIsWide`) and two layout objects, and calls `useMediaQuery.js` "the one place breakpoints are defined" — this PR adds `SHORT_QUERY`/`useIsShortViewport` and `MOBILE_COMPACT_LAYOUT`, which is precisely the kind of architectural fact that doc records. Update both; optionally add a one-line `timeAgo.js` entry to Utils (that list was already non-exhaustive pre-PR).

### Nits

1. `client/src/components/tableV2/ControlsRow.jsx:131-207` — the children of the new wrapper div were not re-indented; the nesting is structurally correct but visually misleading.
2. `client/src/components/tableV2/ControlsRow.jsx:20,122,130` — `HELPER_ROW_INSET` now serves three roles (scroll-into-view offset math, wrapper padding, fade width). A separate `EDGE_FADE_WIDTH` constant would keep a future padding tweak from silently changing the fade and scroll math.
3. `client/src/utils/timeAgo.js:22` — the `export default` is unused (both consumers use the named import) and inconsistent with the other single-purpose utils (`cardUtils`, `avatars`, `suitLens`, `sounds`, `api` are named-export only).
4. `client/src/components/tableV2/ActivityFeedV2.jsx:29-30` — leftover double blank line where the inline `timeAgo` was removed.
5. `client/src/index.css:43-45` — the comment "Fall back to the plain viewport when the insets are 0" misdescribes the mechanism: when `env()` is supported the calc line always wins and merely equals `100svh` at zero insets; the actual fallback (previous declaration) only fires when `env()` isn't parsed at all.

### Questions

1. Is a mid-game service-worker update expected to be common enough to care about (given Fly auto-deploy on push to `main`)? If deploys are rare/off-hours, Critical #1 could be downgraded to a fast-follow.
2. Is landscape phone play in scope at all? (Determines whether Suggestion #6 warrants work or a wontfix note.)

## Correctness

Verified fine (worth ruling out explicitly):

- **Banner in normal flow does not shift Pass/Play/hand**: the bottom stack is `position: absolute` with only `bottom` set; the banner is the first child of the column, so its mount/unmount only moves the stack's top edge. `CoachBubble` is `position: absolute; bottom: calc(100% + 8px)` — out of flow, contributes no height.
- **`MOBILE_COMPACT_LAYOUT` completeness**: every key `GameTableMobile` reads (`seats.size`, `seats.top/left/right`, `pile.frame/scale/stackHeight`, `banner`, `hand`) is present via the spread.
- **Pile geometry**: at ~844px, `top:268 + bottom:344 + maxHeight:216` clamps to the exact old `top:268/height:216` box. Between 761–844px (mainline tier) the computed height (≥149px) never hits `minHeight:132`, so no overlap in that band; at 760px the compact tier yields 230px clamped to 216. `CenterPile` spreads the frame directly into inline style, so the new keys all apply.
- **`isJoining` cannot get stuck**: `server/index.js:648-656` always emits `error` alongside `join_failed`, so every join outcome resets the flag.
- **`timeAgo` inputs parse everywhere**: `end_time` is always ISO-8601 with `Z` (`toISOString()` on the normal path; the abandoned-game sweep explicitly reformats via `strftime('%Y-%m-%dT%H:%M:%S.000Z', ...)`), so no Safari date-parsing hazard. The `HomeScreenV2` swap also fixes a latent bug: the old inline code rendered literal "NaNm ago" for an unparseable `end_time`; `timeAgo` returns `null`.
- **`'10'` rank special-case** (`HandCardFaceV2.jsx`): rank is always the literal string `'10'` (server `Deck.js` and client mirrors); `pusoyMode` remaps suits only.
- **`useIsShortViewport`**: live `matchMedia` change subscription; resize/rotation flips tiers correctly; no stale-closure issue.
- **ControlsRow auto-scroll math** after the padding move: the `- HELPER_ROW_INSET` offset now lands the target chip 12px inside the container — exactly past the fade ramp; clamped at 0. Behaves sensibly.
- **`e359b4c`'s Tailwind bare-`env()` bug** (`bottom-[calc(5rem+env(safe-area-inset-bottom))]` silently dropped by Tailwind v4, per the codebase's own documented constraint in index.css) — **found by this review and already fixed on the branch** by `32bc479` using the documented plain-CSS pattern (`.bottom-safe-20`, unlayered, scoped `max-width: 639.9px` so the layered `sm:bottom-4` still wins on desktop). Verified correct at head; no action needed.
- **`600708e`** (server test): anchoring the tamper cut at the last PLAY ply is the right fix for the lone-2♠/AUTO_PASS flake; logic checked, no issues.

Residual (unconfirmed, low confidence): some Android browsers may collapse chrome on non-scroll heuristics, in which case `100svh` under-reports available height — cosmetic wasted space, not a collision.

## Test Coverage Gaps

| Area | Rating | Note |
|---|---|---|
| `utils/timeAgo.js` | 10 | New shared pure util, zero tests, existing `node --test` infra covers it trivially → Critical #2 |
| Lobby "Room not found" suppression predicate | 8 | The PR's core race fix; untestable inline — extract to a pure function → Suggestion #4 |
| `MOBILE_COMPACT_LAYOUT` shape parity | 7 | Cheap pure-object test; catches missing-key regressions on the short-viewport path → Suggestion #5 |
| `CenterPile.DEFAULT_FRAME` mirrors `MOBILE_LAYOUT.pile.frame` | 5 | Comment-only invariant; one-line deep-equal if kept (or eliminate the duplicate) |
| PWA toast timers, StatusBanner/ControlsRow layout, `'10'` glyph | 4 | Needs jsdom/RTL the repo has never had — not worth standing up for this PR; flag only |
| `SHORT_QUERY`/`useIsShortViewport` | 3 | Not testable without matchMedia mocks; indirect coverage via shape test suffices |

The `100svh` migration — the root-cause fix for the toolbar-clipping bug — has no automated coverage possible here; it needs real-device verification (iOS Safari + Android Chrome, browser and standalone-PWA modes), which the PR verification section (Playwright at fixed viewport sizes) does not fully cover.

## Maintainability

- StatusBanner stale dead default / CenterPile hand-mirrored dead default (→ Suggestion #2).
- Unconditional edge-fade mask (→ Suggestion #3); `HELPER_ROW_INSET` triple duty (→ Nit #2); wrapper indentation (→ Nit #1).
- `isJoiningRef` manual mirroring at 4 sites; codebase precedent for effect-synced refs exists in GameRoom.jsx (→ Suggestion #4).
- `timeAgo` unused default export (→ Nit #3); ActivityFeedV2 double blank line (→ Nit #4); index.css comment accuracy (→ Nit #5).
- Checked and fine: `SHORT_QUERY` naming/placement matches `DESKTOP_QUERY`/`WIDE_QUERY` convention; `MOBILE_COMPACT_LAYOUT` fully re-specifying `seats`/`pile` matches how `DESKTOP_LAYOUT` is written; the hand-tuned pixel literals are the file's established style; `eslint dev-dist` ignore is straightforward and well-commented.

## Documentation

- **HIGH**: CLAUDE.md's Quick Select description ("Reset and Sort live in a separate right-aligned row below the chips") is now factually wrong.
- **HIGH**: CLAUDE.md's v2 architecture section omits the new third breakpoint (`useIsShortViewport`, 760px height) and third layout object (`MOBILE_COMPACT_LAYOUT`), while claiming `useMediaQuery.js` defines exactly two breakpoints.
- **MEDIUM (optional)**: one-line `timeAgo.js` entry in Utils & Constants.
- Checked and fine: README.md, client/README.md, and all `docs/*.md` contain nothing this PR invalidates; all in-code doc references in the diff point to real files.

## Files Changed

| File | Change |
|---|---|
| `client/src/components/tableV2/layout.js` | Pile frame anchored top+bottom with max/min height; `banner: null`; new `MOBILE_COMPACT_LAYOUT` tier |
| `client/src/components/tableV2/GameTableMobile.jsx` | Selects layout tier via `useIsShortViewport`; StatusBanner moved into the bottom stack's normal flow |
| `client/src/components/tableV2/CenterPile.jsx` | `DEFAULT_FRAME` updated to mirror the new anchored frame |
| `client/src/components/tableV2/ControlsRow.jsx` | Sort/Reset pinned into the chips row; edge-fade mask on the scroll area |
| `client/src/components/tableV2/HandCardFaceV2.jsx` | Tightened corner label for rank "10" so it doesn't clip in a 13-card hand |
| `client/src/hooks/useMediaQuery.js` | New `SHORT_QUERY` (max-height 760px) + `useIsShortViewport` |
| `client/src/index.css` | `.h-screen-safe`/`.min-h-screen*` prefer `100svh`; (32bc479) new `.bottom-safe-20` helper |
| `client/src/components/PWAUpdatePrompt.jsx` | Toasts moved to bottom placement; wrapper `pointer-events-none`; offline toast auto-dismisses; (32bc479) plain-CSS positioning class |
| `client/src/components/Lobby.jsx` | "Room not found" suppression via `isJoiningRef`; error toasts auto-dismiss after 5s |
| `client/src/utils/timeAgo.js` | New shared compact relative-time util (extracted from ActivityFeedV2) |
| `client/src/components/tableV2/ActivityFeedV2.jsx` | Inline `timeAgo` removed in favor of the shared util |
| `client/src/components/tableV2/HomeScreenV2.jsx` | Recent-games timestamps use shared `timeAgo` (also fixes latent "NaNm ago") |
| `client/eslint.config.js` | Ignore generated `dev-dist/` |
| `server/test/export.test.js` | (600708e) Sweep-tamper test anchored at last PLAY ply — de-flakes lone-2♠ endings |
