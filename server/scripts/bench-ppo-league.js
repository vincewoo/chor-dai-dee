#!/usr/bin/env node
// Paired benchmark for one PPO policy against a deterministic rotation of the
// heuristic bot and historical PPO checkpoints. Reports the same trace shape
// as bench-rl-value-bot.js so existing paired diagnostics and promotion gates
// can compare a parent and candidate on identical deals and lineups.

const fs = require('fs');
const path = require('path');

const { BotLogic } = require('../game/BotLogic');
const { PPOModel } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const {
    calculateRoundScores,
    calculateDragonScores
} = require('../game/Scoring');
const { makeRng, deal, playRound } = require('../test/botHarness');
const {
    opponentPoolProvenance
} = require('./generate-ppo-experience');

function parseArgs(argv) {
    const args = {
        model: null,
        opponentPool: [],
        rounds: 12000,
        overrideMargin: 0.02,
        seed: 83471,
        output: null
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--model') args.model = path.resolve(argv[++i]);
        else if (flag === '--opponent-pool') {
            args.opponentPool.push(...argv[++i].split(',')
                .filter(Boolean)
                .map(file => path.resolve(file)));
        } else if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--override-margin') {
            args.overrideMargin = Number(argv[++i]);
        } else if (flag === '--seed') args.seed = Number(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

function leagueOpponentIndex(round, opponentCount) {
    return Math.floor(round / 4) % opponentCount;
}

function telemetrySummary(telemetry) {
    const divide = value => telemetry.decisions
        ? value / telemetry.decisions : 0;
    return {
        ...telemetry,
        overrideRate: divide(telemetry.overrides),
        rawOverrideAttemptRate: divide(telemetry.rawOverrideAttempts),
        guardFallbackRate: divide(telemetry.guardFallbacks),
        attemptedOverrideValueMargin: {
            count: 0,
            p10: null,
            p25: null,
            p50: null,
            p75: null,
            p90: null
        }
    };
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(
            'Usage: node scripts/bench-ppo-league.js --model FILE ' +
            '--opponent-pool FILE[,FILE...] --output FILE [options]');
        return 0;
    }
    if (!args.model || !args.opponentPool.length || !args.output) {
        throw new Error(
            '--model, --opponent-pool, and --output are required');
    }
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    args.opponentPool = [...new Set(args.opponentPool)];
    for (const file of [args.model, ...args.opponentPool]) {
        if (!fs.existsSync(file)) {
            throw new Error(`Checkpoint not found: ${file}`);
        }
    }

    const telemetry = {
        decisions: 0,
        overrides: 0,
        rawOverrideAttempts: 0,
        guardFallbacks: 0
    };
    let currentTrace = null;
    const learned = new PPOBot(PPOModel.load(args.model), {
        overrideMargin: args.overrideMargin,
        onDecision: decision => {
            telemetry.decisions++;
            telemetry.overrides += Number(decision.overrodeHeuristic);
            telemetry.rawOverrideAttempts +=
                Number(decision.rawPreferredOverride);
            telemetry.guardFallbacks += Number(decision.guardFallback);
            currentTrace.actions.push(decision.key);
        }
    });
    const opponents = [
        { name: 'heuristic', logic: BotLogic },
        ...args.opponentPool.map(file => ({
            name: `historical-${path.basename(path.dirname(file))}`,
            logic: new PPOBot(PPOModel.load(file), {
                overrideMargin: args.overrideMargin
            })
        }))
    ];
    const byOpponent = opponents.map(opponent => ({
        name: opponent.name,
        rounds: 0,
        wins: 0,
        points: 0,
        cardsLeft: 0
    }));
    const total = {
        name: 'value-1',
        rounds: 0,
        wins: 0,
        points: 0,
        cardsLeft: 0
    };
    const traces = [];
    const rng = makeRng(args.seed);
    const started = Date.now();

    for (let round = 0; round < args.rounds; round++) {
        const learnerSeat = round % 4;
        const opponentIndex = leagueOpponentIndex(round, opponents.length);
        const opponent = opponents[opponentIndex];
        const seats = [0, 1, 2, 3].map(seat =>
            seat === learnerSeat
                ? { name: 'value-1', logic: learned }
                : opponent
        );
        currentTrace = { round, actions: [] };
        const result = playRound(seats, deal(rng));
        const players = seats.map((seat, index) => ({
            id: index,
            name: seat.name,
            isBot: true,
            hand: { length: result.cardsLeft[index] }
        }));
        const scores = result.dragon
            ? calculateDragonScores(
                { id: result.winnerSeat }, players)
            : calculateRoundScores(
                { id: result.winnerSeat }, players);
        const learnedScore = scores[learnerSeat].roundPoints;
        const totalPenalty = scores.reduce(
            (sum, score) => sum + score.roundPoints, 0);
        const won = result.winnerSeat === learnerSeat;
        for (const stats of [total, byOpponent[opponentIndex]]) {
            stats.rounds++;
            stats.wins += Number(won);
            stats.points += learnedScore;
            stats.cardsLeft += result.cardsLeft[learnerSeat];
        }
        currentTrace.outcome = {
            won,
            points: learnedScore,
            cardsLeft: result.cardsLeft[learnerSeat],
            utility: won ? totalPenalty / 117 : -learnedScore / 117,
            seat: learnerSeat,
            opponent: opponent.name
        };
        traces.push(currentTrace);
    }

    const summarize = stats => ({
        name: stats.name,
        rounds: stats.rounds,
        wins: stats.wins,
        winRate: stats.wins / stats.rounds,
        avgPoints: stats.points / stats.rounds,
        avgCardsLeft: stats.cardsLeft / stats.rounds
    });
    const result = summarize(total);
    const report = {
        schemaVersion: 1,
        model: path.basename(args.model),
        rounds: args.rounds,
        seed: args.seed,
        heuristicWeight: 0.2,
        overrideMargin: args.overrideMargin,
        opponentPool: opponentPoolProvenance(args.opponentPool),
        results: [result],
        byOpponent: byOpponent.map(summarize),
        telemetry: telemetrySummary(telemetry),
        traces
    };
    fs.writeFileSync(args.output, `${JSON.stringify(report)}\n`);
    console.log(
        `PPO league benchmark [${args.rounds} rounds, ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s]`);
    console.log('   opponent       win rate   avg points   avg cards left');
    for (const item of [result, ...report.byOpponent]) {
        console.log(
            `   ${item.name.padEnd(14)} ` +
            `${(item.winRate * 100).toFixed(1).padStart(6)}%   ` +
            `${item.avgPoints.toFixed(2).padStart(8)}   ` +
            `${item.avgCardsLeft.toFixed(2).padStart(12)}`
        );
    }
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

module.exports = { main, parseArgs, leagueOpponentIndex };
