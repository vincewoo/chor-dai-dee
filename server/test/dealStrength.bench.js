// server/test/dealStrength.bench.js
//
// Regenerates every constant in game/DealStrength.js from simulation.
//
// Run this when the bot logic, the rules, or the deal-strength formula change,
// then paste the output back into DealStrength.js and bump BASELINE_VERSION.
// The baseline describes what a competent player gets from a given deal, so it
// drifts as the bots that define "competent" change.
//
//   node server/test/dealStrength.bench.js            # standard run
//   node server/test/dealStrength.bench.js 20000      # more rounds
//
// Deliberately not part of `npm test`: it takes ~30s and produces constants for
// a human to review, rather than an assertion.

const { makeRng, deal, playRound } = require('./botHarness');
const { calculateRoundScores } = require('../game/Scoring');
const { rawDealStrength, TIERS } = require('../game/DealStrength');
const { BotLogic } = require('../game/BotLogic');

const ROUNDS = Number(process.argv[2] || 12000);
const DEALS = 200000;

function tierIndexFor(raw) {
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) if (raw >= TIERS[i].min) idx = i;
    return idx;
}

// ---------------------------------------------------------------------------
// 1. Distribution of the raw score over random deals.
// ---------------------------------------------------------------------------
console.log(`Sampling ${DEALS.toLocaleString()} random deals...`);
const rngDeals = makeRng(1);
const raws = [];
const tierCounts = TIERS.map(() => 0);
for (let i = 0; i < DEALS; i++) {
    const raw = rawDealStrength(deal(rngDeals)[0]);
    raws.push(raw);
    tierCounts[tierIndexFor(raw)]++;
}
raws.sort((a, b) => a - b);

const breakpoints = [];
for (let p = 1; p <= 99; p++) breakpoints.push(raws[Math.floor((p / 100) * (raws.length - 1))]);

console.log('\n=== PERCENTILE_BREAKPOINTS (paste into DealStrength.js) ===');
for (let i = 0; i < breakpoints.length; i += 20) {
    const row = breakpoints.slice(i, i + 20).map(v => String(v).padStart(3));
    console.log('    ' + row.join(',') + (i + 20 < breakpoints.length ? ',' : ''));
}
console.log(`\nraw score: min=${raws[0]} max=${raws[raws.length - 1]} ` +
    `mean=${(raws.reduce((a, b) => a + b, 0) / raws.length).toFixed(2)}`);

// ---------------------------------------------------------------------------
// 2. Outcome baseline per tier, from bot self-play.
// ---------------------------------------------------------------------------
console.log(`\nPlaying ${ROUNDS.toLocaleString()} self-play rounds...`);
const rng = makeRng(7777);
const seats = [0, 1, 2, 3].map(i => ({ name: `bot${i}`, logic: BotLogic }));
const rows = [];

for (let r = 0; r < ROUNDS; r++) {
    const hands = deal(rng);
    const result = playRound(seats, hands, null);
    const players = hands.map((h, i) => ({
        id: i, name: `bot${i}`, isBot: true, hand: { length: result.cardsLeft[i] }
    }));
    const scores = calculateRoundScores({ id: result.winnerSeat }, players);

    const seatRaw = hands.map(rawDealStrength);
    const order = [...seatRaw.keys()].sort((a, b) => seatRaw[b] - seatRaw[a]);
    const rank = [];
    order.forEach((seat, i) => { rank[seat] = i + 1; });

    for (let s = 0; s < 4; s++) {
        rows.push({
            tier: tierIndexFor(seatRaw[s]),
            rank: rank[s],
            won: s === result.winnerSeat ? 1 : 0,
            points: scores[s].roundPoints
        });
    }
}

console.log('\n=== TIER BASELINE (paste into DealStrength.js) ===');
const expWin = [], expPts = [];
TIERS.forEach((tier, i) => {
    const slice = rows.filter(r => r.tier === i);
    const winRate = slice.reduce((s, r) => s + r.won, 0) / slice.length;
    const avgPoints = slice.reduce((s, r) => s + r.points, 0) / slice.length;
    expWin[i] = winRate; expPts[i] = avgPoints;
    console.log(`  ${tier.key.padEnd(8)} winRate: ${winRate.toFixed(3)}, ` +
        `avgPoints: ${avgPoints.toFixed(2)}, share: ${(tierCounts[i] / DEALS).toFixed(3)}   (n=${slice.length})`);
});

console.log('\n=== rank at table ===');
for (let k = 1; k <= 4; k++) {
    const slice = rows.filter(r => r.rank === k);
    console.log(`  rank ${k}: win ${(slice.reduce((s, r) => s + r.won, 0) / slice.length * 100).toFixed(1)}%` +
        `   pts ${(slice.reduce((s, r) => s + r.points, 0) / slice.length).toFixed(2)}`);
}
const steals = rows.filter(r => r.rank === 4 && r.won).length;
console.log(`  steal rate (won holding the weakest deal): ${(steals / (rows.length / 4) * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 3. Residual noise -> how many rounds before Edge means anything.
// ---------------------------------------------------------------------------
let sqWin = 0, sqPts = 0;
for (const r of rows) {
    sqWin += (r.won - expWin[r.tier]) ** 2;
    sqPts += (r.points - expPts[r.tier]) ** 2;
}
const sdWin = Math.sqrt(sqWin / rows.length);
const sdPts = Math.sqrt(sqPts / rows.length);
console.log(`\n=== residual SD per round: win ${sdWin.toFixed(3)}, points ${sdPts.toFixed(2)} ===`);
console.log('rounds needed for a 95% CI of the given half-width:');
for (const w of [0.10, 0.05, 0.03]) {
    console.log(`  win rate +/-${(w * 100).toFixed(0)}pp -> ${Math.ceil((1.96 * sdWin / w) ** 2)} rounds`);
}
for (const w of [0.5, 0.3, 0.2]) {
    console.log(`  points   +/-${w} -> ${Math.ceil((1.96 * sdPts / w) ** 2)} rounds`);
}
