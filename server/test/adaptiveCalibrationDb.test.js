const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(
    os.tmpdir(), 'adaptive-calibration-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'database.sqlite');

const {
    db,
    createUser,
    getUserPreferences,
    getBotCalibration,
    saveBotCalibration,
    getUserStatsByMode,
    updateUserStatsByMode,
    getLeaderboard
} = require('../db');

const ready = new Promise(resolve => {
    const poll = () => db.get(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'bot_calibration'`,
        (err, row) => (!err && row) ? resolve() : setTimeout(poll, 20)
    );
    poll();
});

test.before(() => ready);
test.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('new accounts start Adaptive with an unplaced calibration', async () => {
    const user = await createUser('adaptive_new', 'hunter22');
    const preferences = await getUserPreferences(user.id);
    const calibration = await getBotCalibration(user.id);

    assert.strictEqual(preferences.bot_difficulty, 'adaptive');
    assert.strictEqual(calibration.completedGames, 0);
    assert.strictEqual(calibration.calibrationComplete, false);
    assert.strictEqual(calibration.lastTemperature, 10);
});

test('calibration round-trips independently of public stats', async () => {
    const user = await createUser('adaptive_saved', 'hunter22');
    await saveBotCalibration(user.id, {
        skillMu: 0.72,
        skillSigma: 0.12,
        completedGames: 6,
        meaningfulDecisions: 140,
        completedRounds: 24,
        lastTemperature: 7.75,
        calibrationComplete: true,
        controllerVersion: 1
    });

    const saved = await getBotCalibration(user.id);
    assert.strictEqual(saved.skillMu, 0.72);
    assert.strictEqual(saved.completedGames, 6);
    assert.strictEqual(saved.lastTemperature, 7.75);
    assert.strictEqual(saved.calibrationComplete, true);
});

test('shadow rating promotes a public rank without leaking on leaderboard', async () => {
    const user = await createUser('shadow_ranked', 'hunter22');
    for (let game = 0; game < 3; game++) {
        await updateUserStatsByMode(
            user.username,
            'standard',
            game === 2,
            5,
            28,
            25 / 3,
            game === 2 ? 1 : 2
        );
    }

    const internal = await getUserStatsByMode(user.username, 'standard');
    assert.strictEqual(internal.public_rank, 1);
    assert.strictEqual(internal.rating_mu, 28);

    const row = (await getLeaderboard({
        gameMode: 'standard',
        minGames: 0
    })).find(entry => entry.username === user.username);
    assert.deepStrictEqual(
        row.public_rank, { id: 'silver', label: 'Silver' });
    assert.strictEqual('rating_mu' in row, false);
    assert.strictEqual('rating_sigma' in row, false);
    assert.strictEqual('rating_display' in row, false);
});
