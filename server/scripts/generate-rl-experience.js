#!/usr/bin/env node
// Generate a compact replay buffer using the canonical JavaScript game.
//
// Binary layout is row-major little-endian float32:
//   FEATURE_NAMES.length candidate features, then one normalized return target.
// A JSON sidecar pins the feature/rules schema. The Python GPU optimizer never
// simulates or interprets Big 2; it only fits these already-authoritative rows.

const fs = require('fs');
const path = require('path');

const { BotLogic, BOT_LOGIC_VERSION } = require('../game/BotLogic');
const { RULES_VERSION } = require('../game/Big2Rules');
const { RLValueModel, FEATURE_NAMES } = require('../game/RLValueModel');
const { RLValueBot } = require('../game/RLValueBot');
const { makeRng, deal, playRound } = require('../test/botHarness');
const { roundUtilities } = require('./train-rl-value-bot');

function parseArgs(argv) {
    const args = {
        rounds: 100000,
        output: path.resolve('ai/rl-experience.bin'),
        model: path.resolve('ai/rl-value-model-v1.json'),
        seed: 9128,
        gamma: 0.995,
        epsilon: 0.05,
        heuristicWeight: 0.20,
        overrideMargin: 0.02,
        opponents: 'mixed',
        reportEvery: 10000,
        roundOffset: 0
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--model') args.model = path.resolve(argv[++i]);
        else if (flag === '--seed') args.seed = Number(argv[++i]);
        else if (flag === '--gamma') args.gamma = Number(argv[++i]);
        else if (flag === '--epsilon') args.epsilon = Number(argv[++i]);
        else if (flag === '--heuristic-weight') args.heuristicWeight = Number(argv[++i]);
        else if (flag === '--override-margin') args.overrideMargin = Number(argv[++i]);
        else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--report-every') args.reportEvery = Number(argv[++i]);
        else if (flag === '--round-offset') args.roundOffset = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

const USAGE = `
Usage: node scripts/generate-rl-experience.js [options]

  --rounds N          rounds to simulate
  --output FILE       float32 replay buffer
  --model FILE        policy checkpoint used to collect experience
  --opponents MODE    selfplay, heuristic, or mixed
  --epsilon N         collection exploration probability
  --seed N            deterministic generation seed
`;

function rowsForRound(trajectories, utilities, gamma) {
    const rows = [];
    for (let seat = 0; seat < 4; seat++) {
        const trajectory = trajectories[seat];
        for (let i = 0; i < trajectory.length; i++) {
            rows.push({
                features: trajectory[i].features,
                target: utilities[seat] * Math.pow(gamma, trajectory.length - i - 1)
            });
        }
    }
    return rows;
}

function writeRows(fd, rows) {
    const width = FEATURE_NAMES.length + 1;
    const buffer = Buffer.allocUnsafe(rows.length * width * 4);
    let offset = 0;
    for (const row of rows) {
        for (const value of row.features) {
            buffer.writeFloatLE(value, offset);
            offset += 4;
        }
        buffer.writeFloatLE(row.target, offset);
        offset += 4;
    }
    fs.writeSync(fd, buffer);
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    if (!Number.isInteger(args.roundOffset) || args.roundOffset < 0) {
        throw new Error('--round-offset must be a non-negative integer');
    }
    if (!['selfplay', 'heuristic', 'mixed'].includes(args.opponents)) {
        throw new Error('--opponents must be selfplay, heuristic, or mixed');
    }

    const model = RLValueModel.load(args.model);
    const rng = makeRng(args.seed);
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    const fd = fs.openSync(args.output, 'w');
    let rowCount = 0;
    const started = Date.now();

    try {
        for (let round = 0; round < args.rounds; round++) {
            const globalRound = args.roundOffset + round;
            const trajectories = [[], [], [], []];
            const allLearners = args.opponents === 'selfplay' ||
                (args.opponents === 'mixed' && globalRound % 2 === 0);
            const learnerSeat = globalRound % 4;
            const seats = trajectories.map((trajectory, seat) => {
                if (!allLearners && seat !== learnerSeat) {
                    return { name: `heuristic-${seat}`, logic: BotLogic };
                }
                return {
                    name: `collector-${seat}`,
                    logic: new RLValueBot(model, {
                        epsilon: args.epsilon,
                        heuristicWeight: args.heuristicWeight,
                        overrideMargin: args.overrideMargin,
                        rng,
                        onDecision: decision => trajectory.push(decision)
                    })
                };
            });
            const result = playRound(seats, deal(rng));
            const rows = rowsForRound(trajectories, roundUtilities(result), args.gamma);
            writeRows(fd, rows);
            rowCount += rows.length;

            if ((round + 1) % args.reportEvery === 0 || round + 1 === args.rounds) {
                const seconds = (Date.now() - started) / 1000;
                console.log(
                    `round ${String(round + 1).padStart(7)}  ` +
                    `rows=${String(rowCount).padStart(9)}  ` +
                    `rounds/s=${((round + 1) / Math.max(0.001, seconds)).toFixed(1)}`
                );
            }
        }
    } finally {
        fs.closeSync(fd);
    }

    const sidecar = {
        schemaVersion: 1,
        kind: 'chor-dai-dee-rl-experience',
        dtype: 'float32-le',
        featureNames: FEATURE_NAMES,
        columns: [...FEATURE_NAMES, 'target'],
        rows: rowCount,
        rounds: args.rounds,
        roundOffset: args.roundOffset,
        seed: args.seed,
        gamma: args.gamma,
        opponents: args.opponents,
        policy: path.basename(args.model),
        rulesVersion: RULES_VERSION,
        heuristicBotVersion: BOT_LOGIC_VERSION,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${args.output}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`experience ${args.output}`);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { main, parseArgs, rowsForRound, writeRows };
