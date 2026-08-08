#!/usr/bin/env node
// Does dropping the hidden persona actually make a Max Bots table harder?
//
// Same shape as bench-bot-difficulty.js, with the axes swapped: difficulty is
// held fixed at argmax for every seat and only the persona varies. One fixed
// full-strength `classic` reference seat sits against three bots that are
// either production personas (drawn independently per matchup, exactly as
// RoomManager.assignBotPersonas does) or `classic`. Neutral is 25%; a LOWER
// reference win rate means a harder table.
//
// The two lineups are run on identical deal streams and differenced pairwise,
// because the between-matchup spread from the deals alone is far larger than
// the effect being measured.
//
//   node scripts/bench-maxbots-persona.js
//   node scripts/bench-maxbots-persona.js --rounds 4000 --matchups 24

const path = require('path');

const { loadPPOModel } = require('../game/ModelLoader');
const { PPOBot } = require('../game/PPOBot');
const { BOT_PERSONA_IDS, DEFAULT_BOT_STYLE } = require('../game/BotStyle');
const {
    BOT_DIFFICULTIES,
    MAX_BOT_DIFFICULTY,
    DEFAULT_PPO_MODEL_PATH
} = require('../game/BotPolicy');
const { runBenchmark, makeRng } = require('../test/botHarness');

function parseArgs(argv) {
    const args = {
        rounds: 4000,
        matchups: 12,
        seed: 4242,
        modelPath: DEFAULT_PPO_MODEL_PATH,
        help: false
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--matchups') args.matchups = Number(argv[++i]);
        else if (flag === '--seed') args.seed = Number(argv[++i]);
        else if (flag === '--model') args.modelPath = path.resolve(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    if (!Number.isInteger(args.rounds) || args.rounds <= 0) {
        throw new Error('--rounds must be a positive integer');
    }
    if (!Number.isInteger(args.matchups) || args.matchups < 2) {
        throw new Error('--matchups must be an integer of at least 2');
    }
    if (!Number.isInteger(args.seed)) throw new Error('--seed must be an integer');
    return args;
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Standard error of the mean over matchups (sample sd, n-1). */
function sem(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    const variance = values.reduce(
        (sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance / values.length);
}

/**
 * One classic reference seat against three seats of the given styles.
 *
 * Every seat is the ceiling's own knobs, so the only difference between the two
 * lineups is the style overlay - not temperature, not the override guard.
 */
function measure(model, styles, { rounds, seed }) {
    const knobs = BOT_DIFFICULTIES[MAX_BOT_DIFFICULTY];
    const seat = style => new PPOBot(model, {
        sample: knobs.sample,
        temperature: knobs.temperature,
        overrideMargin: 0.02,
        style
    });

    const [reference, ...bots] = runBenchmark([
        { name: 'REF', logic: seat(DEFAULT_BOT_STYLE) },
        ...styles.map((style, index) => ({
            name: `${style}-${index}`,
            logic: seat(style)
        }))
    ], { rounds, seed });

    return {
        refWinRate: reference.winRate,
        refPoints: reference.avgPoints,
        botWinRate: mean(bots.map(bot => bot.winRate)),
        botPoints: mean(bots.map(bot => bot.avgPoints))
    };
}

function report(label, runs) {
    const refWinRates = runs.map(run => run.refWinRate);
    console.log(
        `   ${label.padEnd(20)}` +
        `${(mean(refWinRates) * 100).toFixed(2).padStart(7)}%` +
        ` +/-${(sem(refWinRates) * 100).toFixed(2).padStart(5)}pp` +
        `${mean(runs.map(r => r.refPoints)).toFixed(3).padStart(10)}` +
        `${(mean(runs.map(r => r.botWinRate)) * 100).toFixed(2).padStart(9)}%` +
        `${mean(runs.map(r => r.botPoints)).toFixed(3).padStart(9)}`);
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log('Usage: bench-maxbots-persona.js [--rounds N] ' +
            '[--matchups N] [--seed N] [--model FILE]');
        return 0;
    }

    const model = loadPPOModel(args.modelPath);

    console.log(`\nMax Bots persona check  [${path.basename(args.modelPath)}, ` +
        `${args.rounds} rounds x ${args.matchups} matchups, every seat argmax]`);
    console.log('One classic full-strength reference seat vs three Max Bots.');
    console.log('Neutral is 25.00%; a LOWER reference win rate is a harder table.\n');
    console.log('   lineup               REF win%          REF pts  bot win%  bot pts');

    const personaRuns = [];
    const classicRuns = [];
    const classicLineup = [0, 1, 2].map(() => DEFAULT_BOT_STYLE);
    for (let matchup = 0; matchup < args.matchups; matchup++) {
        const seed = args.seed + matchup * 7919;
        // Independent draws, like assignBotPersonas: duplicates are valid.
        const draw = makeRng(seed * 31 + 17);
        const personas = [0, 1, 2].map(() =>
            BOT_PERSONA_IDS[Math.floor(draw() * BOT_PERSONA_IDS.length)]);
        personaRuns.push(measure(model, personas, { rounds: args.rounds, seed }));
        classicRuns.push(measure(
            model, classicLineup, { rounds: args.rounds, seed }));
    }

    report('personas', personaRuns);
    report('classic (Max Bots)', classicRuns);

    const deltas = personaRuns.map(
        (run, index) => run.refWinRate - classicRuns[index].refWinRate);
    const delta = mean(deltas);
    const error = sem(deltas);
    console.log(`\n   paired delta (personas - classic): ` +
        `${(delta * 100).toFixed(2)}pp +/- ${(error * 100).toFixed(2)}pp` +
        ` (${(delta / (error || Infinity)).toFixed(1)} sigma)`);
    console.log('   Positive means personas hand the reference more rounds, ' +
        'i.e. a weaker table.\n');
    return 0;
}

if (require.main === module) process.exit(main());

module.exports = { measure };
