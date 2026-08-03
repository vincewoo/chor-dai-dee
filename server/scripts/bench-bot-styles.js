#!/usr/bin/env node

// Offline calibration for hidden PPO personas. Each persona occupies the same
// rotating seat against three heuristic opponents on the same deterministic
// deal stream, so strength and behavioural signatures are directly comparable.

const path = require('path');

const { BotLogic } = require('../game/BotLogic');
const { PPOModel } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const {
    BOT_PERSONA_IDS,
    DEFAULT_BOT_STYLE
} = require('../game/BotStyle');
const { runBenchmarkAsync } = require('../test/botHarness');

const rounds = Number(process.argv[2]) || 4000;
const seed = process.argv[3] === undefined ? 91827 : Number(process.argv[3]);
const modelPath = path.resolve(process.argv[4] ||
    path.join(__dirname, '../ai/ppo-policy-gpu-v1.json'));

if (!Number.isInteger(rounds) || rounds <= 0) {
    throw new Error('rounds must be a positive integer');
}
if (!Number.isInteger(seed)) throw new Error('seed must be an integer');

const FEATURE_INDEX = Object.fromEntries(
    FEATURE_NAMES.map((name, index) => [name, index]));

function makeSignature() {
    return {
        decisions: 0,
        passes: 0,
        cardsPlayed: 0,
        strength: 0,
        kings: 0,
        aces: 0,
        twos: 0,
        pairs: 0,
        triples: 0,
        fives: 0
    };
}

function observe(signature, decision) {
    const features = decision.actionFeatures[decision.chosenIndex];
    signature.decisions++;
    signature.passes += features[FEATURE_INDEX.action_pass];
    signature.cardsPlayed += features[FEATURE_INDEX.action_size] * 5;
    signature.strength += features[FEATURE_INDEX.action_strength];
    signature.kings += features[FEATURE_INDEX.spends_king];
    signature.aces += features[FEATURE_INDEX.spends_ace];
    signature.twos += features[FEATURE_INDEX.spends_two];
    signature.pairs += features[FEATURE_INDEX.remaining_pairs];
    signature.triples += features[FEATURE_INDEX.remaining_triples];
    signature.fives += features[FEATURE_INDEX.remaining_five_card_hands];
}

function ratio(signature, key) {
    return signature[key] / Math.max(1, signature.decisions);
}

async function main() {
    const model = PPOModel.load(modelPath);
    const rows = [];
    for (const style of [DEFAULT_BOT_STYLE, ...BOT_PERSONA_IDS]) {
        const signature = makeSignature();
        const bot = new PPOBot(model, {
            style,
            captureTrajectory: true,
            onDecision: decision => observe(signature, decision)
        });
        const results = await runBenchmarkAsync([
            { name: style, logic: bot },
            { name: 'heuristic-1', logic: BotLogic },
            { name: 'heuristic-2', logic: BotLogic },
            { name: 'heuristic-3', logic: BotLogic }
        ], { rounds, seed });
        const result = results[0];
        rows.push({
            style,
            winRate: result.winRate * 100,
            points: result.avgPoints,
            cardsLeft: result.avgCardsLeft,
            passRate: ratio(signature, 'passes') * 100,
            cardsPerPlay: ratio(signature, 'cardsPlayed'),
            strength: ratio(signature, 'strength'),
            controlSpend: (
                ratio(signature, 'kings') +
                ratio(signature, 'aces') +
                ratio(signature, 'twos')) / 3,
            pairsLeft: ratio(signature, 'pairs'),
            triplesLeft: ratio(signature, 'triples'),
            fivesLeft: ratio(signature, 'fives')
        });
    }

    console.log(`Hidden persona benchmark [${rounds} rounds each, seed ${seed}]`);
    console.log(
        'style       win%  points  left  pass%  size  force  controls  pairs  triples  fives');
    for (const row of rows) {
        console.log([
            row.style.padEnd(10),
            row.winRate.toFixed(2).padStart(5),
            row.points.toFixed(3).padStart(7),
            row.cardsLeft.toFixed(3).padStart(5),
            row.passRate.toFixed(2).padStart(6),
            row.cardsPerPlay.toFixed(3).padStart(5),
            row.strength.toFixed(3).padStart(6),
            row.controlSpend.toFixed(3).padStart(8),
            row.pairsLeft.toFixed(3).padStart(6),
            row.triplesLeft.toFixed(3).padStart(8),
            row.fivesLeft.toFixed(3).padStart(6)
        ].join(' '));
    }
    return rows;
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { main, makeSignature, observe };
