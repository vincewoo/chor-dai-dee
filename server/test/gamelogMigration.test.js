// server/test/gamelogMigration.test.js
//
// Additive columns must reach a gamelog.sqlite that already exists.
//
// This is its own file because it needs GAMELOG_PATH pointed at a database
// built with the *previous* schema before gamelog.js is required, and that
// module reads the path once at load time.
//
// The failure this guards against is silent and total. createSchema only runs
// CREATE TABLE IF NOT EXISTS, which is a no-op on an existing table, so a
// column added to the SCHEMA array alone never lands on the production volume.
// Every write then fails with "no such column" -- and because the write path is
// wrapped in guard(), that error is caught and logged rather than raised. The
// game keeps playing, nobody sees an error, and the corpus quietly stops
// recording seats. Deleting ensureColumns would leave every other test in the
// suite passing, because they all build their database from scratch.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelog-migration-'));
const dbPath = path.join(tmpDir, 'gamelog.sqlite');

// The schema as it shipped in version 1: no mlog_seat.difficulty, no
// mlog_game.weakened_bots. Written before gamelog.js is required.
const V1_SCHEMA = [
    `CREATE TABLE mlog_game (
        game_key          INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id           TEXT    NOT NULL UNIQUE,
        room_id           TEXT    NOT NULL,
        game_mode         TEXT    NOT NULL,
        point_threshold   INTEGER NOT NULL,
        advanced_bots     INTEGER NOT NULL DEFAULT 0,
        schema_version    INTEGER NOT NULL,
        rules_version     INTEGER NOT NULL,
        server_build      TEXT,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER,
        end_reason        TEXT,
        abandon_reason    TEXT,
        total_rounds      INTEGER NOT NULL DEFAULT 0,
        winner_seat       INTEGER,
        previous_game_key INTEGER,
        chain_kind        TEXT
    )`,
    `CREATE TABLE mlog_seat (
        game_key        INTEGER NOT NULL,
        seat            INTEGER NOT NULL,
        segment         INTEGER NOT NULL DEFAULT 0,
        from_round      INTEGER NOT NULL,
        to_round        INTEGER,
        occupant        TEXT    NOT NULL,
        subject_key     TEXT,
        policy_gen      INTEGER,
        policy_ref      TEXT,
        user_id         INTEGER,
        rating_mu       REAL,
        rating_sigma    REAL,
        joined_mid_game INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_key, seat, segment)
    )`,
    `INSERT INTO mlog_game
        (game_id, room_id, game_mode, point_threshold, schema_version,
         rules_version, started_at)
     VALUES ('legacy-game', 'OLD', 'short', 50, 1, 1, 1000)`,
    `INSERT INTO mlog_seat
        (game_key, seat, segment, from_round, occupant, subject_key)
     VALUES (1, 0, 0, 1, 'bot_ppo', 'Bot 2')`
];

function buildLegacyDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) return reject(err);
            db.serialize(() => {
                let pending = V1_SCHEMA.length;
                let failed = null;
                for (const statement of V1_SCHEMA) {
                    db.run(statement, (stepErr) => {
                        if (stepErr && !failed) failed = stepErr;
                        if (--pending === 0) {
                            db.close(() => failed ? reject(failed) : resolve());
                        }
                    });
                }
            });
        });
    });
}

test('an existing v1 database gains the difficulty columns', async () => {
    await buildLegacyDatabase();

    process.env.GAMELOG_PATH = dbPath;
    process.env.GAMELOG_ENABLED = '1';
    const gamelog = require('../gamelog');

    // A real guarded write. If the migration had not run, guard() would swallow
    // the "no such column" error and hand back null -- exactly the silent
    // failure this test exists to catch, so assert on the return value rather
    // than merely on the absence of a throw.
    const gameKey = await gamelog.openGame(
        {
            gameId: 'post-migration',
            roomId: 'NEW',
            gameMode: 'short',
            pointThreshold: 50,
            startedAt: 2000
        },
        [{
            seat: 0,
            fromRound: 1,
            occupant: 'bot_ppo',
            subjectKey: 'Bot 2',
            policyGen: 14,
            policyRef: 'ppo-policy-gpu-v1.json',
            difficulty: 'casual'
        }]
    );
    assert.ok(gameKey > 0, 'the seat write was swallowed by guard()');

    const { get } = await gamelog.openForRead();

    const migrated = await get(
        'SELECT difficulty FROM mlog_seat WHERE game_key = ? AND seat = 0',
        [gameKey]);
    assert.strictEqual(migrated.difficulty, 'casual');
    assert.strictEqual(
        (await get('SELECT weakened_bots FROM mlog_game WHERE game_key = ?',
            [gameKey])).weakened_bots, 1);

    // Rows written before tiers existed read as full strength, which is
    // historically accurate -- there was nothing else to be.
    const legacySeat = await get(
        'SELECT difficulty FROM mlog_seat WHERE game_key = 1 AND seat = 0');
    assert.strictEqual(legacySeat.difficulty, null);
    assert.strictEqual(
        (await get('SELECT weakened_bots FROM mlog_game WHERE game_key = 1'))
            .weakened_bots, 0);
});
