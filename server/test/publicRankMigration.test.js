const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const tmpDir = fs.mkdtempSync(path.join(
    os.tmpdir(), 'public-rank-migration-test-'));
const dbPath = path.join(tmpDir, 'database.sqlite');
process.env.DATABASE_PATH = dbPath;

let migratedDb;

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, err => err ? reject(err) : resolve());
});
const all = (db, sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
});
const get = (db, sql) => new Promise((resolve, reject) => {
    db.get(sql, (err, row) => err ? reject(err) : resolve(row));
});

test.before(async () => {
    const legacy = new sqlite3.Database(dbPath);
    await run(legacy, `CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT
    )`);
    await run(
        legacy,
        `INSERT INTO users (id, username) VALUES (1, 'LegacyGold')`);

    for (const table of ['stats', 'stats_short', 'stats_standard']) {
        await run(legacy, `CREATE TABLE ${table} (
            user_id INTEGER PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            rating_mu REAL DEFAULT 25,
            rating_sigma REAL DEFAULT 8.333,
            first_place INTEGER DEFAULT 0,
            second_place INTEGER DEFAULT 0,
            third_place INTEGER DEFAULT 0,
            fourth_place INTEGER DEFAULT 0,
            penalty_2x_rounds INTEGER DEFAULT 0,
            penalty_3x_rounds INTEGER DEFAULT 0,
            total_plays INTEGER DEFAULT 0,
            total_passes INTEGER DEFAULT 0,
            total_rounds INTEGER DEFAULT 0,
            leads_won INTEGER DEFAULT 0,
            lead_attempts INTEGER DEFAULT 0
        )`);
        // A hidden score of 1500 starts in Gold during the one-time backfill.
        await run(
            legacy,
            `INSERT INTO ${table}
                (user_id, games_played, rating_mu, rating_sigma)
             VALUES (1, 12, 32.5, ?)`,
            [25 / 3]);
    }
    await new Promise((resolve, reject) =>
        legacy.close(err => err ? reject(err) : resolve()));

    migratedDb = require('../db').db;
    const waitForColumns = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const columns = await all(
                migratedDb, 'PRAGMA table_info(stats_standard)');
            if (columns.some(column => column.name === 'demotion_progress')) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('public-rank migration did not finish');
    };
    await waitForColumns();
});

test.after(async () => {
    if (migratedDb) {
        await new Promise(resolve => migratedDb.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('existing shadow ratings receive an initial coarse public rank', async () => {
    for (const table of ['stats', 'stats_short', 'stats_standard']) {
        const row = await get(
            migratedDb,
            `SELECT public_rank, promotion_progress, demotion_progress
             FROM ${table} WHERE user_id = 1`);
        assert.deepStrictEqual(row, {
            public_rank: 2,
            promotion_progress: 0,
            demotion_progress: 0
        });
    }
});
