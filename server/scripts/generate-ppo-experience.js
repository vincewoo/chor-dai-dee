#!/usr/bin/env node
// Collect on-policy variable-action trajectories using canonical JavaScript.
//
// <output>.actions.bin: row-major float32 candidate features.
// <output>.decisions.bin: 24-byte records, each describing one consecutive
// action group in the action file:
//   uint16 action_count, chosen_index, heuristic_index, flags
//   float32 old_log_probability, old_value, advantage, return

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { BotLogic, BOT_LOGIC_VERSION } = require('../game/BotLogic');
const { RULES_VERSION } = require('../game/Big2Rules');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const { PPOModel } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const { makeRng, deal, playRound } = require('../test/botHarness');
const { roundUtilities } = require('./train-rl-value-bot');

const DECISION_BYTES = 24;
const NO_HEURISTIC_INDEX = 0xFFFF;

function parseArgs(argv) {
    const args = {
        rounds: 100000,
        output: path.resolve('ai/ppo-experience'),
        model: path.resolve('ai/ppo-policy-heuristic-bootstrap.json'),
        seed: 48119,
        gamma: 0.995,
        gaeLambda: 0.95,
        temperature: 1,
        opponents: 'mixed',
        opponentPool: [],
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
        else if (flag === '--gae-lambda') args.gaeLambda = Number(argv[++i]);
        else if (flag === '--temperature') args.temperature = Number(argv[++i]);
        else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--opponent-pool') {
            args.opponentPool.push(...argv[++i].split(',')
                .filter(Boolean)
                .map(file => path.resolve(file)));
        }
        else if (flag === '--report-every') args.reportEvery = Number(argv[++i]);
        else if (flag === '--round-offset') args.roundOffset = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

function leagueRoundType(round) {
    const bucket = round % 10;
    if (bucket < 4) return 'selfplay';
    if (bucket < 7) return 'historical';
    if (bucket < 9) return 'heuristic';
    return 'mixed';
}

function fileSha256(filePath) {
    return crypto.createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function opponentPoolProvenance(files) {
    return files.map(file => ({
        reference: path.relative(path.resolve(__dirname, '..'), file),
        sha256: fileSha256(file)
    }));
}

function finishTrajectory(trajectory, utility, gamma, gaeLambda) {
    let nextValue = 0;
    let advantage = 0;
    for (let index = trajectory.length - 1; index >= 0; index--) {
        const decision = trajectory[index];
        const terminalReward = index === trajectory.length - 1 ? utility : 0;
        const delta =
            terminalReward + gamma * nextValue - decision.predictedValue;
        advantage = delta + gamma * gaeLambda * advantage;
        decision.advantage = advantage;
        decision.return = advantage + decision.predictedValue;
        nextValue = decision.predictedValue;
    }
    return trajectory;
}

function encodeActions(trajectory) {
    const actionCount = trajectory.reduce(
        (sum, decision) => sum + decision.actionFeatures.length, 0);
    const buffer = Buffer.allocUnsafe(
        actionCount * FEATURE_NAMES.length * 4);
    let offset = 0;
    for (const decision of trajectory) {
        for (const features of decision.actionFeatures) {
            for (const value of features) {
                buffer.writeFloatLE(value, offset);
                offset += 4;
            }
        }
    }
    return { buffer, actionCount };
}

function encodeDecisions(trajectory) {
    const buffer = Buffer.allocUnsafe(trajectory.length * DECISION_BYTES);
    let offset = 0;
    for (const decision of trajectory) {
        const actionCount = decision.actionFeatures.length;
        if (actionCount > 0xFFFF) {
            throw new Error(`decision has too many actions: ${actionCount}`);
        }
        buffer.writeUInt16LE(actionCount, offset);
        buffer.writeUInt16LE(decision.chosenIndex, offset + 2);
        buffer.writeUInt16LE(
            decision.heuristicIndex < 0
                ? NO_HEURISTIC_INDEX
                : decision.heuristicIndex,
            offset + 4
        );
        buffer.writeUInt16LE(0, offset + 6);
        buffer.writeFloatLE(decision.oldLogProbability, offset + 8);
        buffer.writeFloatLE(decision.predictedValue, offset + 12);
        buffer.writeFloatLE(decision.advantage, offset + 16);
        buffer.writeFloatLE(decision.return, offset + 20);
        offset += DECISION_BYTES;
    }
    return buffer;
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(
            'Usage: node scripts/generate-ppo-experience.js ' +
            '--model FILE --output PREFIX [--rounds N]');
        return 0;
    }
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    if (!Number.isInteger(args.roundOffset) || args.roundOffset < 0) {
        throw new Error('--round-offset must be a non-negative integer');
    }
    if (!Number.isFinite(args.gaeLambda) ||
        args.gaeLambda < 0 || args.gaeLambda > 1) {
        throw new Error('--gae-lambda must be between 0 and 1');
    }
    if (!['mixed', 'selfplay', 'heuristic', 'league'].includes(args.opponents)) {
        throw new Error(
            '--opponents must be mixed, selfplay, heuristic, or league');
    }
    args.opponentPool = [...new Set(args.opponentPool)];
    if (args.opponents === 'league' && !args.opponentPool.length) {
        throw new Error('--opponents league requires --opponent-pool');
    }
    for (const file of args.opponentPool) {
        if (!fs.existsSync(file)) {
            throw new Error(`Opponent checkpoint not found: ${file}`);
        }
    }

    const model = PPOModel.load(args.model);
    const historicalModels = args.opponentPool.map(file => PPOModel.load(file));
    const poolProvenance = opponentPoolProvenance(args.opponentPool);
    const rng = makeRng(args.seed);
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    const actionPath = `${args.output}.actions.bin`;
    const decisionPath = `${args.output}.decisions.bin`;
    const actionFd = fs.openSync(actionPath, 'w');
    const decisionFd = fs.openSync(decisionPath, 'w');
    let actionRows = 0;
    let decisions = 0;
    let learnerTrajectories = 0;
    const leagueMatchups = {
        selfplay: 0,
        historical: 0,
        heuristic: 0,
        mixed: 0
    };
    const started = Date.now();

    try {
        for (let round = 0; round < args.rounds; round++) {
            const globalRound = args.roundOffset + round;
            const trajectories = [[], [], [], []];
            const learnerSeat = globalRound % 4;
            const leagueType = args.opponents === 'league'
                ? leagueRoundType(globalRound)
                : null;
            if (leagueType) leagueMatchups[leagueType]++;
            const allLearners = args.opponents === 'selfplay' ||
                (args.opponents === 'mixed' && globalRound % 2 === 0) ||
                leagueType === 'selfplay';
            const seats = trajectories.map((trajectory, seat) => {
                const isLearner = allLearners || seat === learnerSeat;
                if (isLearner) {
                    learnerTrajectories++;
                    return {
                        name: `ppo-${seat}`,
                        logic: new PPOBot(model, {
                            sample: true,
                            temperature: args.temperature,
                            rng,
                            captureTrajectory: true,
                            onDecision: decision => trajectory.push(decision)
                        })
                    };
                }
                if (args.opponents !== 'league' ||
                    leagueType === 'heuristic') {
                    return { name: `heuristic-${seat}`, logic: BotLogic };
                }
                const relativeSeat = (seat - learnerSeat + 4) % 4;
                if (leagueType === 'mixed' && relativeSeat === 1) {
                    return { name: `heuristic-${seat}`, logic: BotLogic };
                }
                const historyIndex =
                    (Math.floor(globalRound / 10) * 3 +
                        relativeSeat - 1) % historicalModels.length;
                return {
                    name: `historical-${historyIndex}-${seat}`,
                    logic: new PPOBot(historicalModels[historyIndex], {
                        sample: true,
                        temperature: args.temperature,
                        rng
                    })
                };
            });
            const result = playRound(seats, deal(rng));
            const utilities = roundUtilities(result);
            for (let seat = 0; seat < 4; seat++) {
                if (!trajectories[seat].length) continue;
                const finished = finishTrajectory(
                    trajectories[seat],
                    utilities[seat],
                    args.gamma,
                    args.gaeLambda
                );
                const actions = encodeActions(finished);
                fs.writeSync(actionFd, actions.buffer);
                fs.writeSync(decisionFd, encodeDecisions(finished));
                actionRows += actions.actionCount;
                decisions += finished.length;
            }

            if ((round + 1) % args.reportEvery === 0 ||
                round + 1 === args.rounds) {
                const seconds = (Date.now() - started) / 1000;
                console.log(
                    `round ${String(round + 1).padStart(7)}  ` +
                    `decisions=${String(decisions).padStart(9)}  ` +
                    `actions=${String(actionRows).padStart(10)}  ` +
                    `rounds/s=${((round + 1) /
                        Math.max(0.001, seconds)).toFixed(1)}`
                );
            }
        }
    } finally {
        fs.closeSync(actionFd);
        fs.closeSync(decisionFd);
    }

    const metadata = {
        schemaVersion: 1,
        kind: 'chor-dai-dee-ppo-experience',
        featureNames: FEATURE_NAMES,
        actionDtype: 'float32-le',
        decisionRecordBytes: DECISION_BYTES,
        decisionColumns: [
            'action_count:uint16',
            'chosen_index:uint16',
            'heuristic_index:uint16',
            'flags:uint16',
            'old_log_probability:float32',
            'old_value:float32',
            'advantage:float32',
            'return:float32'
        ],
        actionRows,
        decisions,
        rounds: args.rounds,
        learnerTrajectories,
        roundOffset: args.roundOffset,
        seed: args.seed,
        gamma: args.gamma,
        gaeLambda: args.gaeLambda,
        temperature: args.temperature,
        opponents: args.opponents,
        opponentPool: poolProvenance,
        leagueSchedule: args.opponents === 'league' ? {
            selfplay: 0.40,
            historical: 0.30,
            heuristic: 0.20,
            mixed: 0.10
        } : null,
        leagueMatchups: args.opponents === 'league' ? leagueMatchups : null,
        policy: path.basename(args.model),
        rulesVersion: RULES_VERSION,
        heuristicBotVersion: BOT_LOGIC_VERSION,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        `${args.output}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`experience=${args.output}`);
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

module.exports = {
    main,
    parseArgs,
    finishTrajectory,
    encodeActions,
    encodeDecisions,
    leagueRoundType,
    opponentPoolProvenance,
    DECISION_BYTES,
    NO_HEURISTIC_INDEX
};
