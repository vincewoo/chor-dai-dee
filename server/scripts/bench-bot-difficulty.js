#!/usr/bin/env node
// Calibration and monotonicity gate for the bot difficulty tiers.
//
// Seats one fixed full-strength reference player against three bots of a single
// tier and reports how often the reference wins. That is the number a player
// actually feels: "how well does a strong opponent do at a table of these
// bots". Neutral is 25%; higher means an easier table.
//
// The tiers are only meaningful if they are ordered, so this exits non-zero
// unless each easier tier gives the reference a materially higher win rate than
// the one above it. Temperatures in BotPolicy.js were picked from this output;
// re-run it before changing them.
//
//   node scripts/bench-bot-difficulty.js
//   node scripts/bench-bot-difficulty.js --rounds 6000 --seeds 4242,90210

const path = require('path');

const { PPOModel } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const {
    BOT_DIFFICULTIES,
    DEFAULT_BOT_DIFFICULTY,
    DEFAULT_PPO_MODEL_PATH
} = require('../game/BotPolicy');
const { runBenchmark, makeRng } = require('../test/botHarness');

// Below this the tiers are not distinguishable from noise at the default round
// count, and a player would not feel the difference either.
const MIN_STEP_PP = 3;

// Easiest first, so the reported win rate should fall down the table.
const LADDER = ['casual', 'balanced', 'competitive'];

function parseArgs(argv) {
    const args = {
        rounds: 2000,
        seeds: [4242, 90210],
        modelPath: DEFAULT_PPO_MODEL_PATH,
        help: false
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--seeds') {
            args.seeds = argv[++i].split(',').map(Number).filter(Number.isFinite);
        } else if (flag === '--model') args.modelPath = path.resolve(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

/**
 * One reference seat against three of `tier`.
 *
 * Each opposing seat gets its own seeded rng, so the three bots sample
 * independently rather than making the same "mistake" in lockstep, which is
 * also what happens live where each PPOBot draws from Math.random.
 */
function measureTier(model, tier, { rounds, seed }) {
    const knobs = BOT_DIFFICULTIES[tier];
    const reference = {
        name: 'REF',
        logic: new PPOBot(model, {
            sample: BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY].sample,
            temperature: BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY].temperature,
            overrideMargin: 0.02
        })
    };
    const opponents = [1, 2, 3].map(index => ({
        name: `${tier}-${index}`,
        logic: new PPOBot(model, {
            sample: knobs.sample,
            temperature: knobs.temperature,
            overrideMargin: 0.02,
            rng: makeRng(seed + index * 7919)
        })
    }));

    const results = runBenchmark([reference, ...opponents], { rounds, seed });
    const [ref, ...bots] = results;
    return {
        refWinRate: ref.winRate,
        refPoints: ref.avgPoints,
        botWinRate: bots.reduce((sum, b) => sum + b.winRate, 0) / bots.length,
        botPoints: bots.reduce((sum, b) => sum + b.avgPoints, 0) / bots.length
    };
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log('Usage: bench-bot-difficulty.js [--rounds N] ' +
            '[--seeds A,B] [--model FILE]');
        return 0;
    }

    const model = PPOModel.load(args.modelPath);
    const started = Date.now();

    console.log(`\nBot difficulty ladder  [${path.basename(args.modelPath)}, ` +
        `${args.rounds} rounds x ${args.seeds.length} seed(s)]`);
    console.log('One full-strength reference seat vs three bots of each tier.');
    console.log('Neutral is 25.0%; a higher reference win rate is an easier table.\n');
    console.log('   tier          REF win%    REF pts    bot win%   bot pts');

    const meanByTier = new Map();
    for (const tier of LADDER) {
        const runs = args.seeds.map(seed =>
            measureTier(model, tier, { rounds: args.rounds, seed }));
        const mean = key => runs.reduce((s, r) => s + r[key], 0) / runs.length;
        const refWinRate = mean('refWinRate');
        meanByTier.set(tier, refWinRate);
        console.log(
            `   ${tier.padEnd(13)}` +
            `${(refWinRate * 100).toFixed(1).padStart(6)}%` +
            `${mean('refPoints').toFixed(2).padStart(11)}` +
            `${(mean('botWinRate') * 100).toFixed(1).padStart(11)}%` +
            `${mean('botPoints').toFixed(2).padStart(10)}`);
    }

    console.log(`\nElapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);

    // The gate. A tier that is not measurably easier than the next one up is
    // not a tier, it is a duplicate entry in a menu.
    const failures = [];
    for (let i = 0; i < LADDER.length - 1; i++) {
        const easier = LADDER[i];
        const harder = LADDER[i + 1];
        const stepPP = (meanByTier.get(easier) - meanByTier.get(harder)) * 100;
        if (stepPP < MIN_STEP_PP) {
            failures.push(`${easier} is only ${stepPP.toFixed(1)}pp easier than ` +
                `${harder} (need >= ${MIN_STEP_PP}pp)`);
        }
    }

    // The hardest tier is today's shipped bot, so it has to land on neutral.
    // Drifting off 25% here means the reference and the tier have diverged,
    // which would invalidate every other row in the table.
    const hardest = meanByTier.get(LADDER[LADDER.length - 1]);
    if (Math.abs(hardest - 0.25) > 0.02) {
        failures.push(`${LADDER[LADDER.length - 1]} should be neutral (25%) ` +
            `against an identical reference, measured ${(hardest * 100).toFixed(1)}%`);
    }

    if (failures.length) {
        console.error('\nLadder check FAILED:');
        for (const failure of failures) console.error(`  - ${failure}`);
        return 1;
    }
    console.log('\nLadder check passed: each tier is materially easier than the next.');
    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { measureTier, LADDER, MIN_STEP_PP };
