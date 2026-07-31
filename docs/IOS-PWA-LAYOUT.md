# Layout in the installed iOS PWA

The app is installed to the home screen with `viewport-fit=cover`
(`client/index.html`). That mode has layout behaviour a browser tab does not,
and it has now cost several rounds of deploy-and-check. This is the record of
what was measured, so the next change does not rediscover it.

## The one rule

**Anything anchored to the bottom of the screen must be in normal flow at the
end of a full-height column. Never `position: fixed; bottom: 0`.**

Two separate things go wrong with an out-of-flow bottom edge in a standalone
iOS PWA:

1. **The fixed viewport's bottom is not the screen's bottom.** It resolves one
   `env(safe-area-inset-top)` higher.
2. **iOS does not extend an out-of-flow element's background into the safe
   area.** Even positioned correctly, a fixed bar leaves the home-indicator
   band painted by whatever is behind it.

In flow, neither applies: the element lands on the physical bottom edge, and
its own `padding-bottom: env(safe-area-inset-bottom)` paints its background
through the home-indicator band. That padding is what `.pb-safe-bar`
(`client/src/index.css`) is for.

## How #1 was measured

From an on-device screenshot of the home screen (iPhone 16 Pro, 1206x2622,
`@3x`, so 402x874pt), sampling the pixel column at `x=20`:

| Band | y (px) | Colour | What it is |
|---|---|---|---|
| page | ...–2177 | `(28,55,38)` | felt gradient |
| hairline | 2178–2180 | `(35,51,41)` | the nav's `borderTop` |
| nav | 2181–2435 | `(16,30,21)` | `rgba(8,26,18,.82)` over felt |
| page | 2436–2621 | `(24,57,39)` | felt gradient, *continuing* |

Two things fall out of that:

- The nav was **86pt** tall — exactly `7` (`pt-[7px]`) + `44` (button
  `minHeight`) + `34` (`env(safe-area-inset-bottom)`). So the bottom inset was
  being read correctly; `.pb-safe-bar` was not the bug.
- The same felt gradient continued for **186px = 62pt below** the bar, to the
  physical bottom. The page reached the screen edge; the `position: fixed`
  bar did not. 62pt is `env(safe-area-inset-top)` on this device in standalone
  (taller than the 59pt Safari reports).

The gap equalled the *top* inset, on the *bottom* edge. That is the signature
of #1.

## Prior art

`qbk-scheduler` (a sibling project that ships as an installed iOS PWA) reached
the same conclusion from the opposite direction and wrote it up in
`docs/frontend/scroll-lock.md`. Its app shell is
`min-h-screen grid grid-rows-[auto_1fr_auto]` with **nothing** taken out of
flow, and it has no fixed bottom bar at all. Its documented failures — body
`position: fixed`, `#root` `position: fixed`, `html { overflow: hidden }` —
are all the same root cause: an out-of-flow element loses the safe-area
background extension. It also tried `env(safe-area-inset-bottom)` padding
twice and reverted both times, because padding never fixed a problem that was
really about flow.

## What the home screen does now

`client/src/components/tableV2/HomeScreenV2.jsx`:

```
<div class="relative flex h-full w-full flex-col overflow-hidden">   ← column shell, no scroll
  …decorative absolute layers…
  <div class="relative z-10 min-h-0 flex-1 overflow-y-auto">         ← the only scroller
    …page content…
  </div>
  <nav class="relative z-20 shrink-0 … pb-safe-bar md:hidden">       ← flow row, owns its inset
</div>
```

`min-h-0` on the scroller is load-bearing: without it a flex item refuses to
shrink below its content and the column grows past the viewport instead of
scrolling inside it.

The bar used to be `absolute` inside the scroller (it rode up onto the game
list once the page grew), then `fixed` (this bug). As the last row of the
column it can be neither.

## Still out of flow

These have **not** been converted and remain `position: fixed`:

- `.game-screen-safe` (`client/src/index.css`) and `GameTableMobile`'s root
  style — deliberately fixed, with their own reasoning in comments.
- `PWAUpdatePrompt`'s toast and `LeaderboardV2`'s floating button — transient
  overlays where being ~60pt high is cosmetic.

If the in-game table shows the same band of felt below its controls, this
document is the reason, and the fix is the same shape as above.

## Unresolved

- `client/index.html` sets `apple-mobile-web-app-status-bar-style` to `black`
  (it was `black-translucent`) specifically to dodge #1. That change has not
  been confirmed on device — the screenshot above still shows content painting
  under the status bar, i.e. translucent behaviour, either because the build
  predates it or because the installed app served a cached `index.html`.
  `qbk-scheduler` uses `black-translucent` successfully *because* it has
  nothing out of flow. Once the fixed-position dependencies above are gone,
  reverting to `black-translucent` is the change that restores felt under the
  status bar instead of a black band.
- There are no devtools on an installed iOS PWA. Every hypothesis here costs a
  deploy. Prefer changes that are correct by construction (normal flow) over
  changes that are correct by inset arithmetic.
