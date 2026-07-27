// server/test/roomLifecycle.test.js
//
// Room bookkeeping that outlives a single round. A room is not a game: it waits
// in the lobby before anyone presses Start, and it is reused for rematches and
// lobby restarts, so a game's duration cannot be measured from the room.

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
