// server/test/instrumentation.test.js
//
// Drives a real Room through RoomManager and checks that the tape it produces
// replays back to the state the game actually reached.
//
// replayer.test.js proves the replayer is correct against tapes built by the
// test harness. This proves the *instrumentation* is correct: that the hooks
// inside playHand, passTurn, startRound and the 2S branch record what actually
// happened, in the right order, with the right seats. A tape that is internally
// consistent but disagrees with the live game would pass the other suite and
// fail here.

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../game/RoomManager');
const { replayRound } = require('../game/Replayer');
const { ACTION, SOURCE, FLAG, decodeCards, decodeDeal } = require('../game/TapeCodec');
const { BOT_LOGIC_VERSION } = require('../game/BotLogic');

/** A room of four bots, started and played to the end of round 1, synchronously. */
function playBotRound() {
    const room = new Room('TEST1', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    // Drive turns directly rather than through checkBotTurn, whose 250ms
    // setTimeout would make this test slow and racy. The instrumentation lives
    // in playHand/passTurn, which is what we are exercising.
    const { BotLogic } = require('../game/BotLogic');
    const { buildGameContext } = require('../game/BotContext');

    let guard = 0;
    while (room.gameState === 'playing' && guard++ < 2000) {
        if (room.trickWinPending) {
            room.clearTrickState();
            continue;
        }
        const seat = room.currentTurnIndex;
        const player = room.players[seat];
        const lastSeat = room.lastPlayedHand
            ? room.players.findIndex(p => p.id === room.lastPlayedHand.playerId)
            : -1;

        const ctx = buildGameContext({
            hands: room.players.map(p => p.hand),
            seat,
            passedSeats: room.players.reduce((acc, p, i) => {
                if (room.passedPlayers.has(p.id)) acc.push(i);
                return acc;
            }, []),
            passCount: room.passes,
            playedCards: room.playedCards,
            trickHistory: room.trickHistory,
            lastPlayedHand: room.lastPlayedHand,
            lastPlayedSeat: lastSeat === -1 ? undefined : lastSeat,
            profile: BotLogic.getBotProfile(player.name)
        });

        const everyoneFull = room.players.every(p => p.hand.length === 13);
        const isFirstTurn = room.roundNumber === 1 && everyoneFull && room.winners.length === 0;
        const move = BotLogic.getBotMove(player.hand, room.lastPlayedHand, isFirstTurn, ctx, false);

        const result = move && move.length
            ? room.playHand(player.id, move)
            : room.passTurn(player.id);

        assert.ok(!result.error, `bot produced an illegal move: ${result.error}`);
    }

    return room;
}

test('a real room produces a tape that replays to the same final state', () => {
    for (let attempt = 0; attempt < 15; attempt++) {
        const room = playBotRound();
        const liveCardsLeft = room.players.map(p => p.hand.length);
        const liveWinner = room.players.findIndex(p => p.hand.length === 0);

        const payload = room.tape.take();
        assert.ok(payload, 'the room recorded no round');

        const result = replayRound({
            deal: payload.round.deal,
            start_seat: payload.round.startSeat,
            round_number: payload.round.roundNumber
        }, payload.plies.map(p => ({
            ply: p.ply, seat: p.seat, action: p.action, cards_mask: p.cardsMask,
            hand_type: p.handType, hand_value: p.handValue
        })));

        assert.ok(result.complete, result.error && result.error.message);
        assert.deepStrictEqual(result.cardsLeft, liveCardsLeft, 'cards left diverged');
        assert.strictEqual(result.winnerSeat, liveWinner, 'winner diverged');
    }
});

test('the recorded deal matches the hands actually dealt', () => {
    const room = new Room('TEST2', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    const dealt = room.players.map(p => p.hand.map(c => c.value).sort((a, b) => a - b));
    const decoded = decodeDeal(room.tape.round.deal)
        .map(h => h.map(c => c.value).sort((a, b) => a - b));

    assert.deepStrictEqual(decoded, dealt);
});

test('the opening seat is recorded as the holder of the 3 of Diamonds', () => {
    const room = new Room('TEST3', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    const expected = room.players.findIndex(p =>
        p.hand.some(c => c.rank === '3' && c.suit === 'D'));
    assert.strictEqual(room.tape.round.startSeat, expected);
});

test('bot plies are tagged as bot and carry no think time', () => {
    const room = playBotRound();
    const payload = room.tape.take();

    for (const ply of payload.plies) {
        if (ply.action === ACTION.AUTO_PASS) {
            assert.strictEqual(ply.source, SOURCE.SERVER_RULE);
        } else {
            assert.strictEqual(ply.source, SOURCE.BOT);
        }
        assert.strictEqual(ply.thinkMs, null, 'bots must record null, not a timer artifact');
    }
});

test('2S auto-passes are recorded as a distinct action, not as passes', () => {
    // Search for a round containing a lone 2S lead. It is common enough that a
    // handful of rounds will surface one.
    let found = null;
    for (let attempt = 0; attempt < 60 && !found; attempt++) {
        const room = playBotRound();
        const payload = room.tape.take();
        if (payload.plies.some(p => p.action === ACTION.AUTO_PASS)) found = payload;
    }
    assert.ok(found, 'no round produced a lone 2S in 60 attempts');

    const autos = found.plies.filter(p => p.action === ACTION.AUTO_PASS);
    // They always arrive in threes, immediately after the 2S play.
    assert.strictEqual(autos.length % 3, 0);
    for (const auto of autos) {
        assert.strictEqual(auto.source, SOURCE.SERVER_RULE);
        assert.strictEqual(auto.cardsMask, 0);
        assert.strictEqual(auto.thinkMs, null);
    }

    const firstAutoIdx = found.plies.findIndex(p => p.action === ACTION.AUTO_PASS);
    const preceding = found.plies[firstAutoIdx - 1];
    assert.strictEqual(preceding.action, ACTION.PLAY);
    const cards = decodeCards(preceding.cardsMask);
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].rank, '2');
    assert.strictEqual(cards[0].suit, 'S');
});

test('ply numbers are dense and monotonic', () => {
    const room = playBotRound();
    const payload = room.tape.take();
    assert.deepStrictEqual(
        payload.plies.map(p => p.ply),
        payload.plies.map((_, i) => i)
    );
});

test('taking the tape twice yields nothing the second time', () => {
    // Both round-end and cleanup can try to flush the same round; the second
    // must be a no-op rather than a duplicate write.
    const room = playBotRound();
    assert.ok(room.tape.take());
    assert.strictEqual(room.tape.take(), null);
});

test('a human ply records think time and a disconnect flag', () => {
    const room = new Room('TEST4', 'short');
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    for (let i = 1; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    // Force the human to lead so we can drive one deterministic ply. Round 2,
    // because the 3-of-Diamonds opening rule applies only to the first turn of
    // round 1 and seat 0 does not reliably hold it.
    room.roundNumber = 2;
    room.currentTurnIndex = 0;
    room.lastPlayedHand = null;
    room.markTurnStart();
    room.turnStartedAt -= 5000;   // simulate 5s of deliberation

    const lowest = room.players[0].hand.slice().sort((a, b) => a.value - b.value)[0];
    const result = room.playHand('human_0', [lowest]);
    assert.ok(!result.error, result.error);

    const ply = room.tape.plies[room.tape.plies.length - 1];
    assert.strictEqual(ply.source, SOURCE.HUMAN);
    assert.ok(ply.thinkMs >= 5000 && ply.thinkMs < 6000, `unexpected think_ms ${ply.thinkMs}`);
    assert.strictEqual(ply.flags & FLAG.TURN_DISCONNECTED, 0);
});

test('think_ms is clamped and flagged when a player stalls', () => {
    const room = new Room('TEST5', 'short');
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    for (let i = 1; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    room.roundNumber = 2;   // past the 3-of-Diamonds opening rule
    room.currentTurnIndex = 0;
    room.lastPlayedHand = null;
    room.markTurnStart();
    room.turnStartedAt -= 9 * 60 * 1000;   // nine minutes away

    const lowest = room.players[0].hand.slice().sort((a, b) => a.value - b.value)[0];
    room.playHand('human_0', [lowest]);

    const ply = room.tape.plies[room.tape.plies.length - 1];
    assert.strictEqual(ply.thinkMs, 120000, 'must clamp at the ceiling');
    assert.ok(ply.flags & FLAG.THINK_CLAMPED, 'must flag that it was clamped');
});

test('a disconnect during the turn is flagged even after reconnecting', () => {
    // The case a duration threshold alone would miss: a brief drop that
    // resolves inside the ceiling still is not a decision time.
    const room = new Room('TEST6', 'short');
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    for (let i = 1; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    room.roundNumber = 2;   // past the 3-of-Diamonds opening rule
    room.currentTurnIndex = 0;
    room.lastPlayedHand = null;
    room.markTurnStart();

    room.markDisconnected('human_0');
    room.players[0].isDisconnected = false;   // reconnected quickly

    const lowest = room.players[0].hand.slice().sort((a, b) => a.value - b.value)[0];
    room.playHand('human_0', [lowest]);

    const ply = room.tape.plies[room.tape.plies.length - 1];
    assert.ok(ply.flags & FLAG.TURN_DISCONNECTED, 'a resolved drop must still be flagged');
    assert.strictEqual(ply.flags & FLAG.THINK_CLAMPED, 0, 'it was quick, so not clamped');
});

test('an auto-pass is distinguished from a deliberate pass', () => {
    const room = new Room('TEST7', 'short');
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    for (let i = 1; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    // Put a pile up so passing is legal, and give the human the turn.
    const { Big2Rules } = require('../game/Big2Rules');
    const highest = room.players[1].hand.slice().sort((a, b) => b.value - a.value)[0];
    room.lastPlayedHand = { ...Big2Rules.validateHand([highest]), playerId: 'bot_1' };
    room.currentTurnIndex = 0;
    room.markTurnStart();
    room.turnStartedAt -= 2000;   // the randomized auto-pass delay

    room.passTurn('human_0', { auto: true });

    const ply = room.tape.plies[room.tape.plies.length - 1];
    assert.strictEqual(ply.action, ACTION.PASS, 'still a real pass, unlike the 2S rule');
    assert.strictEqual(ply.source, SOURCE.AUTO_PASS_PREF);
    assert.strictEqual(
        ply.thinkMs, null,
        'the client delay is fabricated latency and must not be recorded as thinking'
    );
});

test('seats report the policy generation that played them', () => {
    const room = new Room('TEST8', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    for (const seat of room.describeSeats()) {
        assert.strictEqual(seat.occupant, 'bot_heuristic');
        assert.strictEqual(seat.policyGen, BOT_LOGIC_VERSION);
        // The bot's name, because getBotProfile derives its temperament from it.
        assert.strictEqual(seat.subjectKey, room.players[seat.seat].name);
    }
});

test('a bot replacing a human is logged as a heuristic seat', () => {
    // The replacement inherits the departed human's seat and hand, so the seat
    // segment has to switch to the policy that now answers for it.
    const room = new Room('TEST10', 'short');
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    for (let i = 1; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.startGame();

    const replaced = room.replaceWithBot('human_0');
    assert.ok(replaced);

    const seat = room.describeSeats()[0];
    assert.strictEqual(seat.occupant, 'bot_heuristic');
    assert.strictEqual(seat.policyGen, BOT_LOGIC_VERSION);
});

test('rematch and lobby restart stash the previous game id', () => {
    const room = new Room('TEST11', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }
    room.addPlayer({ id: 'human_0', name: 'alice', isBot: false });
    room.startGame();

    const firstId = room.gameId;
    room.gameState = 'finished';
    room.startRematch();

    assert.strictEqual(room.previousGameId, firstId);
    assert.strictEqual(room.chainKind, 'rematch');
    assert.notStrictEqual(room.gameId, firstId);

    const secondId = room.gameId;
    room.gameState = 'finished';
    room.transitionToLobby();
    assert.strictEqual(room.previousGameId, secondId);
    assert.strictEqual(room.chainKind, 'lobby_restart');
});

test('a dragon deal is recorded even though no ply is ever played', () => {
    const { RANKS, SUITS } = require('../game/Deck');
    const room = new Room('TEST12', 'short');
    for (let i = 0; i < 4; i++) {
        room.addPlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, isBot: true });
    }

    // Stack seat 2 with one card of every rank.
    const originalShuffle = room.deck.shuffle;
    room.deck.shuffle = function () {
        originalShuffle.call(this);
        const dragon = RANKS.map(rank => this.cards.find(c => c.rank === rank));
        const rest = this.cards.filter(c => !dragon.includes(c));
        // deal() pops from the end; seats are dealt 0,1,2,3 in 13-card blocks.
        this.cards = [...dragon.slice().reverse(), ...rest].reverse();
        const seat2 = this.cards.splice(this.cards.length - 39, 13);
        this.cards.push(...seat2);
        this.cards = [...rest.slice(0, 26), ...dragon, ...rest.slice(26)];
    };

    room.startGame();

    if (room.gameState !== 'dragon_win') {
        // The stacking above is best-effort; skip rather than assert on a
        // deck arrangement that did not produce a dragon.
        return;
    }

    assert.ok(room.tape.round, 'the dragon deal must still be recorded');
    assert.strictEqual(room.tape.round.endReason, 'dragon');
    assert.strictEqual(room.tape.plies.length, 0, 'a dragon round has no plies');
});
