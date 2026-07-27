// server/test/archive.test.js
//
// Archival deletes data, so the tests that matter are the ones about when it
// must NOT delete: nothing before a shard exists, nothing that is still open,
// and nothing outside the requested window.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelog-archive-'));
process.env.GAMELOG_PATH = path.join(tmpDir, 'gamelog.sqlite');
process.env.GAMELOG_ENABLED = '1';
process.env.GAMELOG_EXPORT_SECRET = 'test-secret';

const gamelog = require('../gamelog');
const { encodeDeal, ACTION, SOURCE } = require('../game/TapeCodec');
const { makeRng, deal, playRound } = require('./botHarness');
const { BotLogic } = require('../game/BotLogic');

const DAY = 24 * 60 * 60 * 1000;
const seats4 = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));

let counter = 0;

/** Writes one complete game, backdated by `ageDays`. */
async function seedGame({ ageDays, open = false }) {
    const gameId = `game_arch_${++counter}`;
    const startedAt = Date.now() - ageDays * DAY;

    const gameKey = await gamelog.openGame({
        gameId, roomId: 'ARCH', gameMode: 'short', pointThreshold: 50,
        startedAt
    }, [0, 1, 2, 3].map(seat => ({
        seat, fromRound: 1, occupant: 'bot_heuristic',
        subjectKey: `Bot ${seat + 1}`, policyGen: 1
    })));

    const hands = deal(makeRng(counter));
    const tape = [];
    const live = playRound(seats4, hands, null, p => tape.push(p));
    const startSeat = hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D'));

    await gamelog.writeRound(gameKey, {
        roundNumber: 1, deal: encodeDeal(hands), startSeat,
        endReason: 'normal', winnerSeat: live.winnerSeat,
        startedAt, endedAt: startedAt + 60000,
        cardsLeft: live.cardsLeft, roundPoints: live.cardsLeft, scoreAfter: live.cardsLeft
    }, tape.map(p => ({
        ply: p.ply, seat: p.seat, action: p.action, cardsMask: p.cards_mask,
        handType: p.hand_type, handValue: p.hand_value, source: SOURCE.BOT
    })));

    if (!open) {
        await gamelog.closeGame(gameKey, {
            endedAt: startedAt + 60000, endReason: 'threshold', totalRounds: 1,
            winnerSeat: live.winnerSeat
        });
    }
    // openGame stamps started_at from the caller, but closeGame does not
    // backdate; set it explicitly so age filters see what we intend.
    const { run } = await gamelog.openForRead();
    await run('UPDATE mlog_game SET started_at = ? WHERE game_key = ?', [startedAt, gameKey]);

    return { gameKey, gameId };
}

const quiet = async (fn) => {
    const log = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = log; }
};

const countGames = async () => {
    const { get } = await gamelog.openForRead();
    return (await get('SELECT COUNT(*) AS n FROM mlog_game')).n;
};

test('seed a corpus spanning several ages', async () => {
    await seedGame({ ageDays: 1 });
    await seedGame({ ageDays: 5 });
    await seedGame({ ageDays: 45 });
    await seedGame({ ageDays: 60 });
    await seedGame({ ageDays: 400 });
    assert.strictEqual(await countGames(), 5);
});

test('a dry run changes nothing', async () => {
    const before = await countGames();
    process.argv = ['node', 'archive', '--out', path.join(tmpDir, 'a1'), '--dry-run'];
    const { main } = require('../scripts/archive-gamelog');
    assert.strictEqual(await quiet(main), 0);
    assert.strictEqual(await countGames(), before, 'dry run must not delete');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'a1')), 'dry run must not write shards');
});

test('archiving exports before deleting, and only touches old games', async () => {
    const outDir = path.join(tmpDir, 'a2');
    process.argv = ['node', 'archive', '--out', outDir, '--older-than', '30',
                    '--retention', '3650'];
    const { main } = require('../scripts/archive-gamelog');
    assert.strictEqual(await quiet(main), 0);

    // The 45, 60 and 400 day games go; the 1 and 5 day games stay.
    assert.strictEqual(await countGames(), 2);

    const stamp = new Date().toISOString().slice(0, 10);
    const shardDir = path.join(outDir, stamp);
    const shards = fs.readdirSync(shardDir).filter(f => f.endsWith('.jsonl.gz'));
    assert.ok(shards.length > 0, 'must have written shards before deleting');
});

test('archiving removes the child rows too', async () => {
    const { get } = await gamelog.openForRead();
    const orphanActions = await get(
        `SELECT COUNT(*) AS n FROM mlog_action
          WHERE game_key NOT IN (SELECT game_key FROM mlog_game)`
    );
    const orphanRounds = await get(
        `SELECT COUNT(*) AS n FROM mlog_round
          WHERE game_key NOT IN (SELECT game_key FROM mlog_game)`
    );
    const orphanSeats = await get(
        `SELECT COUNT(*) AS n FROM mlog_seat
          WHERE game_key NOT IN (SELECT game_key FROM mlog_game)`
    );
    assert.strictEqual(orphanActions.n, 0);
    assert.strictEqual(orphanRounds.n, 0);
    assert.strictEqual(orphanSeats.n, 0);
});

test('an open game is never archived', async () => {
    // It may still be written to. Archiving it would silently truncate a game
    // that is mid-play.
    await seedGame({ ageDays: 90, open: true });
    const before = await countGames();

    process.argv = ['node', 'archive', '--out', path.join(tmpDir, 'a3'),
                    '--older-than', '30', '--retention', '3650'];
    const { main } = require('../scripts/archive-gamelog');
    await quiet(main);

    const { get } = await gamelog.openForRead();
    const stillOpen = await get('SELECT COUNT(*) AS n FROM mlog_game WHERE ended_at IS NULL');
    assert.strictEqual(stillOpen.n, 1, 'the open game must survive');
    assert.strictEqual(await countGames(), before);
});

test('retention deletes past the window even without archiving', async () => {
    // Privacy does not wait on tooling: a game that was never exported is
    // still removed on schedule.
    const { gameKey } = await seedGame({ ageDays: 200 });
    const { get } = await gamelog.openForRead();
    assert.ok(await get('SELECT 1 FROM mlog_game WHERE game_key = ?', [gameKey]));

    // Archive window far in the future so nothing is exported; retention short.
    process.argv = ['node', 'archive', '--out', path.join(tmpDir, 'a4'),
                    '--older-than', '9999', '--retention', '180'];
    const { main } = require('../scripts/archive-gamelog');
    await quiet(main);

    const gone = await get('SELECT 1 FROM mlog_game WHERE game_key = ?', [gameKey]);
    assert.strictEqual(gone, undefined, 'expired raw tape must be deleted');
});

test('recent games survive every pass', async () => {
    const { get } = await gamelog.openForRead();
    const remaining = await get('SELECT COUNT(*) AS n FROM mlog_game WHERE started_at > ?',
        [Date.now() - 30 * DAY]);
    assert.ok(remaining.n >= 2, 'recent games must never be touched');
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
