#!/usr/bin/env node
// Train the candidate-value bot by rules-faithful self-play.
//
// No Python game clone is involved: deals and transitions run through the same
// Big2Rules, BotContext and Scoring modules as the live heuristic benchmark.
// The model receives only public information. Full hands are used by the
// environment to advance the game, never by the feature encoder.

const fs = require('fs');
const path = require('path');

const { RLValueModel } = require('../game/RLValueModel');
const { RLValueBot } = require('../game/RLValueBot');
const { makeRng, deal, playRound } = require('../test/botHarness');
const { calculateRoundScores } = require('../game/Scoring');
const { RULES_VERSION } = require('../game/Big2Rules');
const { BotLogic, BOT_LOGIC_VERSION } = require('../game/BotLogic');

function parseArgs(argv) {
    const args = {
        rounds: 20000,
        output: path.join(__dirname, '../ai/rl-value-model.json'),
        resume: null,
        seed: 228,
        hidden: 32,
        learningRate: 0.003,
        gamma: 0.995,
        epsilonStart: 0.20,
        epsilonEnd: 0.02,
        heuristicWeight: 0.20,
        overrideMargin: 0.05,
        opponents: 'mixed',
        reportEvery: 1000
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--resume') args.resume = path.resolve(argv[++i]);
        else if (flag === '--seed') args.seed = Number(argv[++i]);
        else if (flag === '--hidden') args.hidden = Number(argv[++i]);
        else if (flag === '--learning-rate') args.learningRate = Number(argv[++i]);
        else if (flag === '--gamma') args.gamma = Number(argv[++i]);
        else if (flag === '--epsilon-start') args.epsilonStart = Number(argv[++i]);
        else if (flag === '--epsilon-end') args.epsilonEnd = Number(argv[++i]);
        else if (flag === '--heuristic-weight') args.heuristicWeight = Number(argv[++i]);
        else if (flag === '--override-margin') args.overrideMargin = Number(argv[++i]);
        else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--report-every') args.reportEvery = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}${value ? '' : ' (missing value)'}`);
    }
    return args;
}

const USAGE = `
Usage: node scripts/train-rl-value-bot.js [options]

  --rounds N                 self-play rounds (default 20000)
  --output FILE              checkpoint path
  --resume FILE              continue from an existing checkpoint
  --seed N                   deterministic training seed
  --hidden N                 hidden units for a new model
  --learning-rate N          SGD learning rate
  --gamma N                  discount between one player's decisions
  --epsilon-start N          exploration probability at the start
  --epsilon-end N            exploration probability at the end
  --heuristic-weight N       safe heuristic blend during exploration
  --override-margin N        value advantage required to override baseline
  --opponents MODE           selfplay, heuristic, or mixed (default mixed)
  --report-every N           progress interval
`;

function roundUtilities(result) {
    const players = result.cardsLeft.map((cards, seat) => ({
        id: seat,
        name: `seat-${seat}`,
        isBot: true,
        hand: { length: cards }
    }));
    const scores = calculateRoundScores({ id: result.winnerSeat }, players);
    const penalties = scores.map(score => score.roundPoints);
    const totalPenalty = penalties.reduce((sum, value) => sum + value, 0);

    // Zero-sum utility on the largest possible ordinary-round scale:
    // winner receives what all opponents lost; each loser pays their penalty.
    return penalties.map((penalty, seat) =>
        (seat === result.winnerSeat ? totalPenalty : -penalty) / 117);
}

function trainRound(model, trajectories, utilities, { learningRate, gamma, rng }) {
    const examples = [];
    for (let seat = 0; seat < 4; seat++) {
        const trajectory = trajectories[seat];
        for (let i = 0; i < trajectory.length; i++) {
            const decisionsRemaining = trajectory.length - i - 1;
            examples.push({
                features: trajectory[i].features,
                target: utilities[seat] * Math.pow(gamma, decisionsRemaining)
            });
        }
    }
    // Do not let seat or turn order become the optimizer's update order.
    for (let i = examples.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [examples[i], examples[j]] = [examples[j], examples[i]];
    }
    let loss = 0;
    for (const example of examples) {
        loss += model.trainExample(example.features, example.target, learningRate);
    }
    return { loss, examples: examples.length };
}

function saveCheckpoint(model, filePath, metadata) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(model.toArtifact(metadata))}\n`);
    fs.renameSync(temporary, filePath);
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return 0;
    }
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    if (!['selfplay', 'heuristic', 'mixed'].includes(args.opponents)) {
        throw new Error('--opponents must be selfplay, heuristic, or mixed');
    }

    const rng = makeRng(args.seed);
    const model = args.resume
        ? RLValueModel.load(args.resume)
        : new RLValueModel({ hiddenSize: args.hidden, seed: args.seed });

    let totalLoss = 0;
    let totalExamples = 0;
    const wins = [0, 0, 0, 0];
    const started = Date.now();

    for (let round = 0; round < args.rounds; round++) {
        const progress = args.rounds === 1 ? 1 : round / (args.rounds - 1);
        const epsilon = args.epsilonStart +
            (args.epsilonEnd - args.epsilonStart) * progress;
        const trajectories = [[], [], [], []];
        const allLearners = args.opponents === 'selfplay' ||
            (args.opponents === 'mixed' && round % 2 === 0);
        const learnerSeat = round % 4;
        const seats = trajectories.map((trajectory, seat) => {
            const isLearner = allLearners || seat === learnerSeat;
            if (!isLearner) {
                return { name: `heuristic-${seat}`, logic: BotLogic };
            }
            return {
                name: `learner-${seat}`,
                logic: new RLValueBot(model, {
                    epsilon,
                    heuristicWeight: args.heuristicWeight,
                    overrideMargin: args.overrideMargin,
                    rng,
                    onDecision: decision => trajectory.push(decision)
                })
            };
        });

        const result = playRound(seats, deal(rng));
        wins[result.winnerSeat]++;
        const utilities = roundUtilities(result);
        const trained = trainRound(model, trajectories, utilities, {
            learningRate: args.learningRate,
            gamma: args.gamma,
            rng
        });
        totalLoss += trained.loss;
        totalExamples += trained.examples;

        if ((round + 1) % args.reportEvery === 0 || round + 1 === args.rounds) {
            const elapsed = (Date.now() - started) / 1000;
            console.log(
                `round ${String(round + 1).padStart(7)}  ` +
                `epsilon=${epsilon.toFixed(3)}  ` +
                `mse=${(totalLoss / Math.max(1, totalExamples)).toFixed(5)}  ` +
                `rounds/s=${((round + 1) / Math.max(0.001, elapsed)).toFixed(1)}`
            );
        }
    }

    const metadata = {
        trainedAt: new Date().toISOString(),
        rounds: args.rounds,
        seed: args.seed,
        learningRate: args.learningRate,
        gamma: args.gamma,
        epsilonStart: args.epsilonStart,
        epsilonEnd: args.epsilonEnd,
        heuristicWeight: args.heuristicWeight,
        overrideMargin: args.overrideMargin,
        opponents: args.opponents,
        rulesVersion: RULES_VERSION,
        heuristicBotVersion: BOT_LOGIC_VERSION,
        meanSquaredError: totalLoss / Math.max(1, totalExamples),
        seatWins: wins
    };
    saveCheckpoint(model, args.output, metadata);
    console.log(`checkpoint ${args.output}`);
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

module.exports = { main, parseArgs, roundUtilities, trainRound, saveCheckpoint };
