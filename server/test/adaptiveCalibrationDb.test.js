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
const { MIN_PLACEMENT_MODE_GAMES } = require('../game/PublicRank');

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

    const row = (await getLeaderboard({
        gameMode: 'standard',
        minGames: 0
    })).find(entry => entry.username === user.username);
    assert.deepStrictEqual(
        row.public_rank, { id: 'unranked', label: 'Unranked' });
    assert.strictEqual('rank_placement_complete' in row, false);
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

test('completed placement assigns a public rank without leaking shadow rating', async () => {
    const user = await createUser('shadow_ranked', 'hunter22');
    await saveBotCalibration(user.id, {
        completedGames: 5,
        meaningfulDecisions: 80,
        completedRounds: 15,
        calibrationComplete: true
    });
    const playGame = (placement) => updateUserStatsByMode(
        user.username, 'standard', placement === 1, 5, 28, 25 / 3, placement);

    // Calibration is one row per player, but a rank is per mode. Completing it
    // elsewhere is not enough to place someone here.
    for (let game = 0; game < MIN_PLACEMENT_MODE_GAMES - 1; game++) {
        await playGame(2);
    }
    const unplaced = await getUserStatsByMode(user.username, 'standard');
    assert.strictEqual(unplaced.rank_placement_complete, 0);
    assert.strictEqual(unplaced.public_rank, 0);

    // The game that satisfies the mode gate places them, off mu alone: 28 at
    // the placement reference sigma is 1840, which is Gold.
    await playGame(1);
    const internal = await getUserStatsByMode(user.username, 'standard');
    assert.strictEqual(internal.public_rank, 3);
    assert.strictEqual(internal.rank_placement_complete, 1);
    assert.strictEqual(internal.rating_mu, 28);

    const row = (await getLeaderboard({
        gameMode: 'standard',
        minGames: 0
    })).find(entry => entry.username === user.username);
    assert.deepStrictEqual(
        row.public_rank, { id: 'gold', label: 'Gold' });
    assert.strictEqual('rating_mu' in row, false);
    assert.strictEqual('rating_sigma' in row, false);
    assert.strictEqual('rating_display' in row, false);
});

test('a rank is never placed from one mode\'s games onto another', async () => {
    const user = await createUser('mode_split', 'hunter22');
    await saveBotCalibration(user.id, {
        completedGames: 8,
        meaningfulDecisions: 120,
        completedRounds: 20,
        calibrationComplete: true
    });

    // A full placement's worth of Short games, then a single Standard one.
    for (let game = 0; game < MIN_PLACEMENT_MODE_GAMES; game++) {
        await updateUserStatsByMode(
            user.username, 'short', true, 5, 31, 25 / 3, 1);
    }
    await updateUserStatsByMode(
        user.username, 'standard', true, 5, 26, 25 / 3, 1);

    const short = await getUserStatsByMode(user.username, 'short');
    assert.strictEqual(short.rank_placement_complete, 1);

    // One game of evidence used to place this row - always at the bottom,
    // because a single result cannot move mu far enough to clear any line.
    const standard = await getUserStatsByMode(user.username, 'standard');
    assert.strictEqual(standard.rank_placement_complete, 0);
    assert.strictEqual(standard.public_rank, 0);
});
