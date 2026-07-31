import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The safe-area helpers in index.css are hand-authored rules, not Tailwind
// utilities, so nothing checks either direction of their contract:
//
//  - a class referenced in JSX but never declared silently does nothing. No
//    build error, no lint error — and it fails in an installed iOS PWA, the one
//    environment with no devtools, where every hypothesis costs a deploy.
//  - a rule declared but no longer referenced is never purged (Tailwind's
//    content scan only removes ITS OWN utilities), so it ships forever and
//    leaves the next reader unsure which helpers are load-bearing.
//
// Both directions are asserted here.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

const HELPER = /\b((?:pb|pt|mt|bottom)-safe(?:-[\w.]+)?)(?![\w-])/g;

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(jsx?|css)$/.test(entry) ? [full] : [];
    });
}

const files = walk(srcDir);
const cssPath = join(srcDir, 'index.css');
const css = readFileSync(cssPath, 'utf8');

const declared = new Set(
    [...css.matchAll(/^\s*\.((?:pb|pt|mt|bottom)-safe(?:-[\w.]+)?)\s*(?:\{|,)/gm)].map((m) => m[1])
);

const referenced = new Map();
for (const file of files) {
    if (file === cssPath) continue;
    for (const [, cls] of readFileSync(file, 'utf8').matchAll(HELPER)) {
        if (!referenced.has(cls)) referenced.set(cls, []);
        referenced.get(cls).push(file.slice(srcDir.length + 1));
    }
}

test('every safe-area helper used in the app is declared in index.css', () => {
    assert.ok(declared.size > 0, 'index.css declares safe-area helpers');
    const dangling = [...referenced.entries()]
        .filter(([cls]) => !declared.has(cls))
        .map(([cls, where]) => `${cls} (used in ${where.join(', ')})`);
    assert.deepEqual(dangling, [], 'these classes are referenced but never declared — they do nothing');
});

test('every safe-area helper declared in index.css is still used', () => {
    const dead = [...declared].filter((cls) => !referenced.has(cls));
    assert.deepEqual(dead, [], 'these rules ship in the bundle with no consumer — delete them');
});
