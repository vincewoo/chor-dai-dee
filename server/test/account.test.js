// server/test/account.test.js
//
// The profile page's account mutations. Two of these are load-bearing beyond
// the feature itself:
//
//   1. A rename has to rewrite the two columns that store a username instead of
//      a user id (game_history.winner_username, game_participants.username).
//      Every other table keys on user_id and follows for free. If the rewrite
//      were partial, the stale rows would be indistinguishable from a different
//      player's -- the old name is free to be registered by someone else the
//      moment the rename lands.
//
//   2. verifyUser used to call bcrypt.compare with a null hash for any
//      Google-created account. That rejection escaped the db.get callback
//      without ever settling the promise, so /api/login hung rather than
//      failing, for a username anyone could guess.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A scratch database per run. Must be set before requiring db.js, which opens
// and migrates whatever path it resolves at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'database.sqlite');

const {
    db,
    createUser,
    createGoogleUser,
    verifyUser,
    verifyUserById,
    getAccountById,
    renameUser,
    getUsernameHistory,
    setUserPassword,
    unlinkGoogleAccount,
    linkGoogleAccount,
    saveGameHistory,
    saveGameParticipant,
    saveRoundStats,
    getUserStats,
} = require('../db');

const { validateUsername, validatePassword } = require('../username');

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

// db.js opens asynchronously and runs its migrations in the open callback.
const ready = new Promise((resolve) => {
    const poll = () => db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='username_history'`,
        (err, row) => (!err && row) ? resolve() : setTimeout(poll, 20)
    );
    poll();
});

test.before(() => ready);
test.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let gameCounter = 0;
const nextGameId = () => `game_acct_${++gameCounter}`;

// A finished game the given user won, recorded the way the live path records
// one: the winner's name denormalized onto both the history row and their
// participant row.
const recordWonGame = async (user) => {
    const gameId = nextGameId();
    await saveGameHistory({
        gameId,
        roomName: 'Table',
        gameMode: 'short',
        isPublic: true,
        status: 'completed',
        winnerId: user.id,
        winnerUsername: user.username,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationSeconds: 600,
        totalRounds: 4,
        maxPoints: 50,
    });
    await saveGameParticipant({
        gameId,
        userId: user.id,
        username: user.username,
        isBot: false,
        finalPlacement: 1,
        finalScore: 12,
        roundsWon: 3,
    });
    return gameId;
};

test('rename rewrites the denormalized username in game history', async () => {
    const user = await createUser('renamer_one', 'hunter22');
    const gameId = await recordWonGame(user);

    await renameUser(user.id, 'renamed_one');

    const history = await get('SELECT winner_username FROM game_history WHERE game_id = ?', [gameId]);
    const participant = await get('SELECT username FROM game_participants WHERE game_id = ? AND user_id = ?', [gameId, user.id]);

    assert.equal(history.winner_username, 'renamed_one');
    assert.equal(participant.username, 'renamed_one');

    const account = await getAccountById(user.id);
    assert.equal(account.username, 'renamed_one');
});

test('rename leaves other players\' rows in the same game alone', async () => {
    const mine = await createUser('renamer_two', 'hunter22');
    const theirs = await createUser('bystander_two', 'hunter22');
    const gameId = await recordWonGame(theirs);
    await saveGameParticipant({
        gameId,
        userId: mine.id,
        username: mine.username,
        isBot: false,
        finalPlacement: 2,
        finalScore: 20,
        roundsWon: 1,
    });

    await renameUser(mine.id, 'renamed_two');

    const bystander = await get('SELECT username FROM game_participants WHERE game_id = ? AND user_id = ?', [gameId, theirs.id]);
    const history = await get('SELECT winner_username FROM game_history WHERE game_id = ?', [gameId]);

    assert.equal(bystander.username, 'bystander_two', 'a rename must not touch another account\'s rows');
    assert.equal(history.winner_username, 'bystander_two', 'the winner here was someone else');
});

test('id-keyed stats survive a rename without any backfill', async () => {
    const user = await createUser('renamer_three', 'hunter22');
    await saveRoundStats(nextGameId(), user.id, 'short', {
        roundNumber: 1,
        placement: 1,
        cardsLeft: 0,
        penaltyMultiplier: 1,
        roundPoints: 0,
        cumulativeScore: 0,
        plays: 6,
        passes: 1,
        handTypes: {},
    });

    await renameUser(user.id, 'renamed_three');

    // getUserStats looks the account up by name; finding the row under the new
    // name is the whole point of keying on user_id everywhere else.
    const stats = await getUserStats('renamed_three');
    assert.ok(stats, 'stats must be reachable under the new name');
    assert.equal(stats.username, 'renamed_three');

    const rounds = await get('SELECT COUNT(*) AS n FROM round_stats WHERE user_id = ?', [user.id]);
    assert.equal(rounds.n, 1);
});

test('rename records the old name in username_history', async () => {
    const user = await createUser('renamer_four', 'hunter22');
    await renameUser(user.id, 'renamed_four');
    await renameUser(user.id, 'renamed_four_again');

    const history = await getUsernameHistory(user.id);
    assert.equal(history.length, 2);
    // Newest first.
    assert.equal(history[0].old_username, 'renamed_four');
    assert.equal(history[0].new_username, 'renamed_four_again');
    assert.equal(history[1].old_username, 'renamer_four');
});

test('rename to a taken name is refused and changes nothing', async () => {
    const user = await createUser('renamer_five', 'hunter22');
    await createUser('taken_five', 'hunter22');
    const gameId = await recordWonGame(user);

    await assert.rejects(
        () => renameUser(user.id, 'taken_five'),
        (err) => err.code === 'USERNAME_TAKEN'
    );

    const account = await getAccountById(user.id);
    const history = await get('SELECT winner_username FROM game_history WHERE game_id = ?', [gameId]);
    assert.equal(account.username, 'renamer_five');
    assert.equal(history.winner_username, 'renamer_five');
});

test('a rename that collides mid-flight rolls back completely', async () => {
    const user = await createUser('renamer_six', 'hunter22');
    const gameId = await recordWonGame(user);

    // A guest row in this account's own game already holding the target name is
    // the one way the UNIQUE(game_id, username) key can fail the UPDATE. The
    // reserved `Guest_` prefix makes it unreachable through the API; this
    // constructs it directly to prove the transaction is what keeps a failure
    // from leaving the rename half-applied.
    await run(
        `INSERT INTO game_participants (game_id, user_id, username, is_bot, final_placement, final_score, rounds_won)
         VALUES (?, NULL, ?, 0, 2, 30, 0)`,
        [gameId, 'ghost_six']
    );

    await assert.rejects(() => renameUser(user.id, 'ghost_six'));

    const account = await getAccountById(user.id);
    const history = await get('SELECT winner_username FROM game_history WHERE game_id = ?', [gameId]);
    const participant = await get('SELECT username FROM game_participants WHERE game_id = ? AND user_id = ?', [gameId, user.id]);
    const renames = await getUsernameHistory(user.id);

    assert.equal(account.username, 'renamer_six', 'users row must roll back');
    assert.equal(history.winner_username, 'renamer_six', 'game_history must roll back');
    assert.equal(participant.username, 'renamer_six', 'game_participants must roll back');
    assert.equal(renames.length, 0, 'no rename happened, so none is recorded');
});

test('renaming to the same name is a no-op, not a history entry', async () => {
    const user = await createUser('renamer_seven', 'hunter22');
    const result = await renameUser(user.id, 'renamer_seven');

    assert.equal(result.changed, false);
    assert.equal((await getUsernameHistory(user.id)).length, 0);
});

test('login against a Google-only account fails instead of hanging', async () => {
    await createGoogleUser('google_only_user', 'google-sub-1', 'someone@example.com');

    // The bug was an unsettled promise, so the failure mode under test is a
    // timeout rather than a wrong value.
    const verdict = await Promise.race([
        verifyUser('google_only_user', 'anything'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('verifyUser never settled')), 2000)),
    ]);

    assert.equal(verdict, null);
});

test('setting a password gives a Google-only account password login', async () => {
    const user = await createGoogleUser('google_then_pw', 'google-sub-2', 'someone2@example.com');

    assert.equal(await verifyUser('google_then_pw', 'brandnew1'), null);

    await setUserPassword(user.id, 'brandnew1');

    const verified = await verifyUser('google_then_pw', 'brandnew1');
    assert.ok(verified, 'the new password must work');
    assert.equal(verified.username, 'google_then_pw');
    assert.equal(await verifyUser('google_then_pw', 'wrongpass'), null);
});

test('verifyUserById proves ownership by id', async () => {
    const user = await createUser('by_id_user', 'hunter22');

    assert.ok(await verifyUserById(user.id, 'hunter22'));
    assert.equal(await verifyUserById(user.id, 'nope123'), null);
    assert.equal(await verifyUserById(999999, 'hunter22'), null);
});

test('unlink clears both Google columns', async () => {
    const user = await createUser('unlinker', 'hunter22');
    await linkGoogleAccount(user.id, 'google-sub-3', 'someone3@example.com');

    let account = await getAccountById(user.id);
    assert.equal(account.google_id, 'google-sub-3');

    await unlinkGoogleAccount(user.id);

    account = await getAccountById(user.id);
    assert.equal(account.google_id, null);
    assert.equal(account.google_email, null, 'a stale email is still the address it was');
});

test('username rules are shared, and reserve the guest prefix', () => {
    assert.equal(validateUsername('ab').ok, false, 'too short');
    assert.equal(validateUsername('a'.repeat(21)).ok, false, 'too long');
    assert.equal(validateUsername('has space').ok, false);
    assert.equal(validateUsername('has-dash').ok, false);

    // Guest seats are recorded in game_participants with a NULL user_id under
    // exactly this shape, sharing the UNIQUE(game_id, username) key.
    assert.equal(validateUsername('Guest_1234').ok, false);
    assert.equal(validateUsername('guest_1234').ok, false, 'the check is case-insensitive');

    assert.deepEqual(validateUsername('  spaced_out  '), { ok: true, username: 'spaced_out' });
    assert.equal(validateUsername('Guests_are_fine').ok, true, 'only the Guest_ prefix is reserved');
});

test('password rules reject the too-short', () => {
    assert.equal(validatePassword('short').ok, false);
    assert.equal(validatePassword('longenough').ok, true);
    assert.equal(validatePassword(undefined).ok, false);
});
