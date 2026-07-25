// server/test/export.test.js
//
// End to end over the offline path: play real games, persist them, sweep them
// for replay completeness, export them, and read the shards back.
//
// The assertions worth having here are the ones about what must NOT appear in
// the corpus -- server-generated plies, rounds that failed to replay, raw user
// ids -- because those are the failures that produce a plausible-looking
// dataset that quietly teaches the wrong thing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelog-export-'));
process.env.GAMELOG_PATH = path.join(tmpDir, 'gamelog.sqlite');
process.env.GAMELOG_ENABLED = '1';
process.env.GAMELOG_EXPORT_SECRET = 'test-secret';

const gamelog = require('../gamelog');
const { Room } = require('../game/RoomManager');
const { BotLogic } = require('../game/BotLogic');
const { buildGameContext } = require('../game/BotContext');
const { ACTION, SOURCE } = require('../game/TapeCodec');

/** Plays one bot round in a real Room and persists it. */
async function persistRound(roomId, { endReason = 'normal' } = {}) {
    const room = new Room(roomId, 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame(false);

    const gameKey = await gamelog.openGame({
        gameId: room.gameId, roomId: room.id, gameMode: room.gameMode,
        pointThreshold: room.pointThreshold, advancedBots: false, startedAt: Date.now()
    }, room.describeSeats(1));

    let guard = 0;
    while (room.gameState === 'playing' && guard++ < 2000) {
        if (room.trickWinPending) { room.clearTrickState(); continue; }
        const seat = room.currentTurnIndex;
        const player = room.players[seat];
        const lastSeat = room.lastPlayedHand
            ? room.players.findIndex(p => p.id === room.lastPlayedHand.playerId) : -1;
        const ctx = buildGameContext({
            hands: room.players.map(p => p.hand),
            seat,
            passedSeats: room.players.reduce((a, p, i) => {
                if (room.passedPlayers.has(p.id)) a.push(i); return a;
            }, []),
            passCount: room.passes,
            playedCards: room.playedCards,
            trickHistory: room.trickHistory,
            lastPlayedHand: room.lastPlayedHand,
            lastPlayedSeat: lastSeat === -1 ? undefined : lastSeat,
            profile: BotLogic.getBotProfile(player.name)
        });
        const everyoneFull = room.players.every(p => p.hand.length === 13);
        const isFirst = room.roundNumber === 1 && everyoneFull && room.winners.length === 0;
        const move = BotLogic.getBotMove(player.hand, room.lastPlayedHand, isFirst, ctx, false);
        if (move && move.length) room.playHand(player.id, move);
        else room.passTurn(player.id);
    }

    const winnerSeat = room.players.findIndex(p => p.hand.length === 0);
    room.tape.endRound({
        endReason,
        winnerSeat: endReason === 'normal' ? winnerSeat : null,
        cardsLeft: room.players.map(p => p.hand.length),
        roundPoints: room.players.map(p => p.hand.length),
        scoreAfter: room.players.map(p => p.hand.length)
    });
    const payload = room.tape.take();
    await gamelog.writeRound(gameKey, payload.round, payload.plies);
    await gamelog.closeGame(gameKey, {
        endedAt: Date.now(), endReason: 'threshold', totalRounds: 1, winnerSeat
    });

    return { room, gameKey, payload };
}

function readShards(dir) {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl.gz'))
        .sort()
        .flatMap(f => zlib.gunzipSync(fs.readFileSync(path.join(dir, f)))
            .toString('utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line)));
}

let seeded = null;

test('seed the log with real games', async () => {
    seeded = [];
    for (let i = 0; i < 5; i++) {
        seeded.push(await persistRound(`EXP${i}`));
    }
    assert.strictEqual(seeded.length, 5);
});

test('the completeness sweep passes on a freshly written log', async () => {
    const { main } = require('../scripts/verify-gamelog');
    const logs = [];
    const originalLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    const code = await main();
    console.log = originalLog;

    assert.strictEqual(code, 0, logs.join('\n'));
    assert.ok(logs.join('\n').includes('failures   0'), logs.join('\n'));
});

test('the sweep detects a tape with plies removed', async () => {
    // A truncated tape still replays cleanly -- every remaining ply is legal.
    // Only the final hand sizes reveal the loss, which is why the sweep checks
    // them rather than just asking whether replay threw.
    const { get, run } = await gamelog.openForRead();
    const victim = await get(
        `SELECT game_key, round_number, ply_count FROM mlog_round
          WHERE end_reason = 'normal' ORDER BY game_key LIMIT 1`
    );
    const cutoff = victim.ply_count - 3;
    await run('DELETE FROM mlog_action WHERE game_key = ? AND ply >= ?',
        [victim.game_key, cutoff]);

    const { main } = require('../scripts/verify-gamelog');
    const logs = [];
    const originalLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    const code = await main();
    console.log = originalLog;

    assert.strictEqual(code, 1, 'sweep must fail');
    assert.match(logs.join('\n'), /plies are probably missing/);

    // Put it back so later tests see a clean corpus.
    await run('DELETE FROM mlog_round WHERE game_key = ? AND round_number = ?',
        [victim.game_key, victim.round_number]);
    await run('DELETE FROM mlog_game WHERE game_key = ?', [victim.game_key]);
});

test('export produces readable shards with the expected shape', async () => {
    const outDir = path.join(tmpDir, 'out');
    process.argv = ['node', 'export', '--out', outDir];
    const { main } = require('../scripts/export-training-data');
    const originalLog = console.log;
    console.log = () => {};
    const code = await main();
    console.log = originalLog;

    assert.strictEqual(code, 0);
    const records = readShards(outDir);
    assert.ok(records.length > 50, `expected a real corpus, got ${records.length}`);

    const r = records[0];
    for (const key of ['game', 'round', 'ply', 'seat', 'occupant', 'obs', 'hidden',
                       'action', 'labels', 'rules_version', 'schema_version']) {
        assert.ok(key in r, `missing key ${key}`);
    }
});

test('observation and hidden state stay in separate keys', async () => {
    const records = readShards(path.join(tmpDir, 'out'));
    for (const r of records.slice(0, 100)) {
        assert.ok(Array.isArray(r.hidden.hands) && r.hidden.hands.length === 4);
        // The acting seat's own hand is legitimately in both; the other three
        // must never leak into obs.
        assert.deepStrictEqual(r.obs.hand, r.hidden.hands[r.seat]);
        assert.ok(!('hands' in r.obs), 'obs must not carry all four hands');
        // counts_rel gives sizes, never contents.
        assert.strictEqual(r.obs.counts_rel.length, 3);
    }
});

test('all 52 cards are accounted for in every exported record', async () => {
    const records = readShards(path.join(tmpDir, 'out'));
    for (const r of records.slice(0, 200)) {
        const inHands = r.hidden.hands.flat().length;
        assert.strictEqual(inHands + r.obs.played.length, 52);
    }
});

test('server-generated plies are never exported as decisions', async () => {
    // 2S auto-passes move state but nobody chose them. Emitting them would
    // teach a pass policy to imitate a house rule.
    const records = readShards(path.join(tmpDir, 'out'));
    for (const r of records) {
        assert.notStrictEqual(r.source, SOURCE.SERVER_RULE);
    }
});

test('the action played is present in the legal set', async () => {
    const records = readShards(path.join(tmpDir, 'out'));
    let checked = 0;
    for (const r of records) {
        if (r.action.type !== 'play' || !r.legal) continue;
        const played = r.action.cards.join(',');
        assert.ok(
            r.legal.plays.some(m => m.cards.join(',') === played),
            `${r.game} round ${r.round} ply ${r.ply}: played move absent from legal set`
        );
        checked++;
    }
    assert.ok(checked > 20, `expected to check a meaningful sample, got ${checked}`);
});

test('exports carry no raw user ids', async () => {
    const records = readShards(path.join(tmpDir, 'out'));
    for (const r of records.slice(0, 100)) {
        assert.ok(!('user_id' in r), 'raw user_id must never leave the server');
        // Bot subjects are names; human subjects are HMAC keys prefixed h:.
        if (r.occupant === 'human') assert.match(r.subject, /^h:/);
    }
});

test('labels carry round outcomes and game placement', async () => {
    const records = readShards(path.join(tmpDir, 'out'));
    const r = records[0];
    assert.ok('round_points' in r.labels);
    assert.ok('won_round' in r.labels);
    assert.ok('game_placement' in r.labels);
    assert.ok(r.labels.game_placement >= 1 && r.labels.game_placement <= 4);
});

test('humans-only export is empty for an all-bot corpus', async () => {
    const outDir = path.join(tmpDir, 'humans');
    process.argv = ['node', 'export', '--out', outDir, '--humans-only'];
    const { main } = require('../scripts/export-training-data');
    const originalLog = console.log;
    console.log = () => {};
    await main();
    console.log = originalLog;

    const records = fs.existsSync(outDir) ? readShards(outDir) : [];
    assert.strictEqual(records.length, 0, 'bot games must not appear in a humans-only export');
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
