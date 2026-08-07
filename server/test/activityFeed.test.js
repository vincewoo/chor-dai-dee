// server/test/activityFeed.test.js
//
// The activity feed's "Rage quits" filter selects game_history.status =
// 'abandoned'. For most of this project's life nothing wrote that value, so the
// filter was a working query over a status no row ever held, and abandoned
// games were invisible in the feed entirely -- 'in_progress' appears in no
// filter's status list.
//
// What is pinned here is the boot sweep that converts stranded 'in_progress'
// rows, since it is a one-way UPDATE over real player history, plus the one
// downstream query that used to depend on abandoned games having no participant
// rows at all.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A scratch database per run. Must be set before requiring db.js, which opens
// and migrates whatever path it resolves at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'database.sqlite');

const {
    db,
    saveGameHistory,
    saveGameParticipant,
    saveRoundStats,
    getActivityFeed,
    getActivityFeedCount,
    sweepAbandonedGames,
    getComebackStats,
    createUser,
    saveGameRoundReview,
    getGameRoundReview,
    MAX_BOT_DIFFICULTY_ID
} = require('../db');
const { Room } = require('../game/RoomManager');

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

// db.js opens asynchronously and runs its migrations in the open callback;
// every test here needs the tables to exist first.
const ready = new Promise((resolve) => {
    const poll = () => db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='game_history'`,
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
const nextGameId = () => `game_af_${++gameCounter}`;

// saveRoundStats takes the full per-round shape the live path assembles; only
// the few fields these tests assert on vary.
const addRound = (gameId, userId, roundNumber, extra = {}) => saveRoundStats(gameId, userId, 'short', {
    roundNumber,
    placement: 2,
    cardsLeft: 4,
    penaltyMultiplier: 1,
    roundPoints: 4,
    cumulativeScore: roundNumber * 4,
    plays: 5,
    passes: 2,
    handTypes: {},
    ...extra
});

const startedGame = async (overrides = {}) => {
    const gameId = overrides.gameId || nextGameId();
    await saveGameHistory({
        gameId,
        roomName: 'ROOM1',
        gameMode: 'short',
        isPublic: true,
        status: 'in_progress',
        winnerId: null,
        winnerUsername: null,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: null,
        durationSeconds: null,
        totalRounds: 0,
        maxPoints: 50,
        ...overrides
    });
    return gameId;
};

test('sweep marks stranded in_progress games abandoned', async () => {
    const stranded = await startedGame();

    const changed = await sweepAbandonedGames();
    assert.ok(changed >= 1);

    const row = await get(`SELECT * FROM game_history WHERE game_id = ?`, [stranded]);
    assert.strictEqual(row.status, 'abandoned');
});

test('sweep leaves completed games alone', async () => {
    const gameId = await startedGame();
    await saveGameHistory({
        gameId,
        roomName: 'ROOM1',
        gameMode: 'short',
        isPublic: true,
        status: 'completed',
        winnerId: null,
        winnerUsername: 'Winner',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:30:00.000Z',
        durationSeconds: 1800,
        totalRounds: 6,
        maxPoints: 50
    });

    await sweepAbandonedGames();

    const row = await get(`SELECT * FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.winner_username, 'Winner');
});

// The feed pages on end_time DESC. Stamping "now" on a backlog of games
// abandoned over months would sort every one of them above today's real games,
// so the end is recovered from the last round the game actually persisted.
test('sweep recovers end_time and total_rounds from the last played round', async () => {
    const user = await createUser(`sweeper_${Date.now()}`, 'pw');
    const gameId = await startedGame();

    for (const [roundNumber, timestamp] of [[1, '2026-03-05 10:00:00'], [2, '2026-03-05 10:12:30']]) {
        await addRound(gameId, user.id, roundNumber);
        await run(
            `UPDATE round_stats SET timestamp = ? WHERE game_id = ? AND round_number = ?`,
            [timestamp, gameId, roundNumber]
        );
    }

    await sweepAbandonedGames();

    const row = await get(`SELECT * FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.status, 'abandoned');
    assert.strictEqual(row.total_rounds, 2);

    // ISO-8601 with an explicit Z, not SQLite's space-separated CURRENT_TIMESTAMP
    // form: the client parses this with `new Date(...)`, which reads the
    // space-separated form as local time and would shift it by the viewer's
    // offset.
    assert.strictEqual(row.end_time, '2026-03-05T10:12:30.000Z');
    assert.strictEqual(new Date(row.end_time).toISOString(), '2026-03-05T10:12:30.000Z');

    // Left NULL rather than derived from a reconstructed end: a card showing no
    // duration is better than one showing a wrong duration.
    assert.strictEqual(row.duration_seconds, null);
});

test('sweep falls back to start_time for a game that finished no rounds', async () => {
    const gameId = await startedGame({ startTime: '2026-02-02T08:00:00.000Z' });

    await sweepAbandonedGames();

    const row = await get(`SELECT * FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.end_time, '2026-02-02T08:00:00.000Z');
    assert.strictEqual(row.total_rounds, 0);
});

test('swept games are reachable through the abandoned filter, not the completed one', async () => {
    const gameId = await startedGame();
    await sweepAbandonedGames();

    const abandoned = await getActivityFeed({ includeStatus: ['abandoned'], limit: 50 });
    assert.ok(abandoned.some(g => g.game_id === gameId));

    const completed = await getActivityFeed({ includeStatus: ['completed'], limit: 50 });
    assert.ok(!completed.some(g => g.game_id === gameId));

    // The count drives pagination and must agree with the rows returned.
    const count = await getActivityFeedCount({ includeStatus: ['abandoned'] });
    assert.strictEqual(count, abandoned.length);
});

test('the sweep is idempotent', async () => {
    await startedGame();
    await sweepAbandonedGames();

    const before = await get(`SELECT COUNT(*) AS n FROM game_history WHERE status = 'abandoned'`);
    const changed = await sweepAbandonedGames();
    const after = await get(`SELECT COUNT(*) AS n FROM game_history WHERE status = 'abandoned'`);

    assert.strictEqual(changed, 0);
    assert.strictEqual(after.n, before.n);
});

// Abandoned games now carry participant rows (scores at the moment the game
// died) with a NULL placement. getComebackStats used to lean on those rows not
// existing; without an explicit filter every walkout would count as a game the
// player led at halfway and then failed to convert.
test('comeback stats count placed participants and ignore unplaced ones', async () => {
    const user = await createUser(`comeback_${Date.now()}`, 'pw');

    // Two five-round games in which this player led at the halfway point. One
    // was played to the end and collapsed to 4th; the other was abandoned, so it
    // has a score but no placement.
    const finished = await startedGame();
    const abandoned = await startedGame();

    for (const gameId of [finished, abandoned]) {
        for (const roundNumber of [1, 2, 3, 4, 5]) {
            await addRound(gameId, user.id, roundNumber, { placement: 1, standing: 1 });
        }
    }

    await saveGameParticipant({
        gameId: finished, userId: user.id, username: user.username, isBot: false,
        finalPlacement: 4, finalScore: 42, roundsWon: 1
    });
    await saveGameParticipant({
        gameId: abandoned, userId: user.id, username: user.username, isBot: false,
        finalPlacement: null, finalScore: 12, roundsWon: 2
    });

    // Only the finished game is a collapse. Counting the abandoned one too --
    // which is what happens without the final_placement filter -- would double
    // this player's recorded collapses off a game that never had a result.
    const stats = await getComebackStats(user.id, 'short');
    assert.strictEqual(stats.games, 1);
    assert.strictEqual(stats.led_at_half, 1);
    assert.strictEqual(stats.collapses, 1);
});

// --- the "Max bots" badge ---------------------------------------------------
//
// game_history.bot_difficulty is the frozen tier the room's bots actually ran.
// The feed does not hand that string to the client to compare: it derives one
// boolean, so all three surfaces that draw the badge (the feed, the home
// screen's Recent list, and the score dialog they open) agree by construction.

const feedGame = async (gameId) => {
    const games = await getActivityFeed({ includeStatus: ['completed'], limit: 200 });
    return games.find(g => g.game_id === gameId);
};

const completedGame = async (botDifficulty, seats) => {
    const gameId = await startedGame({ botDifficulty });
    await saveGameHistory({
        gameId,
        roomName: 'ROOM1',
        gameMode: 'short',
        isPublic: true,
        status: 'completed',
        winnerId: null,
        winnerUsername: seats[0].username,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:30:00.000Z',
        durationSeconds: 1800,
        totalRounds: 6,
        maxPoints: 50,
        botDifficulty
    });
    for (const [idx, seat] of seats.entries()) {
        await saveGameParticipant({
            gameId, userId: null, username: seat.username, isBot: seat.isBot,
            finalPlacement: idx + 1, finalScore: idx * 10, roundsWon: 0
        });
    }
    return gameId;
};

test('a max-difficulty game against bots is badged', async () => {
    const gameId = await completedGame('competitive', [
        { username: 'MaxHuman', isBot: false },
        { username: 'MaxBot1', isBot: true },
        { username: 'MaxBot2', isBot: true },
        { username: 'MaxBot3', isBot: true }
    ]);

    assert.strictEqual((await feedGame(gameId)).max_bots, true);
});

test('an adaptive game is never badged', async () => {
    // The whole point of the binary badge: Adaptive strength is a continuous
    // hidden temperature, and the feed is public. Nothing about it is shown.
    const gameId = await completedGame('adaptive', [
        { username: 'AdaptHuman', isBot: false },
        { username: 'AdaptBot1', isBot: true },
        { username: 'AdaptBot2', isBot: true },
        { username: 'AdaptBot3', isBot: true }
    ]);

    assert.strictEqual((await feedGame(gameId)).max_bots, false);
});

test('a max-difficulty game with no bots in it is not badged', async () => {
    // Max difficulty is a room setting, so a table that filled with four humans
    // carries it with nothing to apply it to. Badging that game would claim a
    // challenge nobody faced.
    const gameId = await completedGame('competitive', [
        { username: 'AllHuman1', isBot: false },
        { username: 'AllHuman2', isBot: false },
        { username: 'AllHuman3', isBot: false },
        { username: 'AllHuman4', isBot: false }
    ]);

    assert.strictEqual((await feedGame(gameId)).max_bots, false);
});

test('a game recorded before the column existed is not badged', async () => {
    // NULL means unknown and is deliberately never backfilled: every row
    // predating difficulty tiers ran full-strength argmax, so reconstructing
    // them would badge almost the whole archive and make the badge meaningless.
    const gameId = await completedGame(undefined, [
        { username: 'OldHuman', isBot: false },
        { username: 'OldBot1', isBot: true },
        { username: 'OldBot2', isBot: true },
        { username: 'OldBot3', isBot: true }
    ]);

    const row = await get(`SELECT bot_difficulty FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.bot_difficulty, null);
    assert.strictEqual((await feedGame(gameId)).max_bots, false);
});

test('the terminal write heals a row opened by a build without the column', async () => {
    // A rolling deploy can open a game on the old build and finish it on the
    // new one. The policy is frozen for the whole game, so the completion write
    // knows a difficulty the 'in_progress' row could not record.
    const gameId = nextGameId();
    await run(
        `INSERT INTO game_history
            (game_id, room_name, game_mode, is_public, status, start_time, total_rounds, max_points)
         VALUES (?, 'ROOM1', 'short', 1, 'in_progress', '2026-01-01T00:00:00.000Z', 0, 50)`,
        [gameId]);

    await saveGameHistory({
        gameId,
        roomName: 'ROOM1',
        gameMode: 'short',
        isPublic: true,
        status: 'completed',
        winnerId: null,
        winnerUsername: 'Healer',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:30:00.000Z',
        durationSeconds: 1800,
        totalRounds: 6,
        maxPoints: 50,
        botDifficulty: 'competitive'
    });

    const row = await get(`SELECT bot_difficulty FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.bot_difficulty, 'competitive');
});

test('the raw tier never reaches the client', async () => {
    // The endpoint's output is the derived boolean, not the tier it came from.
    // Asserted through a JSON round-trip because that is what the wire does:
    // an own property set to undefined still exists on the in-process object
    // and would pass a naive `=== undefined` check while serializing away --
    // or, worse, not serializing away if the strip is ever removed.
    const gameId = await completedGame('competitive', [
        { username: 'WireHuman', isBot: false },
        { username: 'WireBot1', isBot: true },
        { username: 'WireBot2', isBot: true },
        { username: 'WireBot3', isBot: true }
    ]);

    const onTheWire = JSON.parse(JSON.stringify(await feedGame(gameId)));
    assert.ok(!('bot_difficulty' in onTheWire),
        'raw bot_difficulty must not be serialized to clients');
    assert.strictEqual(onTheWire.max_bots, true);

    // ...and it is genuinely still recorded, so the strip is a payload
    // decision rather than a write that quietly stopped happening.
    const row = await get(`SELECT bot_difficulty FROM game_history WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.bot_difficulty, 'competitive');
});

test('an abandoned game against max bots is badged', async () => {
    // recordAbandonedGame is one of the five writers, and the "Rage quits"
    // filter is where its games surface. Every other badge test uses
    // 'completed', so without this the abandoned path is unexercised.
    const gameId = nextGameId();
    await saveGameHistory({
        gameId,
        roomName: 'ROOM1',
        gameMode: 'short',
        isPublic: true,
        status: 'abandoned',
        winnerId: null,
        winnerUsername: null,
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:12:00.000Z',
        durationSeconds: 720,
        totalRounds: 2,
        maxPoints: 50,
        botDifficulty: 'competitive'
    });
    for (const seat of [
        { username: 'QuitHuman', isBot: false },
        { username: 'QuitBot1', isBot: true },
        { username: 'QuitBot2', isBot: true },
        { username: 'QuitBot3', isBot: true }
    ]) {
        await saveGameParticipant({
            gameId, userId: null, username: seat.username, isBot: seat.isBot,
            // Abandoned games carry scores but no placement.
            finalPlacement: null, finalScore: 7, roundsWon: 0
        });
    }

    const games = await getActivityFeed({ includeStatus: ['abandoned'], limit: 200 });
    const game = games.find(g => g.game_id === gameId);
    assert.strictEqual(game.max_bots, true);
});

// --- what actually gets recorded --------------------------------------------
//
// DEFAULT_BOT_DIFFICULTY and MAX_BOT_DIFFICULTY are the same string, so a Room
// reports the ceiling tier from its constructor onward, before anything has
// chosen it. Every production game-start path calls configureBotPolicyForRoster
// first, which overwrites it -- but nothing enforced that, and the feed's badge
// cannot tell a constructor default from a host's deliberate choice.
//
// Scope, stated rather than implied: this pins the value the five call sites
// read (`room.botPolicy.difficulty`) and that it round-trips to the badge. It
// does not execute those call sites, which live in socket handlers in index.js
// and are not exported.

test('a normal game records adaptive, not the ceiling tier', async () => {
    const room = new Room('FEED-DEFAULT', 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });

    // The constructor default is indistinguishable from a host's choice...
    assert.strictEqual(room.botPolicy.difficulty, 'competitive',
        'if this ever stops being true the collision is gone and this test ' +
        'is no longer guarding anything');
    // ...until the production path runs, which is what every game start does.
    assert.deepStrictEqual(room.configureBotPolicyForRoster(), { success: true });
    assert.strictEqual(room.botPolicy.difficulty, 'adaptive');

    const gameId = await completedGame(room.botPolicy.difficulty, [
        { username: 'Alice', isBot: false },
        { username: 'DefaultBot1', isBot: true },
        { username: 'DefaultBot2', isBot: true },
        { username: 'DefaultBot3', isBot: true }
    ]);
    assert.strictEqual((await feedGame(gameId)).max_bots, false,
        'a player who never touched the toggle must not be badged');
});

test('a room whose host chose max bots records the ceiling tier', async () => {
    const room = new Room('FEED-MAXBOTS', 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    assert.deepStrictEqual(room.setForceMaxBots(true, 'Alice'),
        { success: true, forceMaxBots: true });
    // The roster pass runs at every game boundary and must not undo the choice.
    assert.deepStrictEqual(room.configureBotPolicyForRoster(), { success: true });
    assert.strictEqual(room.botPolicy.difficulty, MAX_BOT_DIFFICULTY_ID);

    const gameId = await completedGame(room.botPolicy.difficulty, [
        { username: 'Alice', isBot: false },
        { username: 'MaxedBot1', isBot: true },
        { username: 'MaxedBot2', isBot: true },
        { username: 'MaxedBot3', isBot: true }
    ]);
    assert.strictEqual((await feedGame(gameId)).max_bots, true);
});

// --- the round-by-round review in the feed ----------------------------------
//
// The feed cannot rebuild this from anything else it stores: round_stats holds
// registered humans only, so three seats of a typical game would be blank, and
// game_participants keeps no per-round data at all. It is persisted verbatim
// from the game-over payload so the feed and the table cannot disagree.

test('a stored review round-trips for every seat, bots included', async () => {
    const gameId = nextGameId();
    const review = {
        Alice: { avgPercentile: 61, dealRank: 1, totalPoints: 12, roundsWon: 2,
                 rounds: [{ round: 1, percentile: 61, tierLabel: 'Strong', rank: 1, points: 0, cardsLeft: 0, won: true }] },
        'Bot 2': { avgPercentile: 30, dealRank: 2, totalPoints: 40, roundsWon: 0,
                   rounds: [{ round: 1, percentile: 30, tierLabel: 'Rough', rank: 2, points: 40, cardsLeft: 13, won: false }] }
    };
    await saveGameRoundReview(gameId, review);

    const back = await getGameRoundReview(gameId);
    assert.deepStrictEqual(back, review);
    assert.ok('Bot 2' in back, 'bots must survive; round_stats would drop them');
});

test('a game with no stored review answers null rather than failing', async () => {
    // Every game played before this shipped. The feed renders its plain
    // standings; there is nothing to reconstruct the deals from afterwards.
    assert.strictEqual(await getGameRoundReview('game_never_reviewed'), null);
});

test('the first review written for a game is the one kept', async () => {
    // The review describes a finished game, so a second write is a bug or a
    // retry, never a correction.
    const gameId = nextGameId();
    await saveGameRoundReview(gameId, { A: { avgPercentile: 50, rounds: [] } });
    await saveGameRoundReview(gameId, { A: { avgPercentile: 99, rounds: [] } });
    assert.strictEqual((await getGameRoundReview(gameId)).A.avgPercentile, 50);
});

test('an empty review is not stored at all', async () => {
    // A game that ended before any deal was scored has nothing to say, and a
    // row of "{}" would be indistinguishable from a real but empty answer.
    const gameId = nextGameId();
    await saveGameRoundReview(gameId, {});
    assert.strictEqual(await getGameRoundReview(gameId), null);
});

test('an abandoned game keeps its review, under the seat-owner names', async () => {
    // The "Rage quits" filter is a whole tab of games that were really played,
    // with real deals behind them. Their participant rows are attributed to
    // whoever OWNED each seat rather than to the bot sitting in it at teardown,
    // so the review has to be keyed the same way or the feed looks up a name
    // that has no entry.
    const { Room } = require('../game/RoomManager');
    const room = new Room('ABANDON-REVIEW', 'short');
    room.addPlayer({ id: 'p1', name: 'Alice', isBot: false });
    ['Bot 2', 'Bot 3', 'Bot 4'].forEach((n, i) =>
        room.addPlayer({ id: `b${i}`, name: n, isBot: true }));
    room.startGame();

    // The walkout: the seat is botified but still owned by Alice.
    room.players[0].isBot = true;
    room.players[0].name = 'Bot (Alice)';
    room.players[0].replacedHuman = { name: 'Alice', isGuest: false };

    const seats = room.describeParticipants();
    const review = room.describeRoundReview(seats.map(s => s.username));

    assert.deepStrictEqual(Object.keys(review).sort(), seats.map(s => s.username).sort(),
        'review keys must match the participant rows the feed renders');
    assert.ok('Alice' in review, 'the rage quit is attributed to the human, not the bot');
});

test('a rename follows the review, which stores the name as a key', async () => {
    // game_round_review is the third place a username is denormalized and the
    // only one holding it as a KEY. A rename that rewrote the other two left
    // the feed looking up the new name in a map still holding the old one, and
    // the panel opened to a grid of dashes.
    const { renameUser } = require('../db');
    const user = await createUser(`renamer_${Date.now()}`, 'pw');
    const gameId = nextGameId();

    await saveGameHistory({
        gameId, roomName: 'R', gameMode: 'short', isPublic: true, status: 'completed',
        winnerId: user.id, winnerUsername: user.username,
        startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:20:00.000Z',
        durationSeconds: 1200, totalRounds: 3, maxPoints: 50
    });
    await saveGameParticipant({
        gameId, userId: user.id, username: user.username, isBot: false,
        finalPlacement: 1, finalScore: 0, roundsWon: 3
    });
    await saveGameRoundReview(gameId, {
        [user.username]: { avgPercentile: 61, dealRank: 1, totalPoints: 0, roundsWon: 3, rounds: [] },
        'Bot 2': { avgPercentile: 40, dealRank: 2, totalPoints: 30, roundsWon: 0, rounds: [] }
    });

    const newName = `renamed_${Date.now()}`;
    await renameUser(user.id, newName);

    const review = await getGameRoundReview(gameId);
    assert.ok(newName in review, 'the review must follow the rename');
    assert.ok(!(user.username in review), 'the retired name must not linger');
    assert.strictEqual(review[newName].dealRank, 1, 'the entry travels intact');
    assert.ok('Bot 2' in review, 'other seats are untouched');

    // And it still matches the participant row the feed renders it against.
    const row = await get(`SELECT username FROM game_participants WHERE game_id = ?`, [gameId]);
    assert.strictEqual(row.username, newName);
});

test('a review from a newer format is refused rather than guessed at', async () => {
    const gameId = nextGameId();
    await run(`INSERT INTO game_round_review (game_id, review) VALUES (?, ?)`,
        [gameId, JSON.stringify({ version: 99, seats: { A: { avgPercentile: 1 } } })]);
    assert.strictEqual(await getGameRoundReview(gameId), null);
});
