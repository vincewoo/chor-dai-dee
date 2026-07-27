#!/usr/bin/env node

const path = require('path');

const { BotLogic } = require('../game/BotLogic');
const { RLValueModel } = require('../game/RLValueModel');
const { RLValueBot } = require('../game/RLValueBot');
const { runBenchmarkAsync } = require('../test/botHarness');

const modelPath = path.resolve(process.argv[2] || path.join(__dirname, '../ai/rl-value-model.json'));
const rounds = Number(process.argv[3]) || 4000;
const heuristicWeight = process.argv[4] === undefined ? 0.20 : Number(process.argv[4]);
const overrideMargin = process.argv[5] === undefined ? 0.05 : Number(process.argv[5]);
const seed = process.argv[6] === undefined ? 83471 : Number(process.argv[6]);
const model = RLValueModel.load(modelPath);
const learned = new RLValueBot(model, { heuristicWeight, overrideMargin });

const contenders = [
    { name: 'value-1', logic: learned },
    { name: 'heuristic-1', logic: BotLogic },
    { name: 'heuristic-2', logic: BotLogic },
    { name: 'heuristic-3', logic: BotLogic }
];

async function main() {
    const started = Date.now();
    const results = await runBenchmarkAsync(contenders, { rounds, seed });
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
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
