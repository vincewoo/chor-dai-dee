const test = require('node:test');
const assert = require('node:assert');

const policyArtifact = require('../ai/ppo-policy-gpu-v1.json');
const { PPOBot } = require('../game/PPOBot');
const {
    PracticeGame,
    PRACTICE_HUMAN_ID,
    PRACTICE_ROOM_ID
} = require('../game/PracticeGame');
const { makeRng } = require('./botHarness');

test('Practice Mode starts a private, short, four-seat local game', () => {
    const game = new PracticeGame({
        username: 'Alice',
        policyArtifact,
        rng: makeRng(228)
    });
    const state = game.getGameState();

    assert.strictEqual(state.roomId, PRACTICE_ROOM_ID);
    assert.strictEqual(state.gameMode, 'short');
    assert.strictEqual(state.pointThreshold, 50);
    assert.strictEqual(state.isPrivate, true);
    assert.strictEqual(state.practiceMode, true);
    assert.strictEqual(state.players.length, 4);
    assert.strictEqual(state.players.filter(player => player.isBot).length, 3);
    assert.strictEqual(game.getHumanHand().length, 13);
});

test('production PPO policy can play a complete Practice game legally', () => {
    const rng = makeRng(20260808);
    const game = new PracticeGame({
        username: 'Alice',
        policyArtifact,
        rng
    });
    const humanPolicy = new PPOBot(game.model, {
        sample: false,
        rng
    });

    let decisions = 0;
    while (game.gameState !== 'finished' && decisions++ < 10000) {
        const player = game.players[game.currentTurnIndex];
        const cards = player.isBot
            ? game.getBotMove().cards
            : humanPolicy.getBotMove(
                player.hand,
                game.lastPlayedHand,
                game.isFirstTurn(),
                game.buildContext(game.currentTurnIndex)
            );
        const result = cards?.length
            ? game.play(player.id, cards)
            : game.pass(player.id);

        assert.ok(!result.error, result.error);
        if (result.trickWon) game.clearTrick();
        if (result.roundOver && game.gameState === 'round_over') {
            assert.ok(!game.nextRound().error);
        }
    }

    assert.ok(decisions < 10000, 'Practice game exceeded the decision guard');
    assert.strictEqual(game.gameState, 'finished');
    assert.ok(game.lastGameResult);
    assert.deepStrictEqual(game.lastGameResult.pendingRankFor, []);
    assert.strictEqual(game.players[0].id, PRACTICE_HUMAN_ID);
});
