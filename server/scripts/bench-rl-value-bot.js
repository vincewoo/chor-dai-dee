#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { BotLogic } = require('../game/BotLogic');
const { RLValueModel } = require('../game/RLValueModel');
const { RLValueBot } = require('../game/RLValueBot');
const { PPOModel } = require('../game/PPOModel');
const { PPOBot } = require('../game/PPOBot');
const { runBenchmarkAsync } = require('../test/botHarness');

const modelPath = path.resolve(process.argv[2] || path.join(__dirname, '../ai/rl-value-model.json'));
const rounds = Number(process.argv[3]) || 4000;
const heuristicWeight = process.argv[4] === undefined ? 0.20 : Number(process.argv[4]);
const overrideMargin = process.argv[5] === undefined ? 0.05 : Number(process.argv[5]);
const seed = process.argv[6] === undefined ? 83471 : Number(process.argv[6]);
const jsonOutput = process.argv[7] ? path.resolve(process.argv[7]) : null;
const artifact = JSON.parse(fs.readFileSync(modelPath, 'utf8'));

function quantile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * fraction;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function makeTelemetry() {
    return {
        decisions: 0,
        overrides: 0,
        rawOverrideAttempts: 0,
        guardFallbacks: 0,
        attemptedOverrideMargins: []
    };
}

function recordTelemetry(telemetry, decision) {
    telemetry.decisions++;
    if (decision.overrodeHeuristic) telemetry.overrides++;
    if (decision.rawPreferredOverride) {
        telemetry.rawOverrideAttempts++;
        if (Number.isFinite(decision.valueMargin)) {
            telemetry.attemptedOverrideMargins.push(decision.valueMargin);
        }
    }
    if (decision.guardFallback) telemetry.guardFallbacks++;
}

function summarizeTelemetry(telemetry) {
    const margins = telemetry.attemptedOverrideMargins.sort((a, b) => a - b);
    const divide = value => telemetry.decisions ? value / telemetry.decisions : 0;
    return {
        decisions: telemetry.decisions,
        overrides: telemetry.overrides,
        overrideRate: divide(telemetry.overrides),
        rawOverrideAttempts: telemetry.rawOverrideAttempts,
        rawOverrideAttemptRate: divide(telemetry.rawOverrideAttempts),
        guardFallbacks: telemetry.guardFallbacks,
        guardFallbackRate: divide(telemetry.guardFallbacks),
        attemptedOverrideValueMargin: {
            count: margins.length,
            p10: quantile(margins, 0.10),
            p25: quantile(margins, 0.25),
            p50: quantile(margins, 0.50),
            p75: quantile(margins, 0.75),
            p90: quantile(margins, 0.90)
        }
    };
}

const telemetry = makeTelemetry();
let currentTrace = null;
const traces = [];
const onDecision = decision => {
    recordTelemetry(telemetry, decision);
    if (currentTrace) currentTrace.actions.push(decision.key);
};
const learned = artifact.kind === 'chor-dai-dee-ppo-policy'
    ? new PPOBot(new PPOModel(artifact), {
        overrideMargin,
        onDecision
    })
    : new RLValueBot(RLValueModel.fromArtifact(artifact), {
        heuristicWeight,
        overrideMargin,
        onDecision
    });

const contenders = [
    { name: 'value-1', logic: learned },
    { name: 'heuristic-1', logic: BotLogic },
    { name: 'heuristic-2', logic: BotLogic },
    { name: 'heuristic-3', logic: BotLogic }
];

async function main() {
    const started = Date.now();
    const hooks = jsonOutput ? {
        onRoundStart: ({ round }) => {
            currentTrace = { round, actions: [] };
        },
        onRoundEnd: ({ rotation, seatToContender, result, scores }) => {
            const learnedSeat = [0, 1, 2, 3]
                .find(seat => seatToContender(seat) === 0);
            const learnedScore = scores[learnedSeat].roundPoints;
            const totalPenalty = scores.reduce(
                (sum, score) => sum + score.roundPoints, 0);
            currentTrace.outcome = {
                won: result.winnerSeat === learnedSeat,
                points: learnedScore,
                cardsLeft: result.cardsLeft[learnedSeat],
                utility: result.winnerSeat === learnedSeat
                    ? totalPenalty / 117
                    : -learnedScore / 117,
                seat: learnedSeat,
                rotation
            };
            traces.push(currentTrace);
            currentTrace = null;
        }
    } : {};
    const results = await runBenchmarkAsync(contenders, { rounds, seed, ...hooks });
    console.log(`RL value benchmark [${rounds} rounds, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
    console.log('   name          win rate   avg points   avg cards left');
    for (const result of results) {
        console.log(
            `   ${result.name.padEnd(13)} ` +
            `${(result.winRate * 100).toFixed(1).padStart(6)}%   ` +
            `${result.avgPoints.toFixed(2).padStart(8)}   ` +
            `${result.avgCardsLeft.toFixed(2).padStart(12)}`
        );
    }
    if (jsonOutput) {
        const report = {
            schemaVersion: 1,
            model: path.basename(modelPath),
            rounds,
            seed,
            heuristicWeight,
            overrideMargin,
            results,
            telemetry: summarizeTelemetry(telemetry),
            traces
        };
        fs.writeFileSync(jsonOutput, `${JSON.stringify(report)}\n`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
