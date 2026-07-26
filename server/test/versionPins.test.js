// server/test/versionPins.test.js
//
// RULES_VERSION and BOT_LOGIC_VERSION are stamped on every logged game so the
// corpus stays interpretable years later. Both are hand-maintained, so both
// will eventually be forgotten on a commit that changes behaviour -- and a
// forgotten version is worse than no version, because it looks trustworthy
// while silently merging two different policies under one generation.
//
// These tests cannot tell a behavioural change from a comment fix. A human
// can. So they do not try to judge; they just make the question impossible to
// skip, the same way a snapshot test does.
//
// WHEN THIS TEST FAILS:
//   1. Did the change alter what the code plays or how hands compare?
//      - Yes: bump the constant and add a changelog line, then re-pin below.
//      - No (comments, renames, pure refactor): just re-pin below.
//   2. Re-pin by running:  node --test test/versionPins.test.js  and copying
//      the actual hash from the failure message.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { RULES_VERSION } = require('../game/Big2Rules');
const { BOT_LOGIC_VERSION } = require('../game/BotLogic');

const sha256 = (relPath) => crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '..', relPath)))
    .digest('hex');

// Hash of every file whose content can change replay or bot behaviour.
// Sorted, so adding a file to a group is a visible one-line diff.
const fingerprint = (relPaths) => crypto
    .createHash('sha256')
    .update([...relPaths].sort().map(p => `${p}:${sha256(p)}`).join('\n'))
    .digest('hex');

// --- Rules -----------------------------------------------------------------
// Covers hand validity/comparison and round scoring. The dragon rule lives in
// Big2Rules.isDragon; the 2S auto-pass and lead determination live in
// RoomManager, which is excluded deliberately -- it changes constantly for
// unrelated reasons, and `source`/`action` on the tape record those two rules
// explicitly rather than relying on replay to re-derive them.
const RULES_FILES = ['game/Big2Rules.js', 'game/Scoring.js', 'game/Deck.js'];
// Re-pinned when calculateRoundScores began passing isGuest/joinedMidGame
// through to the persistence layer. No scoring behaviour changed -- the points,
// card counts and multipliers are computed exactly as before -- so
// RULES_VERSION stays where it is.
const RULES_PIN = '679109ebc4aa29579533a88cb687fe067d6b66b6c8724f9ad8870212e056a5a2';

// --- Bot logic -------------------------------------------------------------
// BotLogic.js is the heuristics; BotContext.js is the observation they run on.
// Changing either changes what the bot plays.
const BOT_FILES = ['game/BotLogic.js', 'game/BotContext.js'];
// Re-pinned when SHED_VALUE_PER_CARD was added to the BotLogic export so
// MoveReview could anchor its "is this loss worth mentioning" floor on the cost
// model's own smallest unit rather than pick a number. Export-only: no
// scoring function, constant or branch was touched, so the bot plays exactly
// as before and BOT_LOGIC_VERSION stays.
const BOT_PIN = 'd66bf6290ce3bffcd77500c43a121296c0163b181191f8d07fdfb05bb5b67b23';

const explain = (label, constant, version, actual, pin) => `
${label} changed but ${constant} is still ${version}.

  expected ${pin}
  actual   ${actual}

If this change alters behaviour, bump ${constant} and add a changelog line
in the file where it is defined. If it does not (comments, renames, pure
refactor), leave the constant alone. Either way, update the pin in
test/versionPins.test.js to the actual hash above.
`;

test('RULES_VERSION covers the current rules source', () => {
    const actual = fingerprint(RULES_FILES);
    assert.strictEqual(
        actual, RULES_PIN,
        explain('Rules source', 'RULES_VERSION', RULES_VERSION, actual, RULES_PIN)
    );
});

test('BOT_LOGIC_VERSION covers the current bot source', () => {
    const actual = fingerprint(BOT_FILES);
    assert.strictEqual(
        actual, BOT_PIN,
        explain('Bot logic source', 'BOT_LOGIC_VERSION', BOT_LOGIC_VERSION, actual, BOT_PIN)
    );
});

test('version constants are positive integers', () => {
    for (const [name, value] of [['RULES_VERSION', RULES_VERSION],
                                 ['BOT_LOGIC_VERSION', BOT_LOGIC_VERSION]]) {
        assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
    }
});

test('every pinned file exists', () => {
    // A renamed file would otherwise fail with a confusing ENOENT from inside
    // the hash helper rather than naming the missing path.
    for (const relPath of [...RULES_FILES, ...BOT_FILES]) {
        assert.ok(
            fs.existsSync(path.join(__dirname, '..', relPath)),
            `${relPath} is pinned but does not exist -- update the file list`
        );
    }
});
