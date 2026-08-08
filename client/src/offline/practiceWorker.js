import { PracticeGame, PRACTICE_HUMAN_ID } from '../../../server/game/PracticeGame.js';
import policyArtifact from '../../../server/ai/ppo-policy-gpu-v1.json';

let game = null;
let processing = false;

const wait = (milliseconds) => new Promise(resolve =>
    setTimeout(resolve, milliseconds));

function send(event, data) {
    self.postMessage({ event, data });
}

function sendState(event = 'game_update') {
    send(event, game.getGameState());
}

function sendHand() {
    send('hand_update', game.getHumanHand());
}

function sendCurrentResult() {
    if (game.lastGameResult) {
        send(game.lastGameResult.isDragonWin ? 'dragon_win' : 'game_over',
            game.lastGameResult);
    } else if (game.lastRoundResult) {
        send('round_over', game.lastRoundResult);
    }
}

async function settle(result) {
    if (result?.error) {
        send('error', result.error);
        sendHand();
        sendState();
        return false;
    }

    sendState();
    sendHand();

    if (result?.roundOver) {
        // Preserve enough of the production pause to see the winning play land.
        await wait(700);
        sendCurrentResult();
        return false;
    }

    if (result?.trickWon) {
        await wait(600);
        game.clearTrick();
        sendState();
    }
    return true;
}

async function runBotTurns() {
    while (game?.gameState === 'playing' &&
        game.players[game.currentTurnIndex]?.isBot) {
        await wait(250);
        const choice = game.getBotMove();
        if (choice.error) {
            send('error', choice.error);
            return;
        }
        const current = game.players[game.currentTurnIndex];
        const result = choice.cards
            ? game.play(current.id, choice.cards)
            : game.pass(current.id);
        if (!await settle(result)) return;
    }
}

async function initialize(payload) {
    if (!game) {
        game = new PracticeGame({
            username: payload?.username || 'Player',
            policyArtifact
        });
    }
    send('joined_room', {
        roomId: game.roomId,
        playerId: PRACTICE_HUMAN_ID
    });
    sendState('game_started');
    sendHand();
    if (game.gameState === 'finished') {
        sendCurrentResult();
    } else {
        await runBotTurns();
    }
}

async function snapshot() {
    if (!game) return;
    send('reconnected', {
        roomId: game.roomId,
        playerId: PRACTICE_HUMAN_ID,
        gameState: game.getGameState()
    });
    sendHand();
    sendCurrentResult();
}

async function command(event, payload) {
    if (event === 'join_room') return initialize(payload);
    if (event === 'get_room_state') return snapshot();
    if (!game) return;

    if (event === 'play_card' || event === 'pass_turn' ||
        event === 'next_round') {
        if (processing) return;
        processing = true;
        try {
            let result;
            if (event === 'play_card') {
                result = game.play(PRACTICE_HUMAN_ID, payload?.cards);
            } else if (event === 'pass_turn') {
                result = game.pass(PRACTICE_HUMAN_ID);
            } else {
                result = game.nextRound();
                if (!result.error) {
                    sendState('game_started');
                    sendHand();
                    if (result.dragon) sendCurrentResult();
                    else await runBotTurns();
                    return;
                }
            }
            if (await settle(result)) await runBotTurns();
        } finally {
            processing = false;
        }
    }
}

self.onmessage = ({ data }) => {
    command(data?.event, data?.payload).catch(error => {
        send('error', error?.message || 'Practice Mode stopped unexpectedly');
        processing = false;
    });
};
