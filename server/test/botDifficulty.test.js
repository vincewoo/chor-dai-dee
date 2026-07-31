// server/test/botDifficulty.test.js
//
// The bot difficulty tiers. Three things here are load-bearing beyond the
// feature itself:
//
//   1. The provenance tests. The previous attempt at a difficulty setting
//      failed because a decorative per-seat `player.difficulty` label disagreed
//      with what checkBotTurn actually dispatched on, so the game log recorded
//      a policy that never played -- see docs/GAME-STATE-HISTORY-STORE.md.
//      Everything now reads room.botPolicy.difficulty, and these assert that
//      the seat payload, the game-log description and the dispatching policy
//      cannot come apart, including for a mid-game bot replacement.
//
//   2. The `competitive` tier must stay byte-identical to the pre-difficulty
//      bot. It is the default, so any drift silently changes every game and
//      every training tape that is not explicitly opted out of.
//
//   3. Legality. Sampling picks moves the argmax policy never would, including
//      the strategically terrible ones, so every tier is fuzzed through the
//      harness -- which throws on an illegal hand, an illegal beat, or an
//      opening that does not contain the 3 of Diamonds.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Scratch database, set before requiring db.js -- it migrates whatever path it
// resolves at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-difficulty-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'database.sqlite');

const {
    createBotPolicy,
    createCoachAdvisor,
    BOT_DIFFICULTIES,
    DEFAULT_BOT_DIFFICULTY,
    MAX_BOT_DIFFICULTY,
    DEFAULT_PPO_MODEL_PATH
} = require('../game/BotPolicy');
const {
    botRatingForDifficulty,
    calculateNewRatings,
    DEFAULT_MU,
    DEFAULT_SIGMA
} = require('../game/RatingSystem');
const { BOT_DIFFICULTY_IDS } = require('../db');
const { Room } = require('../game/RoomManager');
const { makeRng, deal, playRound } = require('./botHarness');

const ppoPolicy = (difficulty, temperature) => createBotPolicy({
    mode: 'ppo',
    modelPath: DEFAULT_PPO_MODEL_PATH,
    difficulty,
    temperature
});

const freePlayContext = {
    playerCardCounts: [13, 13, 13],
    lastPlayedByRelative: null,
    passedPlayers: [],
    passCount: 0,
    playedCards: [],
    playHistory: []
};

// --- the tier table ---------------------------------------------------------

test('every tier is defined easiest-last with the documented knobs', () => {
    assert.deepStrictEqual(
        Object.keys(BOT_DIFFICULTIES).sort(),
        ['adaptive', 'balanced', 'casual', 'competitive']
    );
    // competitive is argmax; the other two sample, and casual samples hotter.
    assert.strictEqual(BOT_DIFFICULTIES.competitive.sample, false);
    assert.strictEqual(BOT_DIFFICULTIES.balanced.sample, true);
    assert.strictEqual(BOT_DIFFICULTIES.casual.sample, true);
    assert.strictEqual(BOT_DIFFICULTIES.adaptive.sample, true);
    assert.ok(
        BOT_DIFFICULTIES.casual.temperature >
        BOT_DIFFICULTIES.balanced.temperature,
        'casual must sample hotter than balanced or the ladder inverts'
    );
});

test('adaptive accepts a bounded continuous temperature', () => {
    const policy = ppoPolicy('adaptive', 7.25);
    assert.strictEqual(policy.difficulty, 'adaptive');
    assert.strictEqual(policy.temperature, 7.25);
    assert.strictEqual(policy.sample, true);
    assert.throws(
        () => ppoPolicy('adaptive', 2.99),
        /temperature must be between/);
    assert.throws(
        () => ppoPolicy('adaptive', 20.01),
        /temperature must be between/);
});

test('the default tier is full strength', () => {
    assert.strictEqual(DEFAULT_BOT_DIFFICULTY, 'competitive');
    assert.strictEqual(BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY].sample, false);
    assert.strictEqual(
        BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY].temperature, 1);
});

test('an unknown tier is refused rather than silently downgraded', () => {
    assert.throws(() => ppoPolicy('godmode'), /bot difficulty must be one of/);
    assert.throws(
        () => createBotPolicy({ mode: 'heuristic', difficulty: 'nope' }),
        /bot difficulty must be one of/);
});

test('policyRef still names the artifact alone', () => {
    // The tier is recorded in mlog_seat.difficulty. Encoding it here instead
    // would break every query that groups by checkpoint.
    for (const tier of Object.keys(BOT_DIFFICULTIES)) {
        assert.strictEqual(
            ppoPolicy(tier).policyRef, 'ppo-policy-gpu-v1.json');
    }
});

test('difficulty is exposed by both policy kinds', () => {
    assert.strictEqual(ppoPolicy('casual').difficulty, 'casual');
    assert.strictEqual(
        createBotPolicy({ mode: 'heuristic', difficulty: 'casual' }).difficulty,
        'casual');
});

// --- behaviour --------------------------------------------------------------

test('competitive is deterministic; casual is not', () => {
    const cards = deal(makeRng(4242))[0];
    const key = move => (move || [])
        .map(card => `${card.rank}${card.suit}`).sort().join(',');

    const competitive = ppoPolicy('competitive');
    const first = key(competitive.getMove(cards, null, false, freePlayContext));
    for (let i = 0; i < 12; i++) {
        assert.strictEqual(
            key(competitive.getMove(cards, null, false, freePlayContext)),
            first,
            'the default tier must not have become stochastic');
    }

    // At casual's temperature the argmax move is chosen well under half the
    // time, so 60 draws landing on one move would be astronomically unlikely.
    const casual = ppoPolicy('casual');
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
        seen.add(key(casual.getMove(cards, null, false, freePlayContext)));
    }
    assert.ok(seen.size > 1,
        `casual produced only one distinct move in 60 draws: ${[...seen]}`);
});

test('every tier plays only legal moves', () => {
    for (const tier of Object.keys(BOT_DIFFICULTIES)) {
        const policy = ppoPolicy(tier);
        const logic = { getBotMove: (...args) => policy.getMove(...args) };
        for (let seed = 1; seed <= 10; seed++) {
            // playRound throws on an invalid hand, a hand that cannot beat the
            // pile, or an opening without the 3 of Diamonds.
            const result = playRound(
                [0, 1, 2, 3].map(seat => ({ name: `${tier}-${seat}`, logic })),
                deal(makeRng(seed))
            );
            assert.ok(result.cardsLeft.some(count => count === 0),
                `${tier} failed to finish round on seed ${seed}`);
        }
    }
});

test('the coach stays at full strength on an easy table', () => {
    // The coach is a teaching aid, not an opponent: its hints must not get
    // worse because the host picked easier bots.
    const advisor = createCoachAdvisor({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH,
        minMargin: 0
    });
    assert.strictEqual(advisor.difficulty, DEFAULT_BOT_DIFFICULTY);
});

// --- room wiring and provenance ---------------------------------------------

function seatedRoom(difficulty) {
    const room = new Room('DIFF-TEST', 'short');
    assert.deepStrictEqual(room.setBotDifficulty(difficulty), { success: true });
    room.botPolicy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH,
        difficulty
    });
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    room.startGame();
    return room;
}

test('setBotDifficulty validates and rebuilds the policy', () => {
    const room = new Room('DIFF-SET', 'short');
    assert.strictEqual(room.botPolicy.difficulty, DEFAULT_BOT_DIFFICULTY);

    assert.ok(room.setBotDifficulty('nonsense').error);
    assert.strictEqual(room.botPolicy.difficulty, DEFAULT_BOT_DIFFICULTY,
        'a refused change must not have altered the policy');

    assert.deepStrictEqual(room.setBotDifficulty('casual'), { success: true });
    assert.strictEqual(room.botPolicy.difficulty, 'casual');
    assert.strictEqual(room.getGameState().botDifficulty, 'casual');
});

test('the tier cannot change once the game is under way', () => {
    const room = seatedRoom('casual');
    assert.ok(room.setBotDifficulty('competitive').error,
        'changing policy mid-game would make the tape describe a bot that ' +
        'never played the earlier rounds');
    assert.strictEqual(room.botPolicy.difficulty, 'casual');
});

test('the live roster uses adaptive strength without a player choice', () => {
    const solo = new Room('AUTO-SOLO', 'short');
    solo.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    assert.deepStrictEqual(
        solo.configureBotPolicyForRoster(), { success: true });
    assert.strictEqual(solo.botPolicy.difficulty, 'adaptive');

    const mixed = new Room('AUTO-MIXED', 'short');
    mixed.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    mixed.addPlayer({ id: 'human-2', name: 'Bob', isBot: false });
    assert.deepStrictEqual(
        mixed.configureBotPolicyForRoster(), { success: true });
    assert.strictEqual(mixed.botPolicy.difficulty, 'adaptive');
});

test('max-difficulty bots survive the roster re-calibration', () => {
    // The whole point of the flag: configureBotPolicyForRoster() runs at every
    // game boundary and unconditionally chose adaptive, so storing the choice
    // as a difficulty id alone would let the next game silently drop it.
    const room = new Room('MAXBOTS-STICKY', 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });

    assert.deepStrictEqual(room.setForceMaxBots(true),
        { success: true, forceMaxBots: true });
    assert.strictEqual(room.botPolicy.difficulty, MAX_BOT_DIFFICULTY);
    assert.strictEqual(room.getGameState().forceMaxBots, true);

    // A roster average would normally pull the room back to adaptive.
    room.setAdaptiveCalibration({ lastTemperature: 9 });
    assert.deepStrictEqual(room.configureBotPolicyForRoster(), { success: true });
    assert.strictEqual(room.botPolicy.difficulty, MAX_BOT_DIFFICULTY,
        'the room-level choice outranks the roster average');

    // And turning it back off returns the room to the automatic policy.
    assert.deepStrictEqual(room.setForceMaxBots(false),
        { success: true, forceMaxBots: false });
    assert.strictEqual(room.botPolicy.difficulty, 'adaptive');
    assert.strictEqual(room.getGameState().forceMaxBots, false);
});

test('max-difficulty bots cannot be toggled mid-game', () => {
    const room = seatedRoom('casual');
    assert.ok(room.setForceMaxBots(true).error,
        'changing policy mid-game would make the tape describe a bot that ' +
        'never played the earlier rounds');
    assert.strictEqual(room.botPolicy.difficulty, 'casual');
    assert.strictEqual(room.forceMaxBots, false);
});

test('a new room does not start on max difficulty', () => {
    const room = new Room('MAXBOTS-DEFAULT', 'short');
    assert.strictEqual(room.forceMaxBots, false);
    assert.strictEqual(room.getGameState().forceMaxBots, false);
});

test('adaptive effort is frozen for a complete game', () => {
    const room = new Room('ADAPTIVE-FROZEN', 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    room.setAdaptiveCalibration({ lastTemperature: 9 });
    assert.deepStrictEqual(
        room.setBotDifficulty('adaptive'), { success: true });
    room.startGame();
    assert.strictEqual(room.botPolicy.temperature, 9);

    // A completed-game estimate may be prepared while the old game is still
    // represented by the room, but cannot rebuild its dispatching policy.
    room.setAdaptiveCalibration({ lastTemperature: 12 });
    assert.strictEqual(room.botPolicy.temperature, 9);

    room.gameState = 'finished';
    room.startRematch();
    assert.strictEqual(room.botPolicy.temperature, 12);
});

test('game log records bot strength while seat payload hides it', () => {
    for (const tier of Object.keys(BOT_DIFFICULTIES)) {
        const room = seatedRoom(tier);

        const seats = room.describeSeats();
        const state = room.getGameState();
        room.players.forEach((player, index) => {
            assert.strictEqual('rating' in state.players[index], false);
            if (!player.isBot) {
                assert.strictEqual(seats[index].difficulty, undefined);
                assert.strictEqual(
                    state.players[index].publicRank, 'Unranked');
                return;
            }
            assert.strictEqual(seats[index].difficulty, room.botPolicy.difficulty);
            assert.strictEqual(
                state.players[index].botDifficulty, undefined);
            assert.strictEqual(state.players[index].publicRank, null);
        });
        assert.strictEqual(state.botTemperature, undefined);
    }
});

test('a mid-game bot replacement inherits the room tier', () => {
    const room = seatedRoom('casual');
    // Alice rage-quits; her seat becomes a bot at the room's tier, not the
    // default one.
    const replacement = room.replaceWithBot(
        room.players.find(p => !p.isBot).id);
    assert.ok(replacement, 'expected the human seat to be replaced');
    const bot = replacement.botPlayer;

    const index = room.players.findIndex(p => p.id === bot.id);
    assert.strictEqual(
        room.describeSeats()[index].difficulty, room.botPolicy.difficulty);
    assert.strictEqual(
        room.getGameState().players[index].botDifficulty, undefined);
    assert.strictEqual(bot.rating_mu, botRatingForDifficulty('casual').mu);
});

test('bot seats are created at the tier rating', () => {
    for (const tier of Object.keys(BOT_DIFFICULTIES)) {
        const room = seatedRoom(tier);
        const expected = botRatingForDifficulty(
            tier, room.botPolicy.temperature);
        for (const bot of room.players.filter(p => p.isBot)) {
            assert.strictEqual(bot.rating_mu, expected.mu);
            assert.strictEqual(bot.rating_sigma, expected.sigma);
        }
    }
});

test('the deal-strength record carries the tier', () => {
    const room = seatedRoom('balanced');
    for (const record of Object.values(room.roundDealStrength)) {
        assert.strictEqual(record.botDifficulty, 'balanced');
    }
});

// --- rating -----------------------------------------------------------------

test('weaker tiers are seated at a lower rating', () => {
    assert.strictEqual(botRatingForDifficulty('competitive').mu, DEFAULT_MU);
    assert.ok(
        botRatingForDifficulty('casual').mu <
        botRatingForDifficulty('balanced').mu &&
        botRatingForDifficulty('balanced').mu <
        botRatingForDifficulty('competitive').mu,
        'the rating ladder must follow the difficulty ladder');
    // Sigma expresses uncertainty about an opponent, which a tier says nothing
    // about, so it stays put.
    for (const tier of Object.keys(BOT_DIFFICULTIES)) {
        assert.strictEqual(botRatingForDifficulty(tier).sigma, DEFAULT_SIGMA);
    }
});

test('an unrecognised tier never earns cheap rating', () => {
    // An unknown setting must fall back to full strength, not to the weakest
    // entry in the table.
    assert.strictEqual(botRatingForDifficulty(undefined).mu, DEFAULT_MU);
    assert.strictEqual(botRatingForDifficulty('godmode').mu, DEFAULT_MU);
});

test('beating easier bots pays less', () => {
    const winAgainst = (tier) => {
        const bot = botRatingForDifficulty(tier);
        const players = [
            {
                id: 'h', name: 'human', isBot: false,
                rating_mu: DEFAULT_MU, rating_sigma: DEFAULT_SIGMA
            },
            ...[1, 2, 3].map(index => ({
                id: `b${index}`, name: `Bot ${index}`, isBot: true,
                rating_mu: bot.mu, rating_sigma: bot.sigma
            }))
        ];
        // Identical result every time; only the opposition's tier differs.
        const updates = calculateNewRatings(
            players, { h: 0, b1: 30, b2: 40, b3: 50 });
        return updates[0].mu - DEFAULT_MU;
    };

    assert.ok(winAgainst('casual') < winAgainst('balanced'),
        'beating casual bots must pay less than beating balanced ones');
    assert.ok(winAgainst('balanced') < winAgainst('competitive'),
        'beating balanced bots must pay less than beating full-strength ones');
});

test('Adaptive uses the frozen temperature as hidden rating opposition', () => {
    assert.ok(
        botRatingForDifficulty('adaptive', 12).mu <
        botRatingForDifficulty('adaptive', 6).mu);
    assert.strictEqual(
        botRatingForDifficulty('adaptive', 8).mu,
        botRatingForDifficulty('casual').mu);
});

// --- cross-module agreement -------------------------------------------------

test('db.js and BotPolicy.js agree on the valid tiers', () => {
    // db.js keeps a local copy rather than importing the whole bot stack into
    // the database layer, so this is what stops the two drifting.
    assert.deepStrictEqual(
        [...BOT_DIFFICULTY_IDS].sort(),
        Object.keys(BOT_DIFFICULTIES).sort());
});

test('setGameMode rejects an unknown mode', () => {
    // Not cosmetic: room.gameMode is a stats partition key, so an unvalidated
    // string used to write a phantom mode's statistics.
    const room = new Room('MODE-TEST', 'short');
    assert.ok(room.setGameMode('turbo').error);
    assert.strictEqual(room.gameMode, 'short');
    assert.deepStrictEqual(room.setGameMode('standard'), { success: true });
    assert.strictEqual(room.gameMode, 'standard');
});
