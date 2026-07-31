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
});

test('index.html theme and tile colors match FELT_EDGE', () => {
    const html = read('index.html');
    for (const name of ['theme-color', 'msapplication-TileColor']) {
        const m = new RegExp(`name="${name}"\\s+content="(#[0-9a-fA-F]{6})"`).exec(html);
        assert.ok(m, `${name} meta tag is present`);
        assert.equal(m[1].toLowerCase(), FELT_EDGE.toLowerCase(), `${name} matches FELT_EDGE`);
    }
});

test('index.html declares no hand-written manifest link', () => {
    // vite-plugin-pwa injects one; per spec the FIRST rel=manifest in tree
    // order wins, so a hand-written link silently overrides every value in
    // vite.config.js — which is exactly what a stale public/manifest.json did.
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(html, /<link[^>]*rel=["']manifest["']/i);
});
