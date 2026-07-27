// server/test/roomLifecycle.test.js
//
// Room bookkeeping that outlives a single round: when the current game started,
// and who each seat belongs to once players have been swapped out of it. Both
// feed game_history, and both used to be read off the wrong field -- duration
// from the room's creation rather than the game's start, and participants from
// whoever happened to be sitting in the seat at teardown.

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../game/RoomManager');

const humanSeat = (name, extra = {}) => ({
    id: `sock_${name}`,
    name,
    isBot: false,
    ...extra
});

let roomCounter = 0;

// A room with `humans` real players; startGame() fills the rest with bots.
const startedRoom = (humans = ['Alice', 'Bob', 'Cara', 'Dan']) => {
    const room = new Room(`ROOM${++roomCounter}`, 'short');
    for (const name of humans) room.addPlayer(humanSeat(name));
    room.startGame();
    return { room };
};

test('gameStartedAt is stamped by startGame, not by room creation', () => {
    const room = new Room('LOBBY', 'short');

    // A room waits in the lobby before anyone presses Start. Charging the game
    // for that wait is what the old room.createdAt reading did.
    assert.strictEqual(room.gameStartedAt, null);

    room.addPlayer(humanSeat('Alice'));
    room.startGame();

    assert.ok(room.gameStartedAt >= room.createdAt);
    assert.strictEqual(typeof room.gameStartedAt, 'number');
});

test('a rematch restamps gameStartedAt, so its duration excludes the previous game', async () => {
    const { room } = startedRoom(['Alice', 'Bob']);
    const firstGameStartedAt = room.gameStartedAt;
    const firstGameId = room.gameId;

    await new Promise(r => setTimeout(r, 5));

    room.gameState = 'finished';
    room.startRematch();

    // In lockstep with the new gameId the rematch mints: the field describes
    // the game, so it has to change exactly when the game's identity does.
    assert.notStrictEqual(room.gameId, firstGameId);
    assert.ok(room.gameStartedAt > firstGameStartedAt);

    // createdAt still describes the room, and nothing about the room changed.
    assert.ok(room.gameStartedAt > room.createdAt);
});

test('a lobby restart restamps gameStartedAt too', async () => {
    const { room } = startedRoom(['Alice', 'Bob']);
    const firstGameStartedAt = room.gameStartedAt;

    await new Promise(r => setTimeout(r, 5));

    room.gameState = 'finished';
    room.transitionToLobby();
    // Back in the lobby the stamp is stale by design; it is the *previous*
    // game's start until someone presses Start again.
    room.startGame();

    assert.ok(room.gameStartedAt > firstGameStartedAt);
});

test('describeParticipants credits a seat to the human who left it', () => {
    const { room } = startedRoom(['Alice', 'Bob', 'Cara', 'Dan']);
    room.roundsWonByName = { Alice: 2, Bob: 1 };
    room.cumulativeScores[room.players[0].id] = 17;

    const alice = room.players[0];
    assert.strictEqual(alice.name, 'Alice');
    room.replaceWithBot(alice.id);

    // The seat is played by a bot now, and its display name says so.
    assert.strictEqual(room.players[0].isBot, true);
    assert.strictEqual(room.players[0].name, 'Bot (Alice)');

    // But the row is about Alice, who is the one who quit.
    const seats = room.describeParticipants();
    assert.strictEqual(seats[0].username, 'Alice');
    assert.strictEqual(seats[0].isBot, false);

    // Score survives the id migration replaceWithBot performs...
    assert.strictEqual(seats[0].score, 17);
    // ...and rounds won resolve, since roundsWonByName is keyed on the human's
    // name and would read 0 against 'Bot (Alice)'.
    assert.strictEqual(seats[0].roundsWon, 2);
});

test('describeParticipants reports genuine bots as bots', () => {
    const { room } = startedRoom(['Alice']);

    const seats = room.describeParticipants();
    assert.strictEqual(seats.length, 4);
    assert.strictEqual(seats[0].username, 'Alice');
    assert.strictEqual(seats[0].isBot, false);

    // Auto-filled seats were never anyone's.
    for (const seat of seats.slice(1)) {
        assert.strictEqual(seat.isBot, true);
        assert.ok(seat.username.startsWith('Bot '));
    }
});

test('describeParticipants keeps a departed guest un-attributable', () => {
    const { room } = startedRoom(['Alice', 'Guest123']);
    const guest = room.players.find(p => p.name === 'Guest123');
    guest.isGuest = true;

    room.replaceWithBot(guest.id);

    const seat = room.describeParticipants().find(s => s.username === 'Guest123');
    // Recorded as a person rather than a bot, but flagged so index.js does not
    // try to resolve an account for a name that never had one.
    assert.strictEqual(seat.isBot, false);
    assert.strictEqual(seat.isGuest, true);
});

// The whole point of the last_human_left abandon path: every seat is a bot by
// the time the room is torn down, so reading room.players directly recorded a
// rage quit with nobody in it.
test('a room emptied of humans still names them in describeParticipants', () => {
    const { room } = startedRoom(['Alice', 'Bob']);

    for (const name of ['Alice', 'Bob']) {
        room.replaceWithBot(room.players.find(p => p.name === name).id);
    }

    assert.strictEqual(room.hasOnlyBots(), true);

    const named = room.describeParticipants().filter(s => !s.isBot).map(s => s.username);
    assert.deepStrictEqual(named.sort(), ['Alice', 'Bob']);
});
