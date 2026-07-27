#!/usr/bin/env node
// Collect variable-action decisions from a trained RL value policy so a PPO
// actor can start from that policy rather than relearning the heuristic.

const fs = require('fs');
const path = require('path');

const { BotLogic, BOT_LOGIC_VERSION } = require('../game/BotLogic');
const { RULES_VERSION } = require('../game/Big2Rules');
const { RLValueModel, FEATURE_NAMES } = require('../game/RLValueModel');
const { RLValueBot } = require('../game/RLValueBot');
const { makeRng, deal, playRound } = require('../test/botHarness');
const {
    encodeActions,
    DECISION_BYTES,
    NO_HEURISTIC_INDEX
} = require('./generate-ppo-experience');

function parseArgs(argv) {
    const args = {
        rounds: 50000,
        output: path.resolve('ai/ppo-imitation'),
        teacher: null,
        seed: 68119,
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
        else if (flag === '--teacher') args.teacher = path.resolve(argv[++i]);
        else if (flag === '--seed') args.seed = Number(argv[++i]);
        else if (flag === '--heuristic-weight') {
            args.heuristicWeight = Number(argv[++i]);
        } else if (flag === '--override-margin') {
            args.overrideMargin = Number(argv[++i]);
        } else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--report-every') args.reportEvery = Number(argv[++i]);
        else if (flag === '--round-offset') args.roundOffset = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

function encodeTeacherDecisions(decisions) {
    const buffer = Buffer.allocUnsafe(decisions.length * DECISION_BYTES);
    let offset = 0;
    for (const decision of decisions) {
        const actionCount = decision.actionFeatures.length;
        buffer.writeUInt16LE(actionCount, offset);
        buffer.writeUInt16LE(decision.chosenIndex, offset + 2);
        buffer.writeUInt16LE(
            decision.heuristicIndex < 0
                ? NO_HEURISTIC_INDEX
                : decision.heuristicIndex,
            offset + 4
        );
        buffer.writeUInt16LE(
            decision.chosenIndex !== decision.heuristicIndex ? 1 : 0,
            offset + 6
        );
        buffer.writeFloatLE(0, offset + 8);
        buffer.writeFloatLE(0, offset + 12);
        buffer.writeFloatLE(0, offset + 16);
        buffer.writeFloatLE(0, offset + 20);
        offset += DECISION_BYTES;
    }
    return buffer;
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(
            'Usage: node scripts/generate-ppo-imitation-experience.js ' +
            '--teacher FILE --output PREFIX [--rounds N]');
        return 0;
    }
    if (!args.teacher) throw new Error('--teacher is required');
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    if (!Number.isInteger(args.roundOffset) || args.roundOffset < 0) {
        throw new Error('--round-offset must be a non-negative integer');
    }
    if (!['mixed', 'selfplay', 'heuristic'].includes(args.opponents)) {
        throw new Error('--opponents must be mixed, selfplay, or heuristic');
    }

    const model = RLValueModel.load(args.teacher);
    const rng = makeRng(args.seed);
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    const actionFd = fs.openSync(`${args.output}.actions.bin`, 'w');
    const decisionFd = fs.openSync(`${args.output}.decisions.bin`, 'w');
    let actionRows = 0;
    let decisions = 0;
    let teacherOverrides = 0;
    let learnerTrajectories = 0;
    const started = Date.now();

    try {
        for (let round = 0; round < args.rounds; round++) {
            const globalRound = args.roundOffset + round;
            const trajectories = [[], [], [], []];
            const allTeachers = args.opponents === 'selfplay' ||
                (args.opponents === 'mixed' && globalRound % 2 === 0);
            const teacherSeat = globalRound % 4;
            const seats = trajectories.map((trajectory, seat) => {
                if (!allTeachers && seat !== teacherSeat) {
                    return { name: `heuristic-${seat}`, logic: BotLogic };
                }
                learnerTrajectories++;
                return {
                    name: `teacher-${seat}`,
                    logic: new RLValueBot(model, {
                        heuristicWeight: args.heuristicWeight,
                        overrideMargin: args.overrideMargin,
                        rng,
                        captureTrajectory: true,
                        onDecision: decision => trajectory.push(decision)
                    })
                };
            });
            playRound(seats, deal(rng));
            for (const trajectory of trajectories) {
                if (!trajectory.length) continue;
                const actions = encodeActions(trajectory);
                fs.writeSync(actionFd, actions.buffer);
                fs.writeSync(
                    decisionFd, encodeTeacherDecisions(trajectory));
                actionRows += actions.actionCount;
                decisions += trajectory.length;
                teacherOverrides += trajectory.filter(decision =>
                    decision.chosenIndex !== decision.heuristicIndex).length;
            }
            if ((round + 1) % args.reportEvery === 0 ||
                round + 1 === args.rounds) {
                const seconds = (Date.now() - started) / 1000;
                console.log(
                    `round ${String(round + 1).padStart(7)}  ` +
                    `decisions=${String(decisions).padStart(9)}  ` +
                    `overrides=${String(teacherOverrides).padStart(7)}  ` +
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
        kind: 'chor-dai-dee-ppo-imitation-experience',
        featureNames: FEATURE_NAMES,
        actionDtype: 'float32-le',
        decisionRecordBytes: DECISION_BYTES,
        decisionColumns: [
            'action_count:uint16',
            'teacher_index:uint16',
            'heuristic_index:uint16',
            'teacher_override:uint16',
            'unused:float32',
            'unused:float32',
            'unused:float32',
            'unused:float32'
        ],
        actionRows,
        decisions,
        teacherOverrides,
        rounds: args.rounds,
        learnerTrajectories,
        roundOffset: args.roundOffset,
        seed: args.seed,
        gamma: null,
        gaeLambda: null,
        temperature: 1,
        opponents: args.opponents,
        policy: path.basename(args.teacher),
        teacher: path.basename(args.teacher),
        teacherHeuristicWeight: args.heuristicWeight,
        teacherOverrideMargin: args.overrideMargin,
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

module.exports = { main, parseArgs, encodeTeacherDecisions };
