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
    await run(legacy, `INSERT INTO users (id, username) VALUES
        (1, 'PlacedMiddle'),
        (2, 'UnfinishedPlacement'),
        (3, 'PlacedHigh')`);
    await run(legacy, `CREATE TABLE bot_calibration (
        user_id INTEGER PRIMARY KEY,
        skill_mu REAL NOT NULL,
        skill_sigma REAL NOT NULL,
        completed_games INTEGER NOT NULL DEFAULT 0,
        meaningful_decisions INTEGER NOT NULL DEFAULT 0,
        completed_rounds INTEGER NOT NULL DEFAULT 0,
        last_temperature REAL NOT NULL,
        calibration_complete INTEGER NOT NULL DEFAULT 0,
        controller_version INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(legacy, `INSERT INTO bot_calibration
        (user_id, skill_mu, skill_sigma, completed_games,
         meaningful_decisions, completed_rounds, last_temperature,
         calibration_complete, controller_version)
        VALUES
        (1, 0.5, 0.1, 5, 80, 15, 8, 1, 1),
        (2, 0.5, 0.3, 3, 20, 6, 10, 0, 1),
        (3, 0.9, 0.1, 8, 120, 24, 4, 1, 1)`);

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
        // One completed player lands in Silver, one incomplete player has a
        // top-tier score that must be discarded, and one completed high-score
        // player proves that the placement cap is applied.
        await run(
            legacy,
            `INSERT INTO ${table}
                (user_id, games_played, rating_mu, rating_sigma)
             VALUES
                (1, 12, 32.5, ?),
                (2, 3, 50, ?),
                (3, 8, 50, ?)`,
            [25 / 3, 25 / 3, 25 / 3]);
    }
    await new Promise((resolve, reject) =>
        legacy.close(err => err ? reject(err) : resolve()));

    migratedDb = require('../db').db;
    const waitForColumns = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const columns = await all(
                migratedDb, 'PRAGMA table_info(stats_standard)');
            const placementColumn = columns.some(
                column => column.name === 'rank_placement_complete');
            let migration = null;
            try {
                migration = await get(
                    migratedDb,
                    `SELECT key FROM schema_meta
                     WHERE key = 'reset_incomplete_rank_placements_v1'`
                );
            } catch {
                // schema_meta is created asynchronously during startup.
            }
            if (placementColumn && migration) {
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

test('rank migration resets unfinished placements and caps completed ones', async () => {
    for (const table of ['stats', 'stats_short', 'stats_standard']) {
        const rows = await all(
            migratedDb,
            `SELECT user_id, public_rank, promotion_progress,
                    demotion_progress, rank_placement_complete
             FROM ${table}
             ORDER BY user_id`);
        assert.deepStrictEqual(rows, [
            {
                user_id: 1,
                public_rank: 2,
                promotion_progress: 0,
                demotion_progress: 0,
                rank_placement_complete: 1
            },
            {
                user_id: 2,
                public_rank: 0,
                promotion_progress: 0,
                demotion_progress: 0,
                rank_placement_complete: 0
            },
            {
                user_id: 3,
                public_rank: 4,
                promotion_progress: 0,
                demotion_progress: 0,
                rank_placement_complete: 1
            }
        ]);

        const unfinished = await get(
            migratedDb,
            `SELECT rating_mu, rating_sigma
             FROM ${table}
             WHERE user_id = 2`
        );
        assert.strictEqual(unfinished.rating_mu, 25);
        assert.ok(Math.abs(unfinished.rating_sigma - 25 / 3) < 1e-9);

        const completed = await get(
            migratedDb,
            `SELECT rating_mu
             FROM ${table}
             WHERE user_id = 3`
        );
        assert.strictEqual(completed.rating_mu, 50);
    }

    const unfinishedCalibration = await get(
        migratedDb,
        `SELECT completed_games, meaningful_decisions, completed_rounds,
                last_temperature, calibration_complete
         FROM bot_calibration
         WHERE user_id = 2`
    );
    assert.deepStrictEqual(unfinishedCalibration, {
        completed_games: 0,
        meaningful_decisions: 0,
        completed_rounds: 0,
        last_temperature: 10,
        calibration_complete: 0
    });

    const completedCalibration = await get(
        migratedDb,
        `SELECT completed_games, calibration_complete
         FROM bot_calibration
         WHERE user_id = 3`
    );
    assert.deepStrictEqual(completedCalibration, {
        completed_games: 8,
        calibration_complete: 1
    });
});
