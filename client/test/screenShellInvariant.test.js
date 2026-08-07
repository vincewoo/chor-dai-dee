import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// One invariant, asserted here because nothing else can:
//
//   the element that carries a screen's backdrop must never be the element
//   that scrolls.
//
// Break it and the backdrop is sized to the scroll *port* — one viewport —
// while the content inside is `min-h-full` and free to be taller. Past one
// viewport the vignette tint (`inset-0`, so also one viewport) stops, and the
// base gradient starts tiling a second copy of itself, because
// `background-repeat` defaults to `repeat` and a gradient is an image like any
// other. Both land on the same line and draw a hard horizontal seam. The same
// mistake on the X axis makes the glow and watermarks — which bleed past both
// edges by design — horizontally scrollable instead of clipped.
//
// `ScreenShell` exists to make that unrepresentable, but only for screens that
// use it. A new screen hand-rolling `overflow-y-auto` with its own background
// reintroduces both bugs, and the failure is silent: no build error, no lint
// error, no runtime warning — just a visual break that only a human scrolling
// to the bottom on a phone would ever notice. This test is the guardrail.
//
// It is a source scan, in the style of safeAreaHelpers.test.js, because the
// client suite is `node --test` over pure modules with no DOM (CLAUDE.md:
// "pure utils only"). Standing up jsdom to assert one DOM relationship would
// cost far more than it protects.

const here = dirname(fileURLToPath(import.meta.url));
const tableV2 = join(here, '..', 'src', 'components', 'tableV2');

// ScreenShell owns the scroller. HomeScreenV2 is the one deliberate exception:
// it predates the shell and hand-rolls the same split — a non-scrolling root
// carrying the backdrop, with the scroller as an inner `flex-1` child. (The
// bottom tab bar that originally forced that shape now lives in AppShell as
// the layout route's own in-flow bottom row; the home screen kept its
// hand-rolled split rather than migrating for no visual change.) It is a
// correct instance of the invariant, not a violation of it. Adding a name here
// should take a comment saying which of those it is.
const EXEMPT = new Set(['ScreenShell.jsx', 'HomeScreenV2.jsx']);

const screens = readdirSync(tableV2)
    .filter((f) => f.endsWith('.jsx') && !EXEMPT.has(f));

test('no tableV2 screen outside ScreenShell rolls its own full-screen scroller', () => {
    assert.ok(screens.length > 10, 'found the tableV2 components to scan');

    const offenders = screens.filter((f) =>
        readFileSync(join(tableV2, f), 'utf8').includes('overflow-y-auto')
    );

    assert.deepEqual(
        offenders,
        [],
        'these files declare their own overflow-y-auto — route the screen through ' +
        'ScreenShell instead, or its backdrop will be one viewport tall while its ' +
        'content is not'
    );
});

test('the exempt files are still the ones we think they are', () => {
    // A rename would otherwise silently widen the exemption to nothing, and the
    // test above would keep passing while guarding a file that no longer exists.
    for (const name of EXEMPT) {
        assert.ok(
            readdirSync(tableV2).includes(name),
            `${name} is exempted but no longer exists — update EXEMPT`
        );
    }

    // HomeScreenV2 is exempt because it hand-rolls the split, not because it is
    // allowed to break it. If its root ever stops being a non-scrolling
    // overflow-hidden box, the exemption is wrong.
    const home = readFileSync(join(tableV2, 'HomeScreenV2.jsx'), 'utf8');
    assert.match(
        home,
        /className="relative flex h-full w-full flex-col overflow-hidden/,
        'HomeScreenV2 root must stay a non-scrolling overflow-hidden column shell'
    );
});
