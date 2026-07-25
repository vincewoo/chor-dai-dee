// server/test/botBench.js
//
// Benchmark the current bot against itself under different configurations.
//
//   node server/test/botBench.js [rounds]
//
// To A/B a change: copy BotLogic.js aside before editing, require both here,
// and seat the old one opposite the new one. Identical logic in all four seats
// lands near 25% each, so anything outside roughly 22-28% at 2000 rounds is a
// real difference rather than noise.

const { BotLogic } = require('../game/BotLogic');
const { runBenchmark, measureHighCardLeakage, makeRng } = require('./botHarness');

const rounds = Number(process.argv[2]) || 2000;
const rng = makeRng(31337);

const profiled = (name) => ({ name, logic: BotLogic, profile: BotLogic.getBotProfile(name), rng });
const plain = (name) => ({ name, logic: BotLogic });

const report = (title, contenders) => {
    const started = Date.now();
    const results = runBenchmark(contenders, { rounds, seed: 999 });
    console.log(`\n${title}  [${rounds} rounds, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
    console.log('   name      win rate   avg points   avg cards left');
    for (const r of results) {
        console.log(`   ${r.name.padEnd(9)} ${(r.winRate * 100).toFixed(1).padStart(6)}%   ${r.avgPoints.toFixed(2).padStart(8)}   ${r.avgCardsLeft.toFixed(2).padStart(12)}`);
    }
};

report('Four identical bots (argmax) - expect ~25% each', [
    plain('argmax-1'), plain('argmax-2'), plain('argmax-3'), plain('argmax-4')
]);

report('Four bots with per-bot profiles - the real room setup', [
    profiled('Bot 1'), profiled('Bot 2'), profiled('Bot 3'), profiled('Bot 4')
]);

console.log('\nHigh-card leakage: answers a single of rank <= 9 with a K/A/2');
console.log('despite holding a cheaper legal beater. Was 55-64% at 7-9 cards.');
for (const handSize of [13, 11, 9, 7]) {
    const { rate, trials } = measureHighCardLeakage(BotLogic, { handSize });
    console.log(`   hand=${String(handSize).padStart(2)}   ${(rate * 100).toFixed(1).padStart(5)}%   (${trials} positions)`);
}

console.log('\nDecision cost');
const { deal } = require('./botHarness');
const timingRng = makeRng(5);
for (const label of ['free play', 'responding']) {
    const hands = deal(timingRng);
    const toBeat = label === 'responding'
        ? require('../game/Big2Rules').Big2Rules.validateHand([hands[1][0]])
        : null;
    const started = Date.now();
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
        BotLogic.getBotMove(hands[0], toBeat, false, {
            playerCardCounts: [13, 13, 13], passedPlayers: [], passCount: 0,
            playedCards: [], playHistory: []
        }, false);
    }
    console.log(`   ${label.padEnd(11)} ${((Date.now() - started) / iterations).toFixed(2)} ms per decision`);
}
