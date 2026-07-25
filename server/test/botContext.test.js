// server/test/botContext.test.js
//
// The observation builder had no direct coverage before extraction: it lived
// inside RoomManager.checkBotTurn, reachable only by driving a whole room. The
// relative re-indexing is the part most worth pinning - it is off-by-one-prone
// and three callers now depend on it agreeing exactly.

const test = require('node:test');
const assert = require('node:assert');

const { buildGameContext } = require('../game/BotContext');
const { Big2Rules } = require('../game/Big2Rules');

const card = (rank, suit) => {
    const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const SUITS = ['D', 'C', 'H', 'S'];
    return { rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) };
};

const handOf = (n) => Array.from({ length: n }, (_, i) => card('3', 'D'));

// Four hands with distinguishable sizes so re-indexing errors are visible.
const hands = [handOf(10), handOf(11), handOf(12), handOf(13)];

test('card counts are ordered from the next seat, not from seat 0', () => {
    const ctx = buildGameContext({ hands, seat: 0, passedSeats: [] });
    assert.deepStrictEqual(ctx.playerCardCounts, [11, 12, 13]);

    // From seat 2 the order wraps: next=3, across=0, previous=1.
    const ctx2 = buildGameContext({ hands, seat: 2, passedSeats: [] });
    assert.deepStrictEqual(ctx2.playerCardCounts, [13, 10, 11]);
});

test('passed seats are reported relative to the acting seat', () => {
    // Seat 3 has passed. From seat 2 that is the "next" player, index 0.
    const ctx = buildGameContext({ hands, seat: 2, passedSeats: [3] });
    assert.deepStrictEqual(ctx.passedPlayers, [0]);

    // From seat 1, seat 3 is "across", index 1.
    const ctx2 = buildGameContext({ hands, seat: 1, passedSeats: [3] });
    assert.deepStrictEqual(ctx2.passedPlayers, [1]);
});

test('the acting seat never appears in its own passed list', () => {
    const ctx = buildGameContext({ hands, seat: 1, passedSeats: [1, 2] });
    // Only seat 2 shows up, as "next" (index 0). Seat 1 is self.
    assert.deepStrictEqual(ctx.passedPlayers, [0]);
});

test('a Set of passed seats behaves the same as an array', () => {
    const asArray = buildGameContext({ hands, seat: 0, passedSeats: [2, 3] });
    const asSet = buildGameContext({ hands, seat: 0, passedSeats: new Set([2, 3]) });
    assert.deepStrictEqual(asSet.passedPlayers, asArray.passedPlayers);
});

test('play history is re-indexed relative to the acting seat', () => {
    const eight = Big2Rules.validateHand([card('8', 'D')]);
    const trickHistory = [
        { seat: 0, action: 'play', hand: eight },
        { seat: 1, action: 'pass', hand: eight },
        { seat: 2, action: 'pass', hand: eight },
        { seat: 3, action: 'pass', hand: eight }
    ];

    const ctx = buildGameContext({ hands, seat: 1, passedSeats: [], trickHistory });

    // Seat 1 is acting, so its own entry is dropped. Seat 2 is next (1),
    // seat 3 is across (2), seat 0 is previous (3).
    assert.deepStrictEqual(
        ctx.playHistory.map(e => e.relative),
        [3, 1, 2]
    );
    assert.deepStrictEqual(
        ctx.playHistory.map(e => e.action),
        ['play', 'pass', 'pass']
    );
});

test('play history never contains relative 0', () => {
    const eight = Big2Rules.validateHand([card('8', 'D')]);
    const trickHistory = [0, 1, 2, 3].map(seat => ({ seat, action: 'pass', hand: eight }));

    for (let seat = 0; seat < 4; seat++) {
        const ctx = buildGameContext({ hands, seat, passedSeats: [], trickHistory });
        assert.ok(
            ctx.playHistory.every(e => e.relative >= 1 && e.relative <= 3),
            `seat ${seat} produced an out-of-range relative index`
        );
        assert.strictEqual(ctx.playHistory.length, 3);
    }
});

test('entries without a hand are skipped', () => {
    const trickHistory = [
        { seat: 0, action: 'pass', hand: null },
        { seat: 2, action: 'play', hand: Big2Rules.validateHand([card('9', 'S')]) }
    ];
    const ctx = buildGameContext({ hands, seat: 1, passedSeats: [], trickHistory });
    assert.strictEqual(ctx.playHistory.length, 1);
    assert.strictEqual(ctx.playHistory[0].relative, 1);
});

test('lastPlayedByRelative is 1-3 for opponents', () => {
    const pile = Big2Rules.validateHand([card('K', 'H')]);

    // Seat 0 acting, pile played by seat 3 = previous player = 3.
    const ctx = buildGameContext({
        hands, seat: 0, passedSeats: [], lastPlayedHand: pile, lastPlayedSeat: 3
    });
    assert.strictEqual(ctx.lastPlayedByRelative, 3);

    // Seat 3 acting, pile played by seat 0 = next player = 1.
    const ctx2 = buildGameContext({
        hands, seat: 3, passedSeats: [], lastPlayedHand: pile, lastPlayedSeat: 0
    });
    assert.strictEqual(ctx2.lastPlayedByRelative, 1);
});

test('lastPlayedSeat falls back to lastPlayedHand.seat', () => {
    const pile = { ...Big2Rules.validateHand([card('K', 'H')]), seat: 2 };
    const ctx = buildGameContext({ hands, seat: 0, passedSeats: [], lastPlayedHand: pile });
    assert.strictEqual(ctx.lastPlayedByRelative, 2);
});

test('lastPlayedByRelative is null when leading', () => {
    const ctx = buildGameContext({ hands, seat: 0, passedSeats: [], lastPlayedHand: null });
    assert.strictEqual(ctx.lastPlayedByRelative, null);
});

test('seat 0 is not mistaken for a missing pile owner', () => {
    // Guards the falsy-zero trap: seat 0 is a legitimate owner, and an
    // `if (lastPlayedSeat)` check would silently drop it.
    const pile = Big2Rules.validateHand([card('K', 'H')]);
    const ctx = buildGameContext({
        hands, seat: 1, passedSeats: [], lastPlayedHand: pile, lastPlayedSeat: 0
    });
    assert.strictEqual(ctx.lastPlayedByRelative, 3);
});

test('playedCards is copied, not aliased', () => {
    const playedCards = [card('3', 'D')];
    const ctx = buildGameContext({ hands, seat: 0, passedSeats: [], playedCards });
    ctx.playedCards.push(card('4', 'D'));
    assert.strictEqual(playedCards.length, 1, 'caller state was mutated');
});

test('rng is omitted unless supplied, so production shape is unchanged', () => {
    const withoutRng = buildGameContext({ hands, seat: 0, passedSeats: [] });
    assert.ok(!('rng' in withoutRng));

    const fn = () => 0.5;
    const withRng = buildGameContext({ hands, seat: 0, passedSeats: [], rng: fn });
    assert.strictEqual(withRng.rng, fn);
});

test('missing hands count as zero cards rather than throwing', () => {
    // Room players have no `hand` before the first deal.
    const ctx = buildGameContext({ hands: [null, null, null, null], seat: 0, passedSeats: [] });
    assert.deepStrictEqual(ctx.playerCardCounts, [0, 0, 0]);
});
