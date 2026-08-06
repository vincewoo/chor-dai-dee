import test from 'node:test';
import assert from 'node:assert/strict';

import {
    awaitsRankResult,
    shouldSplashRank,
    rankSplashSeen,
    markRankSplashSeen,
} from '../src/utils/rankSplash.js';
import {
    PUBLIC_RANK_ORDER,
    publicRankIndex,
} from '../src/constants/publicRank.js';

const memoryStorage = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
    };
};

test('only the seats the server will rank hold the scoreboard back', () => {
    const gameOver = { pendingRankFor: ['ada', 'grace'] };
    assert.equal(awaitsRankResult(gameOver, 'ada'), true);
    // A guest, a bot, a mid-game joiner or a spectator is never listed, and
    // must see the final standings immediately.
    assert.equal(awaitsRankResult(gameOver, 'Guest_1234'), false);
    // Older servers (and the dragon path before it carried the list) send no
    // list at all — nobody waits rather than everybody waiting.
    assert.equal(awaitsRankResult({}, 'ada'), false);
    assert.equal(awaitsRankResult(gameOver, undefined), false);
});

test('the splash is for climbing only; a demotion keeps its toast', () => {
    assert.equal(shouldSplashRank({ change: 'promoted' }), true);
    assert.equal(shouldSplashRank({ change: 'placed' }), true);
    assert.equal(shouldSplashRank({ change: 'demoted' }), false);
    assert.equal(shouldSplashRank({ change: null }), false);
    assert.equal(shouldSplashRank(null), false);
});

test('a game celebrates a promotion once, however often game_over replays', () => {
    const storage = memoryStorage();
    assert.equal(rankSplashSeen('game-7', storage), false);
    markRankSplashSeen('game-7', storage);
    assert.equal(rankSplashSeen('game-7', storage), true);
    // The next game is a fresh ceremony.
    assert.equal(rankSplashSeen('game-8', storage), false);
});

test('storage being unavailable degrades to replaying, never to throwing', () => {
    const hostile = {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
    };
    assert.equal(rankSplashSeen('game-7', hostile), false);
    assert.doesNotThrow(() => markRankSplashSeen('game-7', hostile));
    assert.equal(rankSplashSeen('game-7', null), false);
});

test('rank ladder positions drive the splash, and Unranked is off the ladder', () => {
    assert.equal(publicRankIndex('Iron'), 0);
    assert.equal(publicRankIndex({ id: 'champ', label: 'Champ' }),
        PUBLIC_RANK_ORDER.length - 1);
    // -1, not 0: "has not placed yet" is not the bottom rung.
    assert.equal(publicRankIndex('Unranked'), -1);
    assert.equal(publicRankIndex(null), -1);
});
