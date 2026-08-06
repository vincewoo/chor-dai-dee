// Rules for the rank-promotion splash: who waits for a rank result, what
// deserves the full screen, and what has already been celebrated.
//
// Pure so the sequencing can be tested without a socket or a DOM. The whole
// point of the wait is a race the client cannot otherwise see: `game_over` is
// emitted before the stats transaction that decides the rank, so the scoreboard
// would beat the promotion to the screen every time.

// How long the final scoreboard is held back waiting for this player's rank
// result. In practice the result lands in a few hundred ms — this is the cap for
// when it never arrives at all (a stats write threw, the socket dropped), and it
// is deliberately short: a player owed nothing must not notice the wait.
export const RANK_RESULT_GRACE_MS = 2500;

// Only upward moves get the takeover. A demotion is real information and still
// gets its toast, but a full-screen ceremony for it would be cruelty.
export const shouldSplashRank = (result) =>
    !!result && (result.change === 'promoted' || result.change === 'placed');

// Whether this viewer should expect a rank result for the game that just ended.
// The server lists the seats it will write ranks for; anyone else (bots, guests,
// mid-game joiners, spectators) is not in it and sees the scoreboard at once.
export const awaitsRankResult = (gameOver, username) =>
    !!username &&
    Array.isArray(gameOver?.pendingRankFor) &&
    gameOver.pendingRankFor.includes(username);

// A reconnect replays game_over AND the stored rank result, so a refresh on the
// game-over screen would otherwise replay the whole ceremony. Keyed on the game
// id in sessionStorage: it survives the refresh but not the next game, and a
// browser that refuses storage just gets the splash again rather than an error.
const seenKey = (gameId) => `cdd:rankSplashSeen:${gameId}`;

// Reading window.sessionStorage itself throws when storage is blocked, so even
// the lookup needs a guard — not just the get/set below.
export function rankSplashStore() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage;
    } catch {
        return null;
    }
}

export function rankSplashSeen(gameId, storage) {
    if (!gameId || !storage) return false;
    try {
        return storage.getItem(seenKey(gameId)) === '1';
    } catch {
        return false;
    }
}

export function markRankSplashSeen(gameId, storage) {
    if (!gameId || !storage) return;
    try {
        storage.setItem(seenKey(gameId), '1');
    } catch {
        /* private mode / storage disabled — replaying the splash is harmless */
    }
}
