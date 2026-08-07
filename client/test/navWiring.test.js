import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The tab-root / drill-in contract, pinned at its wiring points. The rule
// (CLAUDE.md, "Navigation model: tabs + stacks") is: tab roots pass
// onBack={null} and draw no arrow — the persistent bar is the way out — while
// drill-ins get a history-based goBack. Nothing type-checks any of this, so a
// silent revert (an always-shown arrow, or a drill-in losing its way back)
// would pass the suite without these scans.

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const read = (p) => readFileSync(join(src, p), 'utf8');

test('tab-root containers pass onBack={null}', () => {
    for (const file of ['components/Leaderboard.jsx', 'components/ActivityFeed.jsx']) {
        assert.match(read(file), /onBack=\{null\}/, `${file} is a tab root`);
    }
});

test('Stats splits tab root from drill-in on the url param', () => {
    // /stats (own, via the tab) hides the arrow; /stats/:username is a
    // drill-in whose arrow walks history.
    assert.match(
        read('components/Stats.jsx'),
        /onBack=\{urlUsername \? goBack : null\}/,
        'Stats.jsx keeps the tab-root/drill-in split'
    );
});

test('BackButton renders nothing without an onClick', () => {
    assert.match(
        read('components/tableV2/BackButton.jsx'),
        /if \(!onClick\) return null;/,
        'the null-onBack contract lives inside BackButton'
    );
});

test('no tableV2 screen hand-rolls its own back arrow', () => {
    // Every ‹ arrow goes through BackButton, so the tab-root rule above cannot
    // be bypassed by one screen drawing its own always-visible button.
    const dir = join(src, 'components', 'tableV2');
    const offenders = readdirSync(dir)
        .filter((f) => f.endsWith('.jsx') && f !== 'BackButton.jsx')
        .filter((f) => /aria-label="Back"/.test(readFileSync(join(dir, f), 'utf8')));
    assert.deepEqual(offenders, [], 'these files draw an inline back arrow — use BackButton');
});
