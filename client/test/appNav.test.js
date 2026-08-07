import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_TABS, activeTabFor, resolveBackTarget } from '../src/utils/appNav.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');

test('every tab path maps back to its own tab', () => {
    for (const tab of APP_TABS) {
        assert.equal(activeTabFor(tab.path), tab.key, tab.path);
    }
});

test('drill-in pages highlight the tab they are conceptually under', () => {
    assert.equal(activeTabFor('/stats/somebody'), 'stats');
    assert.equal(activeTabFor('/training'), 'stats');
    assert.equal(activeTabFor('/review/abc123'), 'activity');
    assert.equal(activeTabFor('/profile'), 'home');
    assert.equal(activeTabFor('/avatar'), 'home');
});

test('prefix matching is on path segments, not raw strings', () => {
    // A route that merely starts with a tab's characters is not that tab.
    assert.equal(activeTabFor('/statsish'), null);
    assert.equal(activeTabFor('/lobbyist'), null);
});

test('screens outside the shell light nothing', () => {
    assert.equal(activeTabFor('/'), null);
    assert.equal(activeTabFor('/game/ABCDE'), null);
});

// The branch every drill-in's back arrow rides on. Popping from the first
// history entry (react-router keys it 'default') would leave the app, so it
// must resolve to a REPLACE to the fallback — and only that entry may.
test('back from the first history entry replaces to the fallback', () => {
    assert.deepEqual(resolveBackTarget('default'), { replaceTo: '/lobby' });
    assert.deepEqual(resolveBackTarget('default', '/activity'), { replaceTo: '/activity' });
});

test('back from any later history entry pops', () => {
    assert.deepEqual(resolveBackTarget('abc123'), { pop: true });
    assert.deepEqual(resolveBackTarget('abc123', '/activity'), { pop: true });
});

// NAV_ICONS lives in NavIcon.jsx and the tab definitions here — two files
// where there used to be one. NavIcon silently renders an empty <svg> for an
// unknown name, so a typo on either side ships with no error anywhere else.
test('every tab icon exists in NavIcon.jsx', () => {
    const src = read('src/components/tableV2/NavIcon.jsx');
    const iconsBlock = /const NAV_ICONS = \{([\s\S]*?)\n\};/.exec(src);
    assert.ok(iconsBlock, 'NAV_ICONS is declared in NavIcon.jsx');
    const names = [...iconsBlock[1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    assert.ok(names.length > 0, 'NAV_ICONS has entries');
    for (const tab of APP_TABS) {
        assert.ok(names.includes(tab.icon), `icon "${tab.icon}" for tab "${tab.key}" exists`);
    }
});

// Every route rendered inside the AppShell layout route must light a tab, or
// the bar silently shows no active state on that screen. Scanned from App.jsx
// so a route added to the shell without a TAB_BY_PREFIX entry fails here.
test('every AppShell route resolves to a tab', () => {
    const app = read('src/App.jsx');
    const shellBlock = /<Route element=\{<AppShell \/>\}>([\s\S]*?)<\/Route>/.exec(app);
    assert.ok(shellBlock, 'the AppShell layout route exists in App.jsx');
    const paths = [...shellBlock[1].matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(paths.length >= 9, `found the shell routes (got ${paths.length})`);
    for (const path of paths) {
        // Substitute route params with a plausible literal segment.
        const concrete = path.replace(/:[^/]+/g, 'x');
        assert.notEqual(activeTabFor(concrete), null, `${path} lights a tab`);
    }
});
