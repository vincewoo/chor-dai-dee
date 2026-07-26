// server/test/gamelogReview.test.js
//
// The review endpoint's read path. What matters here is not the grading -
// moveReview.test.js pins that - but the refusals, because this is the one
// surface that replays a deal and therefore knows every hand at the table.
// Handing that to the wrong person, or handing it over while the game is still
// being played, is the failure mode worth testing hardest.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Fresh database, logging on. Set before requiring the module: gamelog reads
// both at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelog-review-test-'));
process.env.GAMELOG_PATH = path.join(tmpDir, 'gamelog.sqlite');
process.env.GAMELOG_ENABLED = '1';
process.env.GAMELOG_EXPORT_SECRET = 'test-secret';

const gamelog = require('../gamelog');
const { makeRng, deal, playRound } = require('./botHarness');
const { BotLogic } = require('../game/BotLogic');
const { encodeDeal, SOURCE } = require('../game/TapeCodec');
const { reviewForUser, forget, ReviewUnavailable, seatResolver } = require('../gamelogReview');

const USER = 42;
const OTHER = 77;

const seats4 = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));

/** Logs a complete game with `userId` seated at `userSeat`. */
async function logGame(gameId, { close = true, userSeat = 0, rounds = 6, seatOverrides = null } = {}) {
    const rng = makeRng(gameId.length * 977 + 13);
    const seatRows = seatOverrides || [0, 1, 2, 3].map(s => ({
        seat: s, fromRound: 1,
        occupant: s === userSeat ? 'human' : 'bot_heuristic',
        subjectKey: `S${s}`, policyGen: 1,
        userId: s === userSeat ? USER : null
    }));

    const gameKey = await gamelog.openGame({
        gameId, roomId: 'ROOM1', gameMode: 'standard', pointThreshold: 100,
        advancedBots: false, startedAt: Date.now()
    }, seatRows);

    for (let r = 1; r <= rounds; r++) {
        const hands = deal(rng);
        const tape = [];
        const res = playRound(seats4, hands, r === 1 ? null : 0, p => tape.push(p));
        await gamelog.writeRound(gameKey, {
            roundNumber: r,
            deal: encodeDeal(hands),
            startSeat: r === 1
                ? hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D'))
                : 0,
            endReason: 'normal', winnerSeat: res.winnerSeat,
            startedAt: Date.now(), endedAt: Date.now(),
            cardsLeft: res.cardsLeft, roundPoints: [0, 0, 0, 0], scoreAfter: [0, 0, 0, 0]
        }, tape.map(p => ({
            ply: p.ply, seat: p.seat, action: p.action, cardsMask: p.cards_mask,
            handType: p.hand_type ?? null, handValue: p.hand_value ?? null,
            thinkMs: 900, source: SOURCE.HUMAN, flags: 0
        })));
    }

    if (close) {
        await gamelog.closeGame(gameKey, {
            endedAt: Date.now(), endReason: 'threshold', totalRounds: rounds, winnerSeat: 1
        });
    }
    return gameKey;
}

const refusal = async (fn) => {
    try {
        await fn();
        return null;
    } catch (err) {
        if (!(err instanceof ReviewUnavailable)) throw err;
        return err;
    }
};

// --- refusals ----------------------------------------------------------------

test('a game with no tape is not an error, it is gone', async () => {
    const err = await refusal(() => reviewForUser('never-logged', USER));
    assert.ok(err, 'must refuse');
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.reason, 'no_tape');
});

test('a game still in progress is refused', async () => {
    // The guard that stops this endpoint being a way to read the table
    // mid-game: a review replays the deal, so it knows every hand.
    await logGame('in-progress', { close: false });

    const err = await refusal(() => reviewForUser('in-progress', USER));
    assert.ok(err, 'must refuse');
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.reason, 'game_in_progress');
});

test('a game the account did not play in is refused', async () => {
    await logGame('someone-elses');

    const err = await refusal(() => reviewForUser('someone-elses', OTHER));
    assert.ok(err, 'must refuse');
    assert.strictEqual(err.status, 403);
    assert.strictEqual(err.reason, 'not_a_participant');
});

// --- the happy path ----------------------------------------------------------

test('a finished game the account played in reviews', async () => {
    await logGame('mine');
    const review = await reviewForUser('mine', USER);

    assert.strictEqual(review.gameId, 'mine');
    assert.strictEqual(review.gameMode, 'standard');
    assert.ok(review.summary.decisionsGraded > 0);
    assert.deepStrictEqual(review.summary.unreadableRounds, []);
    assert.ok(Array.isArray(review.highlights));
});

test('the limit is honoured', async () => {
    await logGame('capped');
    forget('capped');
    const two = await reviewForUser('capped', USER, { limit: 2 });
    assert.ok(two.highlights.length <= 2);
});

test('a review is cached, since a finished game cannot change', async () => {
    await logGame('cached');

    const first = await reviewForUser('cached', USER);
    const second = await reviewForUser('cached', USER);
    assert.strictEqual(first, second, 'same object, served from cache');

    forget('cached');
    const third = await reviewForUser('cached', USER);
    assert.notStrictEqual(first, third, 'forget() forces a rebuild');
    assert.deepStrictEqual(first.summary, third.summary, 'and rebuilds identically');
});

// --- seat attribution ---------------------------------------------------------

test('a seat the account gave up mid-game stops being theirs', async () => {
    // Occupancy is a property of the round, not the game. A player who leaves
    // after round 3 and is replaced by a bot must not be credited - or blamed -
    // for what the bot did in rounds 4 to 6.
    await logGame('handover', {
        seatOverrides: [
            { seat: 0, fromRound: 1, toRound: 4, occupant: 'human', subjectKey: 'S0', userId: USER },
            { seat: 0, fromRound: 4, occupant: 'bot_heuristic', subjectKey: 'B0', segment: 1, policyGen: 1 },
            { seat: 1, fromRound: 1, occupant: 'bot_heuristic', subjectKey: 'S1', policyGen: 1 },
            { seat: 2, fromRound: 1, occupant: 'bot_heuristic', subjectKey: 'S2', policyGen: 1 },
            { seat: 3, fromRound: 1, occupant: 'bot_heuristic', subjectKey: 'S3', policyGen: 1 }
        ]
    });

    const review = await reviewForUser('handover', USER);
    const rounds = new Set(review.highlights.map(h => h.roundNumber));

    assert.ok(review.summary.decisionsGraded > 0, 'the rounds they did play were graded');
    for (const round of rounds) {
        assert.ok(round < 4, `round ${round} belonged to the bot that took the seat`);
    }
});

test('seatResolver returns null for an account that never sat down', () => {
    const segments = [
        [{ seat: 0, from_round: 1, to_round: null, user_id: USER }],
        [{ seat: 1, from_round: 1, to_round: null, user_id: null }],
        [{ seat: 2, from_round: 1, to_round: null, user_id: null }],
        [{ seat: 3, from_round: 1, to_round: null, user_id: null }]
    ];

    assert.strictEqual(seatResolver(segments, OTHER), null);

    const resolve = seatResolver(segments, USER);
    assert.strictEqual(resolve(1), 0);
    assert.strictEqual(resolve(9), 0, 'an open-ended segment covers later rounds');
});

test('the reviewed seat never appears among the opponent hands', async () => {
    await logGame('hands');
    const review = await reviewForUser('hands', USER);

    for (const h of review.highlights) {
        assert.strictEqual(h.opponentHands.length, 4);
        assert.strictEqual(h.opponentHands[0], null, 'seat 0 is the reviewed player');
        assert.ok(h.opponentHands.slice(1).every(Array.isArray));
    }
});

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
