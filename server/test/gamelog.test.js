// server/test/gamelog.test.js
//
// The store is an observer of gameplay. The single most important property is
// that it cannot hurt a live game: a full disk, a locked database, or a
// malformed row must never surface to a player or abort a round transition.
// That is asserted here directly rather than assumed.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fresh database per run, and logging on. Must be set before requiring the
// module, which reads both at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelog-test-'));
process.env.GAMELOG_PATH = path.join(tmpDir, 'gamelog.sqlite');
process.env.GAMELOG_ENABLED = '1';
process.env.GAMELOG_EXPORT_SECRET = 'test-secret';

const gamelog = require('../gamelog');
const { makeRng, deal, playRound } = require('./botHarness');
const { BotLogic } = require('../game/BotLogic');
const { replayRound } = require('../game/Replayer');
const { encodeDeal, ACTION, SOURCE, FLAG } = require('../game/TapeCodec');

const seats4 = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));

let gameCounter = 0;
const nextGameId = () => `game_test_${++gameCounter}`;

const baseGame = (overrides = {}) => ({
    gameId: nextGameId(),
    roomId: 'ROOM1',
    gameMode: 'short',
    pointThreshold: 50,
    startedAt: Date.now(),
    ...overrides
});

const botSeats = () => [0, 1, 2, 3].map(seat => ({
    seat,
    fromRound: 1,
    occupant: 'bot_heuristic',
    subjectKey: `Bot ${seat + 1}`,
    policyGen: 1
}));

test('schema is created and a game round-trips', async () => {
    const game = baseGame();
    const gameKey = await gamelog.openGame(game, botSeats());
    assert.ok(gameKey > 0);

    const { get } = await gamelog.openForRead();
    const row = await get('SELECT * FROM mlog_game WHERE game_key = ?', [gameKey]);

    assert.strictEqual(row.game_id, game.gameId);
    assert.strictEqual(row.game_mode, 'short');
    assert.strictEqual(row.point_threshold, 50);
    assert.strictEqual(row.schema_version, gamelog.SCHEMA_VERSION);
    assert.ok(row.rules_version > 0);
    assert.strictEqual(row.ended_at, null, 'a new game must be open');
});

// 'bot_ppo' is no longer written by the server -- the advanced bot is gone --
// but the store must keep accepting it so games logged before the removal stay
// readable and re-insertable.
test('seats record which policy generation played', async () => {
    const gameKey = await gamelog.openGame(baseGame(), [
        { seat: 0, fromRound: 1, occupant: 'human', subjectKey: 'alice', userId: 7,
          ratingMu: 25.1, ratingSigma: 8.3 },
        { seat: 1, fromRound: 1, occupant: 'bot_ppo', subjectKey: 'modelParameters136500',
          policyGen: 136500, policyRef: 'modelParameters136500' },
        { seat: 2, fromRound: 1, occupant: 'bot_heuristic', subjectKey: 'Bot 3', policyGen: 1 },
        { seat: 3, fromRound: 1, occupant: 'guest', subjectKey: null }
    ]);

    const { all } = await gamelog.openForRead();
    const rows = await all('SELECT * FROM mlog_seat WHERE game_key = ? ORDER BY seat', [gameKey]);

    assert.strictEqual(rows.length, 4);
    assert.strictEqual(rows[0].occupant, 'human');
    assert.strictEqual(rows[0].user_id, 7);
    assert.strictEqual(rows[0].policy_gen, null, 'humans have no policy generation');
    assert.strictEqual(rows[1].occupant, 'bot_ppo');
    assert.strictEqual(rows[1].policy_gen, 136500);
    assert.strictEqual(rows[2].policy_gen, 1);
});

test('a seat swap closes one segment and opens the next', async () => {
    const gameKey = await gamelog.openGame(baseGame(), botSeats());

    // A human leaves at round 5 and a bot inherits their hand.
    await gamelog.changeSeat(gameKey, 2, 5, {
        occupant: 'bot_heuristic', subjectKey: 'Bot (alice)', policyGen: 1
    });

    const { all } = await gamelog.openForRead();
    const rows = await all(
        'SELECT * FROM mlog_seat WHERE game_key = ? AND seat = 2 ORDER BY segment', [gameKey]
    );

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].segment, 0);
    assert.strictEqual(rows[0].to_round, 5, 'the outgoing segment must be closed');
    assert.strictEqual(rows[1].segment, 1);
    assert.strictEqual(rows[1].from_round, 5);
    assert.strictEqual(rows[1].to_round, null);
    assert.strictEqual(rows[1].subject_key, 'Bot (alice)');
});

test('a persisted round replays back to the same final state', async () => {
    // End to end: play, persist, read back from SQLite, replay, compare. This
    // is the property the whole design rests on.
    const hands = deal(makeRng(4242));
    const tape = [];
    const live = playRound(seats4, hands, null, p => tape.push(p));

    const gameKey = await gamelog.openGame(baseGame(), botSeats());
    const startSeat = hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D'));

    await gamelog.writeRound(gameKey, {
        roundNumber: 1,
        deal: encodeDeal(hands),
        startSeat,
        endReason: 'normal',
        winnerSeat: live.winnerSeat,
        startedAt: Date.now(),
        endedAt: Date.now(),
        cardsLeft: live.cardsLeft,
        roundPoints: [0, 0, 0, 0],
        scoreAfter: [0, 0, 0, 0]
    }, tape.map(p => ({
        ply: p.ply, seat: p.seat, action: p.action, cardsMask: p.cards_mask,
        handType: p.hand_type, handValue: p.hand_value,
        thinkMs: null, source: SOURCE.BOT, flags: 0
    })));

    const { get, all } = await gamelog.openForRead();
    const round = await get(
        'SELECT * FROM mlog_round WHERE game_key = ? AND round_number = 1', [gameKey]
    );
    const actions = await all(
        'SELECT * FROM mlog_action WHERE game_key = ? AND round_number = 1 ORDER BY ply', [gameKey]
    );

    assert.strictEqual(round.ply_count, tape.length);
    assert.strictEqual(actions.length, tape.length);

    const result = replayRound(round, actions);
    assert.ok(result.complete, result.error && result.error.message);
    assert.deepStrictEqual(result.cardsLeft, live.cardsLeft);
    assert.strictEqual(result.winnerSeat, live.winnerSeat);
});

test('card masks survive SQLite as exact integers', async () => {
    // A 52-bit mask is near the top of the safe integer range; a float round
    // trip here would silently corrupt which cards were played.
    const gameKey = await gamelog.openGame(baseGame(), botSeats());
    const bigMask = 2 ** 51 + 2 ** 50 + 1;

    await gamelog.writeRound(gameKey, {
        roundNumber: 1, deal: encodeDeal(deal(makeRng(1))), startSeat: 0,
        endReason: 'partial', startedAt: Date.now()
    }, [{ ply: 0, seat: 0, action: ACTION.PLAY, cardsMask: bigMask, source: SOURCE.BOT }]);

    const { get } = await gamelog.openForRead();
    const row = await get(
        'SELECT cards_mask FROM mlog_action WHERE game_key = ? AND ply = 0', [gameKey]
    );
    assert.strictEqual(row.cards_mask, bigMask);
});

test('flags and think_ms persist as written', async () => {
    const gameKey = await gamelog.openGame(baseGame(), botSeats());
    await gamelog.writeRound(gameKey, {
        roundNumber: 1, deal: encodeDeal(deal(makeRng(2))), startSeat: 0,
        endReason: 'partial', startedAt: Date.now()
    }, [
        { ply: 0, seat: 0, action: ACTION.PLAY, cardsMask: 1, thinkMs: 120000,
          source: SOURCE.HUMAN, flags: FLAG.THINK_CLAMPED | FLAG.TURN_DISCONNECTED },
        { ply: 1, seat: 1, action: ACTION.PASS, cardsMask: 0, thinkMs: null,
          source: SOURCE.BOT, flags: 0 }
    ]);

    const { all } = await gamelog.openForRead();
    const rows = await all(
        'SELECT * FROM mlog_action WHERE game_key = ? ORDER BY ply', [gameKey]
    );
    assert.strictEqual(rows[0].flags, FLAG.THINK_CLAMPED | FLAG.TURN_DISCONNECTED);
    assert.strictEqual(rows[0].think_ms, 120000);
    assert.strictEqual(rows[1].think_ms, null, 'bots must be null, not 0');
});

test('rematch chains link to the previous game', async () => {
    const first = baseGame();
    await gamelog.openGame(first, botSeats());

    const second = baseGame({ previousGameId: first.gameId, chainKind: 'rematch' });
    const secondKey = await gamelog.openGame(second, botSeats());

    const { get } = await gamelog.openForRead();
    const row = await get('SELECT * FROM mlog_game WHERE game_key = ?', [secondKey]);
    const prev = await get('SELECT game_key FROM mlog_game WHERE game_id = ?', [first.gameId]);

    assert.strictEqual(row.previous_game_key, prev.game_key);
    assert.strictEqual(row.chain_kind, 'rematch');
});

test('an unlogged predecessor breaks the chain rather than mislinking', async () => {
    // Opted out, or a failed write. NULL is correct; pointing at the wrong game
    // would be worse than pointing at nothing.
    const game = baseGame({ previousGameId: 'game_never_logged', chainKind: 'rematch' });
    const gameKey = await gamelog.openGame(game, botSeats());

    const { get } = await gamelog.openForRead();
    const row = await get('SELECT * FROM mlog_game WHERE game_key = ?', [gameKey]);
    assert.strictEqual(row.previous_game_key, null);
    assert.strictEqual(row.chain_kind, null);
});

test('closeGame records the outcome and abandonment reason', async () => {
    const gameKey = await gamelog.openGame(baseGame(), botSeats());
    await gamelog.closeGame(gameKey, {
        endedAt: Date.now(), endReason: 'abandoned',
        abandonReason: 'multiplayer_timeout', totalRounds: 6, winnerSeat: null
    });

    const { get } = await gamelog.openForRead();
    const row = await get('SELECT * FROM mlog_game WHERE game_key = ?', [gameKey]);
    assert.strictEqual(row.end_reason, 'abandoned');
    assert.strictEqual(row.abandon_reason, 'multiplayer_timeout');
    assert.strictEqual(row.total_rounds, 6);
});

test('the orphan sweep closes games left open by a restart', async () => {
    const open1 = await gamelog.openGame(baseGame(), botSeats());
    const open2 = await gamelog.openGame(baseGame(), botSeats());
    const closed = await gamelog.openGame(baseGame(), botSeats());
    await gamelog.closeGame(closed, {
        endedAt: Date.now(), endReason: 'threshold', totalRounds: 9, winnerSeat: 1
    });

    const swept = await gamelog.sweepOrphans();
    assert.ok(swept >= 2);

    const { get } = await gamelog.openForRead();
    for (const key of [open1, open2]) {
        const row = await get('SELECT * FROM mlog_game WHERE game_key = ?', [key]);
        assert.strictEqual(row.end_reason, 'abandoned');
        assert.strictEqual(row.abandon_reason, 'orphaned_restart');
    }
    // A properly closed game must not be touched.
    const untouched = await get('SELECT * FROM mlog_game WHERE game_key = ?', [closed]);
    assert.strictEqual(untouched.end_reason, 'threshold');
    assert.strictEqual(untouched.abandon_reason, null);
});

test('a store failure never propagates to the caller', async () => {
    // The hard rule: gameplay must survive anything this module does. Simulated
    // by writing a round that violates a CHECK constraint.
    const gameKey = await gamelog.openGame(baseGame(), botSeats());

    const result = await gamelog.writeRound(gameKey, {
        roundNumber: 1,
        deal: encodeDeal(deal(makeRng(3))),
        startSeat: 0,
        endReason: 'not_a_valid_reason',   // violates CHECK
        startedAt: Date.now()
    }, []);

    assert.strictEqual(result, null, 'failure must be swallowed and reported as null');

    // And the store still works afterwards - no poisoned transaction queue.
    const after = await gamelog.openGame(baseGame(), botSeats());
    assert.ok(after > 0, 'store must remain usable after a failed write');
});

test('a bad seat write does not abort the caller either', async () => {
    const gameKey = await gamelog.openGame(baseGame(), botSeats());
    const result = await gamelog.changeSeat(gameKey, 9, 2, { occupant: 'bot_heuristic' });
    assert.strictEqual(result, null);
});

test('subject keys are stable, distinct, and not the raw id', async () => {
    const a1 = gamelog.subjectKeyFor(42);
    const a2 = gamelog.subjectKeyFor(42);
    const b = gamelog.subjectKeyFor(43);

    assert.strictEqual(a1, a2, 'must be stable so per-player modelling works');
    assert.notStrictEqual(a1, b);
    assert.ok(!a1.includes('42'));
    assert.strictEqual(gamelog.subjectKeyFor(null), null);
});

test('reopening an existing game keeps its key', async () => {
    // start_game can fire twice for one gameId (rematch races, reconnects).
    // A second insert must not create a duplicate game or lose the tape.
    const game = baseGame();
    const first = await gamelog.openGame(game, botSeats());
    const second = await gamelog.openGame(game, botSeats());
    assert.strictEqual(second, first);

    const { get } = await gamelog.openForRead();
    const count = await get('SELECT COUNT(*) AS n FROM mlog_game WHERE game_id = ?', [game.gameId]);
    assert.strictEqual(count.n, 1);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
