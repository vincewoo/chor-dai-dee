// server/test/highestSingleRule.test.js
//
// The highest-single endgame rule: with the next player holding one card, any
// single you play must be your highest card, and a single on the pile you can
// beat may not be passed up.
//
// It is a game rule, not bot behaviour, so it has two independent enforcement
// points and both are tested here:
//
//   - Bots comply structurally, in BotLogic.legalCandidates. They score a
//     candidate list and never generate moves, so a filtered list is the whole
//     mechanism. Covered in botLogic.test.js.
//   - Humans send raw cards over the socket, so Room.playHand and Room.passTurn
//     are the only thing standing between a client and an illegal move. That is
//     what this file covers, along with the pure rule in Big2Rules.
//
// Deliberately NOT enforced in Replayer: tapes written at RULES_VERSION 1
// contain plays this rule forbids, and replay has to keep reproducing the game
// that was actually played.

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../game/RoomManager');
const { Big2Rules, HAND_TYPES } = require('../game/Big2Rules');
const { RANKS, SUITS } = require('../game/Deck');

const card = (s) => {
    const suit = s.slice(-1), rank = s.slice(0, -1);
    return { rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) };
};
const hand = (str) => str.split(' ').map(card);

let roomCounter = 0;

/**
 * A room mid-round with hands and turn state forced into a known position.
 * `hands` is seat-indexed; seat 0 is the player to move, so seat 1 is the
 * "next player" the rule reads.
 */
const positioned = ({ hands, pile = null }) => {
    const room = new Room(`RULE${++roomCounter}`, 'short');
    for (const name of ['Alice', 'Bob', 'Cara', 'Dan']) {
        room.addPlayer({ id: `sock_${name}`, name, isBot: false });
    }
    room.startGame();

    room.players.forEach((p, i) => { p.hand = hands[i]; });
    room.currentTurnIndex = 0;
    room.gameState = 'playing';
    room.trickWinPending = false;
    room.lastPlayedHand = pile
        ? { ...Big2Rules.validateHand(pile), cards: pile, playerId: room.players[3].id }
        : null;
    // Round 1 with full hands would trip the 3-of-Diamonds opener check, which
    // is a different rule and not the one under test.
    room.roundNumber = 2;
    return room;
};

// --- the pure rule ---------------------------------------------------------

test('the rule reads the next seat, and only exactly one card', () => {
    assert.strictEqual(Big2Rules.highestSingleRuleApplies(1), true);
    assert.strictEqual(Big2Rules.highestSingleRuleApplies(2), false);
    assert.strictEqual(Big2Rules.highestSingleRuleApplies(13), false);
    // The round ends the instant a hand empties, so zero is not a position a
    // seated player can be in. It must not read as "even more urgent".
    assert.strictEqual(Big2Rules.highestSingleRuleApplies(0), false);
});

test('restriction touches singles and nothing else', () => {
    const moves = [
        { type: HAND_TYPES.SINGLE, value: 4 },
        { type: HAND_TYPES.SINGLE, value: 40 },
        { type: HAND_TYPES.PAIR, value: 9 },
        { type: HAND_TYPES.FLUSH, value: 30 }
    ];

    assert.deepStrictEqual(Big2Rules.restrictToHighestSingle(moves, 5), moves);

    const restricted = Big2Rules.restrictToHighestSingle(moves, 1);
    assert.deepStrictEqual(restricted.map(m => m.value), [40, 9, 30]);
});

test('passing is forbidden only against a single that can be beaten', () => {
    const beatable = [{ type: HAND_TYPES.SINGLE, value: 40 }];
    const single = { type: HAND_TYPES.SINGLE, value: 20 };
    const pair = { type: HAND_TYPES.PAIR, value: 20 };

    assert.strictEqual(Big2Rules.mustBeatSingle(beatable, single, 1), true);
    assert.strictEqual(Big2Rules.mustBeatSingle(beatable, single, 4), false,
        'rule is off when the next player is comfortable');
    assert.strictEqual(Big2Rules.mustBeatSingle([], single, 1), false,
        'nothing to force when nothing beats the pile');
    assert.strictEqual(Big2Rules.mustBeatSingle(beatable, pair, 1), false,
        'a pair on the pile stays a priced decision');
});

// --- human plays -----------------------------------------------------------

test('a human may not answer a single with anything but their highest card', () => {
    const room = positioned({
        hands: [hand('4S 6C KD 2C'), hand('9H'), hand('3D 3C'), hand('5H 5S')],
        pile: hand('7D')
    });
    const me = room.players[0].id;

    const rejected = room.playHand(me, hand('KD'));
    assert.ok(rejected.error, 'a King is legal by canBeat but not under the rule');
    assert.match(rejected.error, /highest card/);

    const accepted = room.playHand(me, hand('2C'));
    assert.ok(!accepted.error, accepted.error);
});

test('a human may not pass up a single they can beat', () => {
    const room = positioned({
        hands: [hand('4S 6C KD 2C'), hand('9H'), hand('3D 3C'), hand('5H 5S')],
        pile: hand('7D')
    });

    const rejected = room.passTurn(room.players[0].id);
    assert.ok(rejected.error);
    assert.match(rejected.error, /must beat this single/);
});

test('passing stays legal when nothing in hand beats the single', () => {
    const room = positioned({
        hands: [hand('4S 6C'), hand('9H'), hand('3D 3C'), hand('5H 5S')],
        pile: hand('KD')
    });

    const result = room.passTurn(room.players[0].id);
    assert.ok(!result.error, result.error);
});

test('passing stays legal against a pair, even with the next player on one card', () => {
    // The rule speaks about singles. A pair on the pile is still a decision the
    // player gets to make, and the bot still prices it.
    const room = positioned({
        hands: [hand('4S 4C 6C KD'), hand('9H'), hand('3D 3C'), hand('5H 5S')],
        pile: hand('3H 3S')
    });

    const result = room.passTurn(room.players[0].id);
    assert.ok(!result.error, result.error);
});

test('leading constrains singles but leaves every other shape alone', () => {
    const room = positioned({
        hands: [hand('4S 4C 6C 2C'), hand('9H'), hand('3D 3C'), hand('5H 5S')]
    });
    const me = room.players[0].id;

    assert.ok(room.playHand(me, hand('6C')).error, 'a low single lead is forbidden');

    // The pair is untouched: the rule constrains which single you may play, not
    // which shape you must play.
    const pair = room.playHand(me, hand('4S 4C'));
    assert.ok(!pair.error, pair.error);
});

test('the rule is off entirely while the next player holds more than one card', () => {
    const room = positioned({
        hands: [hand('4S 6C KD 2C'), hand('9H 9S'), hand('3D 3C'), hand('5H 5S')],
        pile: hand('7D')
    });
    const me = room.players[0].id;

    const played = room.playHand(me, hand('KD'));
    assert.ok(!played.error, played.error);
});

test('an opponent across the table on one card does not trigger the rule', () => {
    // The seat that matters is the one that acts next. Across and previous both
    // have seats between them and us that still act, so our move cannot hand
    // them the lead - the same asymmetry BotLogic's emergency branch rests on.
    const room = positioned({
        hands: [hand('4S 6C KD 2C'), hand('9H 9S'), hand('3D'), hand('5H 5S')],
        pile: hand('7D')
    });

    const played = room.playHand(room.players[0].id, hand('KD'));
    assert.ok(!played.error, played.error);
});
