// Hidden PPO personas: bounded overlays, legal play, room secrecy, and rematch
// continuity. Difficulty tests live separately because temperature and persona
// are intentionally independent axes.

const test = require('node:test');
const assert = require('node:assert');

process.env.BOT_POLICY = 'ppo';

const {
    BOT_PERSONA_IDS,
    DEFAULT_BOT_STYLE,
    MAX_STYLE_LOGIT_ADJUSTMENT,
    styleAdjustment,
    applyBotStyle
} = require('../game/BotStyle');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const {
    createBotPolicy,
    DEFAULT_PPO_MODEL_PATH
} = require('../game/BotPolicy');
const { Room } = require('../game/RoomManager');
const { makeRng, deal, playRound } = require('./botHarness');

const index = Object.fromEntries(
    FEATURE_NAMES.map((name, featureIndex) => [name, featureIndex]));

function row(values = {}) {
    const features = FEATURE_NAMES.map(() => 0);
    features[index.bias] = 1;
    for (const [name, value] of Object.entries(values)) {
        features[index[name]] = value;
    }
    return features;
}

test('classic leaves promoted PPO logits exactly unchanged', () => {
    const logits = [1.25, -0.5, 3];
    const styled = applyBotStyle(
        [row(), row({ action_pass: 1 }), row({ spends_two: 1 })],
        logits,
        DEFAULT_BOT_STYLE);
    assert.strictEqual(styled.logits, logits);
    assert.deepStrictEqual(styled.adjustments, [0, 0, 0]);
});

test('every persona adjustment is finite and strictly bounded', () => {
    const extremes = FEATURE_NAMES.map((_, featureIndex) =>
        featureIndex % 2 ? 1 : -1);
    for (const style of BOT_PERSONA_IDS) {
        const adjustment = styleAdjustment(extremes, style);
        assert.ok(Number.isFinite(adjustment), style);
        assert.ok(Math.abs(adjustment) <= MAX_STYLE_LOGIT_ADJUSTMENT, style);
    }
    assert.throws(
        () => styleAdjustment(row(), 'mystery'),
        /bot style must be one of/);
});

test('persona scores express distinct strategic preferences', () => {
    assert.ok(
        styleAdjustment(row({ action_size: 1 }), 'sprinter') >
        styleAdjustment(row({ action_pass: 1 }), 'sprinter'),
        'sprinter should prefer shedding a large play to passing');

    const spendsTwo = row({ spends_two: 1, next_cards: 8 / 13 });
    assert.ok(
        styleAdjustment(spendsTwo, 'keeper') < 0,
        'keeper should protect a two in an ordinary position');
    assert.ok(
        styleAdjustment(row({ spends_two: 1, next_cards: 1 / 13 }), 'keeper') >
        styleAdjustment(spendsTwo, 'keeper'),
        'keeper should release controls when the next player is about to go out');

    assert.ok(
        styleAdjustment(row({ action_strength: 1, spends_two: 1 }), 'pressure') >
        styleAdjustment(row({ action_strength: 0.1 }), 'pressure'),
        'pressure should favor forceful control plays');

    assert.ok(
        styleAdjustment(row({
            remaining_pairs: 0.5,
            remaining_triples: 0.5,
            remaining_five_card_hands: 0.25
        }), 'builder') >
        styleAdjustment(row(), 'builder'),
        'builder should favor actions that preserve combinations');
});

// Personas used to read `opponent_at_one` / `opponent_at_two`, which are a min
// over all three opponents (RLValueBot.encodeCandidate). That made keeper and
// pressure flip into endgame mode for a seat their move cannot hand the lead
// to, and stay relaxed for the one it can - the reported "erratic endgame".
// It is also the "extend to any opponent" variant the heuristic measured at
// -4.77pp before rejecting it (docs/BOT-HEURISTICS-REVIEW.md section 15).
test('persona urgency tracks the next seat, not the whole table', () => {
    // Across the table is on one card; the next player is comfortable. Our move
    // cannot hand the lead to across, so nothing should change.
    const acrossOnOne = { next_cards: 9 / 13, across_cards: 1 / 13, opponent_at_one: 1 };
    // The mirror: the next player is the one about to go out.
    const nextOnOne = { next_cards: 1 / 13, across_cards: 9 / 13, opponent_at_one: 1 };
    const calm = { next_cards: 9 / 13, across_cards: 9 / 13 };

    for (const style of ['keeper', 'pressure', 'sprinter', 'builder']) {
        assert.strictEqual(
            styleAdjustment(row({ ...acrossOnOne, spends_two: 1, action_size: 1 }), style),
            styleAdjustment(row({ ...calm, spends_two: 1, action_size: 1 }), style),
            `${style} must ignore a one-card opponent it does not play into`);
    }

    // And must still react when it is the next seat.
    assert.notStrictEqual(
        styleAdjustment(row({ ...nextOnOne, spends_two: 1 }), 'keeper'),
        styleAdjustment(row({ ...calm, spends_two: 1 }), 'keeper'),
        'keeper must react to the next player on one card');

    // sprinter and builder had no endgame term at all: a Sprinter would shed
    // its widest, weakest shape in front of a seat about to go out.
    for (const style of ['sprinter', 'builder']) {
        assert.ok(
            styleAdjustment(row({ ...nextOnOne, action_strength: 1 }), style) >
            styleAdjustment(row({ ...calm, action_strength: 1 }), style),
            `${style} should value a strong play more when the next player is on one card`);
    }
});

test('every persona and difficulty combination completes legal rounds', () => {
    const strengths = [
        { difficulty: 'competitive' },
        { difficulty: 'balanced' },
        { difficulty: 'casual' },
        { difficulty: 'adaptive', temperature: 7.25 }
    ];
    for (const strength of strengths) {
        const policy = createBotPolicy({
            mode: 'ppo',
            modelPath: DEFAULT_PPO_MODEL_PATH,
            ...strength
        });
        for (const style of BOT_PERSONA_IDS) {
            const logic = {
                getBotMove(hand, pile, first, context) {
                    return policy.getMove(
                        hand, pile, first, context, { style });
                }
            };
            for (let seed = 1; seed <= 4; seed++) {
                const result = playRound(
                    [0, 1, 2, 3].map(seat => ({
                        name: `${strength.difficulty}-${style}-${seat}`,
                        logic
                    })),
                    deal(makeRng(seed)));
                assert.ok(result.cardsLeft.some(count => count === 0),
                    `${strength.difficulty}/${style}`);
            }
        }
    }
});

test('debug reasoning does not disclose the hidden persona', () => {
    const policy = createBotPolicy({
        mode: 'ppo',
        modelPath: DEFAULT_PPO_MODEL_PATH,
        difficulty: 'competitive'
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
    const result = policy.getMove(cards, null, false, context, {
        captureReasoning: true,
        style: 'keeper'
    });
    assert.doesNotMatch(JSON.stringify(result.reasoning), /keeper|botStyle/);
});

function personaRoom(id) {
    const room = new Room(id, 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    room.startGame();
    return room;
}

test('a game independently deals secret personas and keeps them private', () => {
    const room = personaRoom('PERSONA-SECRET');
    const bots = room.players.filter(player => player.isBot);
    const styles = bots.map(bot => bot.botStyle);

    assert.strictEqual(styles.length, 3);
    assert.ok(styles.every(style => BOT_PERSONA_IDS.includes(style)));

    const publicState = room.getGameState();
    assert.strictEqual('botStyle' in publicState, false);
    for (const player of publicState.players) {
        assert.strictEqual('botStyle' in player, false);
    }

    const loggedStyles = room.describeSeats()
        .filter(seat => seat.occupant === 'bot_ppo')
        .map(seat => seat.botStyle);
    assert.deepStrictEqual(loggedStyles, styles,
        'private provenance must describe the policy that actually played');
});

test('independent persona draws permit every bot to share one style', () => {
    const originalRandom = Math.random;
    try {
        Math.random = () => 0;
        const room = personaRoom('PERSONA-DUPLICATES');
        const styles = room.players
            .filter(player => player.isBot)
            .map(player => player.botStyle);
        assert.deepStrictEqual(styles, ['sprinter', 'sprinter', 'sprinter']);
    } finally {
        Math.random = originalRandom;
    }
});

test('an immediate rematch keeps each named bot persona', () => {
    const room = personaRoom('PERSONA-REMATCH');
    const before = new Map(room.players
        .filter(player => player.isBot)
        .map(player => [player.name, player.botStyle]));

    room.gameState = 'finished';
    const result = room.startRematch();
    assert.ok(!result.error, result.error);

    const after = new Map(room.players
        .filter(player => player.isBot)
        .map(player => [player.name, player.botStyle]));
    assert.deepStrictEqual(after, before);
});

test('a mid-game replacement receives a valid independent secret persona', () => {
    const room = personaRoom('PERSONA-REPLACEMENT');
    const replacement = room.replaceWithBot('human-1');
    assert.ok(replacement);
    assert.ok(BOT_PERSONA_IDS.includes(replacement.botPlayer.botStyle));
});

// Max Bots is the "strongest opponent you have" switch, and a persona is the
// last thing at that tier that can move a decision off the actor's own top
// action: competitive is argmax, but BotStyle shifts the logits before the
// argmax is taken. So the ceiling plays Classic - the promoted actor itself.
function maxBotsRoom(id) {
    const room = new Room(id, 'short');
    room.addPlayer({ id: 'human-1', name: 'Alice', isBot: false });
    assert.ok(room.setForceMaxBots(true, 'Alice').success);
    room.startGame();
    return room;
}

test('max bots deal no persona and play the unmodified actor', () => {
    const room = maxBotsRoom('PERSONA-MAXBOTS');
    const bots = room.players.filter(player => player.isBot);

    assert.strictEqual(bots.length, 3);
    for (const bot of bots) {
        assert.strictEqual(bot.botStyle, DEFAULT_BOT_STYLE);
    }
    // Classic plus argmax is the whole claim: no style adjustment, and no
    // sampling away from the top-scored candidate.
    assert.strictEqual(room.botPolicy.sample, false);

    const loggedStyles = room.describeSeats()
        .filter(seat => seat.occupant === 'bot_ppo')
        .map(seat => seat.botStyle);
    assert.deepStrictEqual(
        loggedStyles, [DEFAULT_BOT_STYLE, DEFAULT_BOT_STYLE, DEFAULT_BOT_STYLE],
        'provenance must record the classic seats that actually played');
});

test('a max-bots replacement bot is personaless too', () => {
    const room = maxBotsRoom('PERSONA-MAXBOTS-REPLACEMENT');
    const replacement = room.replaceWithBot('human-1');
    assert.ok(replacement);
    assert.strictEqual(replacement.botPlayer.botStyle, DEFAULT_BOT_STYLE);
});

test('turning max bots back off deals personas again', () => {
    const room = maxBotsRoom('PERSONA-MAXBOTS-OFF');
    room.gameState = 'waiting';
    assert.ok(room.setForceMaxBots(false, 'Alice').success);
    room.startGame();

    const styles = room.players
        .filter(player => player.isBot)
        .map(player => player.botStyle);
    assert.strictEqual(styles.length, 3);
    assert.ok(styles.every(style => BOT_PERSONA_IDS.includes(style)));
});
