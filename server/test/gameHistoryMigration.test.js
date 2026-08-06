// server/test/gameHistoryMigration.test.js
//
// game_history.bot_difficulty is the first migrated column to sit on the
// game-start critical path. saveGameHistory names it unconditionally in its
// INSERT, so a database that never received the ALTER does not merely lose a
// badge -- the write throws, and in server/index.js it throws inside a
// withTransaction that also carries the opening game_participants rows. The
// game would then be invisible: sweepAbandonedGames() only updates rows that
// reached 'in_progress', and no row was ever written.
//
// So what is pinned here is the same thing publicRankMigration.test.js and
// gamelogMigration.test.js pin for their stores: build the legacy schema on
// disk, point db.js at it, and assert that a real write survives.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const tmpDir = fs.mkdtempSync(path.join(
    os.tmpdir(), 'game-history-migration-test-'));
const dbPath = path.join(tmpDir, 'database.sqlite');
process.env.DATABASE_PATH = dbPath;

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, err => err ? reject(err) : resolve());
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const close = (db) => new Promise((resolve) => db.close(() => resolve()));

let migrated;

test.before(async () => {
    // game_history exactly as it stood before this feature: no bot_difficulty.
    const legacy = new sqlite3.Database(dbPath);
    await run(legacy, `CREATE TABLE game_history (
        game_id TEXT PRIMARY KEY,
        room_name TEXT,
        game_mode TEXT NOT NULL,
        is_public INTEGER DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN ('completed', 'abandoned', 'in_progress')),
        winner_id INTEGER,
        winner_username TEXT,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        duration_seconds INTEGER,
        total_rounds INTEGER DEFAULT 0,
        max_points INTEGER
    )`);
    // A row written by the old build, to prove the ALTER preserves history
    // rather than recreating the table.
    await run(legacy, `INSERT INTO game_history
        (game_id, room_name, game_mode, status, start_time, total_rounds, max_points)
        VALUES ('legacy_game', 'OLD', 'short', 'completed',
                '2026-01-01T00:00:00.000Z', 5, 50)`);
    await close(legacy);

    migrated = require('../db');

    await new Promise((resolve) => {
        const poll = () => migrated.db.all(
            `PRAGMA table_info(game_history)`,
            (err, columns) => (!err && columns.some(c => c.name === 'bot_difficulty'))
                ? resolve()
                : setTimeout(poll, 20)
        );
        poll();
    });
});

test.after(async () => {
    await close(migrated.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the ALTER adds the column to a legacy game_history', async () => {
    const columns = await new Promise((resolve, reject) => {
        migrated.db.all(`PRAGMA table_info(game_history)`,
            (err, rows) => err ? reject(err) : resolve(rows));
    });
    assert.ok(columns.some(c => c.name === 'bot_difficulty'));
});

test('rows written before the migration survive it, reading NULL', async () => {
    const row = await get(migrated.db,
        `SELECT total_rounds, bot_difficulty FROM game_history WHERE game_id = ?`,
        ['legacy_game']);
    assert.strictEqual(row.total_rounds, 5);
    // Unknown, not "full strength". Never backfilled -- see docs/BOT-DIFFICULTY.md.
    assert.strictEqual(row.bot_difficulty, null);
});

test('a real write naming the new column succeeds against the migrated database', async () => {
    // The assertion that matters. Without the ALTER this rejects with
    // "table game_history has no column named bot_difficulty", which in
    // production rolls back the opening participant rows with it.
    await migrated.saveGameHistory({
        gameId: 'migrated_game',
        roomName: 'NEW',
        gameMode: 'short',
        isPublic: true,
        status: 'in_progress',
        winnerId: null,
        winnerUsername: null,
        startTime: '2026-02-01T00:00:00.000Z',
        endTime: null,
        durationSeconds: null,
        totalRounds: 0,
        maxPoints: 50,
        botDifficulty: 'competitive'
    });

    const row = await get(migrated.db,
        `SELECT bot_difficulty FROM game_history WHERE game_id = ?`,
        ['migrated_game']);
    assert.strictEqual(row.bot_difficulty, 'competitive');
});
