const test = require('node:test');
const assert = require('node:assert');

const {
    createBotPolicy,
    createCoachAdvisor,
    DEFAULT_PPO_MODEL_PATH,
    PPO_POLICY_GENERATION
} = require('../game/BotPolicy');
const { Room } = require('../game/RoomManager');
const { makeRng, deal, playRound } = require('./botHarness');

test('runtime defaults to the established heuristic policy', () => {
    const policy = createBotPolicy({ mode: 'heuristic' });
    assert.strictEqual(policy.kind, 'heuristic');
    assert.strictEqual(policy.occupant, 'bot_heuristic');
    assert.strictEqual(policy.policyRef, null);
});

test('promoted PPO policy completes canonical legal rounds in JavaScript', () => {
    const policy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH
    });
    const logic = {
        getBotMove: (...args) => policy.getMove(...args)
    };
    for (let seed = 1; seed <= 10; seed++) {
        const result = playRound(
            [0, 1, 2, 3].map(seat => ({
                name: `ppo-${seat}`,
                logic
            })),
            deal(makeRng(seed))
        );
        assert.ok(result.cardsLeft.some(count => count === 0));
    }
});

test('PPO rooms report deployable policy provenance', () => {
    const room = new Room('PPO-PROVENANCE', 'short');
    room.botPolicy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH
    });
    for (let seat = 0; seat < 4; seat++) {
        room.addPlayer({
            id: `bot-${seat}`,
            name: `Bot ${seat + 1}`,
            isBot: true
        });
    }
    room.startGame();
    for (const seat of room.describeSeats()) {
        assert.strictEqual(seat.occupant, 'bot_ppo');
        assert.strictEqual(seat.policyGen, PPO_POLICY_GENERATION);
        assert.strictEqual(seat.policyRef, 'ppo-policy-gpu-v1.json');
    }
});

test('PPO debug mode returns model provenance without changing the move', () => {
    const policy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH
    });
    const cards = deal(makeRng(991))[0];
    const context = {
        playerCardCounts: [13, 13, 13],
        lastPlayedByRelative: null,
        passedPlayers: [],
        passCount: 0,
        playedCards: [],
        playHistory: []
    };
    const plain = policy.getMove(cards, null, false, context);
    const debug = policy.getMove(cards, null, false, context, {
        captureReasoning: true
    });
    assert.deepStrictEqual(debug.cards, plain);
    assert.strictEqual(debug.reasoning.strategy, 'ppo-policy');
    assert.strictEqual(
        debug.reasoning.policyGeneration, PPO_POLICY_GENERATION);
});

test('PPO coach advice matches the guarded runtime policy', () => {
    const policy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH
    });
    const advisor = createCoachAdvisor({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH,
        minMargin: 0
    });
    const cards = deal(makeRng(1776))[0];
    const context = {
        playerCardCounts: [13, 13, 13],
        lastPlayedByRelative: null,
        passedPlayers: [],
        passCount: 0,
        playedCards: [],
        playHistory: []
    };
    const move = policy.getMove(cards, null, false, context);
    const advice = advisor.advise(cards, null, false, context);
    const moveKey = move
        ? move.map(card => `${card.rank}${card.suit}`).sort().join(',')
        : 'pass';
    assert.strictEqual(advice.key, moveKey);
    assert.ok(advice.cards === null ||
        advice.cards.every(card =>
            cards.some(held =>
                held.rank === card.rank && held.suit === card.suit)));
    assert.ok(Number.isFinite(advice.policyMargin));
});

test('deterministic coaching remains the default', () => {
    assert.strictEqual(
        createCoachAdvisor({ mode: 'move_quality' }),
        null
    );
});
