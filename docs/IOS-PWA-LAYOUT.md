# Layout in the installed iOS PWA

The app is installed to the home screen with `viewport-fit=cover`
(`client/index.html`). That mode has layout behaviour a browser tab does not,
and it has now cost several rounds of deploy-and-check. This is the record of
what was measured, so the next change does not rediscover it.

## The rule, scoped to what was actually measured

**A `position: fixed` element anchored by `bottom` *alone* does not reach the
bottom of the screen.** One case was measured end to end (below): the home
screen's tab bar, `fixed inset-x-0 bottom-0` with auto height, landed one
`env(safe-area-inset-top)` — 62pt — above the physical bottom edge.

The fix that shipped is to put such an element in **normal flow as the last row
of a full-height column**. In flow it lands on the physical bottom edge, and its
own `padding-bottom: env(safe-area-inset-bottom)` paints its background through
the home-indicator band. That padding is what `.pb-safe-bar`
(`client/src/index.css`) is for.

### What this rule does NOT say

It does **not** say "never use `position: fixed`". Two shells in this repo are
deliberately fixed and anchored at `top` *and* `bottom`, and their comments say
that is precisely what makes them reach the physical edge reliably:

- `.game-screen-safe` (`client/src/index.css`)
- `GameTableMobile`'s root style (`client/src/components/tableV2/`)

Those comments and this document are in unresolved tension, and **nobody should
convert those two to flow on the strength of this document.** The obvious
structural difference is bottom-only versus top-and-bottom anchoring — an
element with both edges pinned has its height derived from the pair, so a
mis-resolved bottom would also show up as a wrong height, which is not what was
observed. That is a plausible explanation, **not a measured one.** Nothing in
the repo distinguishes it from the alternative (that the fixed shells are also
short and it has not been noticed).

The tension runs the other way too: this document's fix makes the tab bar's
position depend on the `html/body/#root { height: 100% }` percentage chain,
while `index.css` warns that WebKit reports heights "with safe-area space
already removed in an installed PWA". If that warning applies to percentage
heights and not just viewport units, the flow fix lands the bar in the same
wrong place *and* steals ~60pt from the scroller. The browser verification of
this change cannot distinguish those cases, because the insets are zero outside
a standalone PWA.

**Before extending this rule anywhere, measure that surface on-device** with
the pixel-column method below. This document is a record of one measurement and
one fix, not a theory of WebKit.

## How it was measured

From an on-device screenshot of the home screen (iPhone 16 Pro, 1206x2622,
`@3x`, so 402x874pt), sampling the pixel column at `x=20`:

| Band | y (px) | Colour | What it is |
|---|---|---|---|
| page | ...–2177 | `(28,55,38)` | felt gradient |
| hairline | 2178–2180 | `(35,51,41)` | the nav's `borderTop` |
| nav | 2181–2435 | `(16,30,21)` | `rgba(8,26,18,.82)` over felt |
| page | 2436–2621 | `(24,57,39)` | felt gradient, *continuing* |

Two things fall out of that:

- The nav box was **85pt** tall (rows 2181–2435 = 255px @3x) — exactly
  `7` (`pt-[7px]`) + `44` (button `minHeight`) + `34`
  (`env(safe-area-inset-bottom)`), with the 1pt `borderTop` counted separately
  as the hairline row above it. So the bottom inset was being read correctly;
  `.pb-safe-bar` was not the bug.
- The same felt gradient continued for **186px = 62pt below** the bar, to the
  physical bottom. The page reached the screen edge; the `position: fixed`
  bar did not. 62pt is `env(safe-area-inset-top)` on this device in standalone
  (taller than the 59pt Safari reports).

The gap equalled the *top* inset, on the *bottom* edge.

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

The decorative layers (tint, radial glow, both `SuitWatermark`s) are siblings
of the scroller, not children of it, so they are now **pinned to the viewport
frame and no longer scroll with the content**. That is a deliberate consequence
of the root ceasing to be the scroller: the tint now covers the visible area at
all scroll offsets, and the `top: 520` watermark is simply not reachable on
viewports shorter than ~690px. Both are background decoration at ≤0.03 opacity.

## Still out of flow

Everything still bottom-anchored and out of flow, and why it was left:

| Where | What | Why it was left |
|---|---|---|
| `index.css` `.game-screen-safe`, `GameTableMobile` root | `fixed`, `top` **and** `bottom` | Deliberate, with opposing reasoning in their own comments. Unmeasured. See the scoping section above — do not convert these without a device measurement. |
| `StatsV2.jsx` detail sheet | `fixed`, `bottom: 0`, **no `env()` anywhere in the file** | Bottom-only, i.e. the exact shape that was measured broken. Genuinely suspect; nobody has looked at it on-device. |
| `RoundLogSheet.jsx` | `bottom: 0` | Lives *inside* the already-fixed `.game-screen-safe` shell, so it inherits that containing block rather than the fixed viewport. Different case, probably fine. |
| `PWAUpdatePrompt` toast | `fixed`, `.bottom-safe-20` | Transient overlay; ~60pt high is cosmetic. |

`LeaderboardV2`'s "me" row is **not** in this list and must not be added to it:
it is `position: sticky` inside its own scroller (`LeaderboardV2.jsx`), chosen
specifically because absolute-in-a-scroller was this same family of bug.
`sticky` does not share `fixed`'s failure mode here.

If the in-game table shows the same band of felt below its controls, the fix is
probably the same shape as the home screen's — but measure first, because its
comments claim the opposite and they may be right.

## Unresolved

- **The measurement above predates a fix already on `main`.** `1c3489f` changed
  `apple-mobile-web-app-status-bar-style` from `black-translucent` to `black`
  to address the same symptom by a different mechanism, and the screenshot
  still shows content painting under the status bar — i.e. translucent
  behaviour — so it was taken on a build without that change, or on an
  installed app serving a cached `index.html`. **It is not established that the
  gap still existed when the flow fix was written.** The flow fix is right
  regardless of which mechanism was operative, but if a future change needs to
  know which one actually mattered, that answer is not in this document.
- `client/index.html` keeps `apple-mobile-web-app-status-bar-style: black`.
  That change has not been confirmed on device either.
  `qbk-scheduler` uses `black-translucent` successfully *because* it has
  nothing out of flow. Once the fixed-position dependencies above are gone,
  reverting to `black-translucent` is the change that restores felt under the
  status bar instead of a black band.
- There are no devtools on an installed iOS PWA. Every hypothesis here costs a
  deploy. Prefer changes that are correct by construction (normal flow) over
  changes that are correct by inset arithmetic.
