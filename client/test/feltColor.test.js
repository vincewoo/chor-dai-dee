import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FELT_EDGE } from '../src/theme/feltColor.js';

// The felt edge colour has to exist in places that cannot import a browser ES
// module: index.html's meta tags and index.css's body rule. Those copies are
// unavoidable, so they are asserted here instead — a future retune of the felt
// gradient is forced to touch every consumer or fail.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');

test('FELT_EDGE is the last stop of the felt gradient', () => {
    const theme = read('src/theme/tableTheme.js');
    const feltBase = /const FELT_BASE = '([^']+)'/.exec(theme);
    assert.ok(feltBase, 'FELT_BASE is declared in tableTheme.js');
    // Last colour stop in the gradient string.
    const stops = feltBase[1].match(/#[0-9a-fA-F]{6}/g);
    assert.ok(stops?.length, 'the gradient has hex stops');
    assert.equal(
        stops[stops.length - 1].toLowerCase(),
        FELT_EDGE.toLowerCase(),
        'FELT_EDGE must equal the outermost stop of FELT_BASE'
    );
});

test('the app shell background matches FELT_EDGE', () => {
    // Painted in the safe-area bands of a standalone PWA — the white-bars bug.
    const css = read('src/index.css');
    const bodyBg = /html,\s*body\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})/m.exec(css);
    assert.ok(bodyBg, 'html/body sets an explicit background-color');
    assert.equal(bodyBg[1].toLowerCase(), FELT_EDGE.toLowerCase());
});

test('the game shell is fixed to the viewport edges without a height unit', () => {
    const css = read('src/index.css');
    const shell = /\.game-screen-safe\s*\{([^}]*)\}/m.exec(css);
    assert.ok(shell, 'game-screen-safe is declared');
    assert.match(shell[1], /position:\s*fixed/);
    assert.match(shell[1], /top:\s*env\(safe-area-inset-top,\s*0px\)/);
    for (const edge of ['right', 'bottom', 'left']) {
        assert.match(shell[1], new RegExp(`${edge}:\\s*0`));
    }
    assert.doesNotMatch(shell[1], /\bheight\s*:/, 'viewport height units reintroduce the iOS PWA gap');

    const room = read('src/components/GameRoom.jsx');
    assert.equal(
        (room.match(/className="game-screen-safe\b/g) || []).length,
        2,
        'loading and active game shells both use the fixed viewport frame'
    );

    const mobile = read('src/components/tableV2/GameTableMobile.jsx');
    const tableRoot = /const rootStyle = useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[/m.exec(mobile);
    assert.ok(tableRoot, 'mobile table root style is declared');
    assert.match(tableRoot[1], /position:\s*'fixed'/);
    assert.match(tableRoot[1], /top:\s*'env\(safe-area-inset-top,\s*0px\)'/);
    for (const edge of ['right', 'bottom', 'left']) {
        assert.match(tableRoot[1], new RegExp(`${edge}:\\s*0`));
    }
    assert.match(
        tableRoot[1],
        /background:\s*`\$\{surface\.tint\},\$\{surface\.base\}`/,
        'the fixed table layer itself paints the felt to the bottom edge'
    );
});

test('the phone tab bar stays in normal flow', () => {
    // Measured on device: a `position: fixed; bottom: 0` bar in the installed
    // PWA lands one env(safe-area-inset-top) — 62pt — above the screen, with
    // the page painting underneath it, and an out-of-flow element does not get
    // its background extended into the home-indicator band either. Only a flow
    // row at the end of a full-height column gets both right. See
    // docs/IOS-PWA-LAYOUT.md.
    const home = read('src/components/tableV2/HomeScreenV2.jsx');

    const navs = [...home.matchAll(/<nav\s+className="([^"]*)"/g)].map((m) => m[1]);
    const bar = navs.find((c) => c.includes('pb-safe-bar'));
    assert.ok(bar, 'the phone tab bar is the nav carrying pb-safe-bar');
    assert.doesNotMatch(bar, /\bfixed\b/, 'a fixed bottom edge is wrong in the installed iOS PWA');
    assert.doesNotMatch(bar, /\babsolute\b/, 'absolute inside the scroller rides up onto the content');
    assert.match(bar, /\bshrink-0\b/, 'the bar must not be squeezed by the scroller');
    assert.match(bar, /\bmd:hidden\b/, 'desktop uses the header destinations instead');

    // className alone is not enough — an inline style={{position:'fixed'}} would
    // reintroduce the bug with every class assertion above still green.
    const barTag = /<nav\s+className="[^"]*pb-safe-bar[^"]*"[\s\S]*?>/.exec(home);
    assert.ok(barTag, 'the tab bar opening tag parses');
    assert.doesNotMatch(barTag[0], /position:\s*['"]?(fixed|absolute)/, 'no inline position override');

    // The column shell and the single scroller between its two flow rows. Token
    // checks, not whole ordered class-list literals, so reordering classes or
    // inserting one does not redden a behaviour-preserving refactor.
    const shellTag = /<div\s+className="([^"]*h-full[^"]*)"/.exec(home);
    assert.ok(shellTag, 'the column shell is the first classed div');
    for (const token of ['relative', 'flex', 'h-full', 'flex-col', 'overflow-hidden']) {
        assert.match(shellTag[1], new RegExp(`\\b${token}\\b`), `shell keeps ${token}`);
    }
    assert.doesNotMatch(shellTag[1], /\boverflow-y-auto\b/, 'the shell itself must not scroll');

    const scroller = /<div className="([^"]*\bflex-1\b[^"]*)">/.exec(home);
    assert.ok(scroller, 'the scroller is declared');
    for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto']) {
        assert.match(scroller[1], new RegExp(`\\b${token.replace('-', '-')}\\b`), `scroller keeps ${token}`);
    }

    // The property the whole change is about: the bar is a FOLLOWING SIBLING of
    // the scroller, not a descendant. Nested inside it, the bar scrolls away
    // with the content — the original "footer rides up onto the game list" bug,
    // which every assertion above would still pass.
    const scrollerOpen = home.indexOf(scroller[0]);
    const barOpen = home.indexOf(barTag[0]);
    assert.ok(scrollerOpen !== -1 && barOpen !== -1, 'both tags located');
    assert.ok(barOpen > scrollerOpen, 'the tab bar is written after the scroller');

    // Between the scroller's opening tag and the bar's, the <div>s must balance
    // with exactly one surplus close — the scroller's own. Fewer means the bar
    // is still nested inside it. Counted rather than string-matched on the
    // closing tag so re-indenting the block does not redden this.
    const between = home.slice(scrollerOpen + scroller[0].length, barOpen);
    const opens = (between.match(/<div\b(?![^>]*\/>)/g) || []).length;
    const closes = (between.match(/<\/div>/g) || []).length;
    assert.equal(
        closes - opens,
        1,
        'the tab bar must be a following SIBLING of the scroller, not a descendant — nested inside it, it scrolls away with the content'
    );

    const css = read('src/index.css');
    const rule = /\.pb-safe-bar\s*\{([^}]*)\}/m.exec(css);
    assert.ok(rule, 'pb-safe-bar is declared');
    assert.match(rule[1], /padding-bottom:\s*max\([^)]*env\(safe-area-inset-bottom\)\)/);
});

test('index.html theme and tile colors match FELT_EDGE', () => {
    const html = read('index.html');
    for (const name of ['theme-color', 'msapplication-TileColor']) {
        const m = new RegExp(`name="${name}"\\s+content="(#[0-9a-fA-F]{6})"`).exec(html);
        assert.ok(m, `${name} meta tag is present`);
        assert.equal(m[1].toLowerCase(), FELT_EDGE.toLowerCase(), `${name} matches FELT_EDGE`);
    }
});

test('the installed iOS PWA avoids black-translucent viewport geometry', () => {
    const html = read('index.html');
    const uncommented = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.match(
        uncommented,
        /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black"\s*\/?>/i
    );
    assert.doesNotMatch(
        uncommented,
        /apple-mobile-web-app-status-bar-style"[^>]+content="black-translucent"/i
    );
});

test('index.html declares no hand-written manifest link', () => {
    // vite-plugin-pwa injects one; per spec the FIRST rel=manifest in tree
    // order wins, so a hand-written link silently overrides every value in
    // vite.config.js — which is exactly what a stale public/manifest.json did.
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(html, /<link[^>]*rel=["']manifest["']/i);
});
