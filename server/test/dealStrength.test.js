// server/test/dealStrength.test.js
//
// Deal strength feeds a persisted stat, so the parts worth pinning are the ones
// that would silently corrupt recorded history: the ordering property the whole
// feature rests on, the tier cutoffs, and rank assignment at a table.

const test = require('node:test');
const assert = require('node:assert');

const {
    calculateDealStrength, rankTable, rawDealStrength, playsNeeded, TIERS, BASELINE_VERSION
} = require('../game/DealStrength');
const { RANKS, SUITS } = require('../game/Deck');

const card = (rank, suit) => ({
    rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit)
});

/** Build a hand from "rank+suit" shorthand, e.g. hand('3D', '4C', ...). */
const hand = (...codes) => codes.map(code => {
    const suit = code.slice(-1);
    return card(code.slice(0, -1), suit);
});

test('playsNeeded counts a rank group as a single play', () => {
    // Four 3s plus nine distinct ranks: one quad play + 9 singles.
    const h = hand('3D', '3C', '3H', '3S', '4D', '5C', '6H', '8S', '9D', 'JC', 'QH', 'KS', 'AD');
    // The greedy pass may consume some of these into a 5-card hand first, so
    // assert the bound rather than an exact partition.
    assert.ok(playsNeeded(h) <= 10, `expected <= 10 plays, got ${playsNeeded(h)}`);
});

test('playsNeeded rewards a hand that partitions into few combinations', () => {
    // A flush plus two triples plus a pair sheds far faster than 13 singles.
    const tidy = hand('3D', '5D', '7D', '9D', 'JD',
                      '4C', '4H', '4S', '6C', '6H', '6S', '8C', '8H');
    const scattered = hand('3D', '4C', '5H', '6S', '8D', '9C', '10H', 'JS', 'QD', 'KC', 'AH', '2S', '7D');
    assert.ok(playsNeeded(tidy) < playsNeeded(scattered),
        `tidy=${playsNeeded(tidy)} scattered=${playsNeeded(scattered)}`);
});

test('a hand of control cards outscores a hand of low cards', () => {
    const strong = hand('2S', '2H', '2C', '2D', 'AS', 'AH', 'AC', 'AD', 'KS', 'KH', 'KC', 'KD', 'QS');
    const weak = hand('3D', '4C', '5H', '6S', '7D', '8C', '9H', '10S', '3C', '4H', '5S', '6D', '7C');
    assert.ok(rawDealStrength(strong) > rawDealStrength(weak));
    assert.strictEqual(calculateDealStrength(strong).tierKey, 'premium');
});

test('adding a 2 to a hand never lowers its score', () => {
    // The ordering property the entire feature rests on: a strictly better card
    // must not score worse. A weighting change that broke this would quietly
    // invert recorded history.
    const base = hand('3D', '4C', '5H', '6S', '7D', '8C', '9H', '10S', 'JD', 'QC', 'KH', 'AS');
    const withLow = [...base, card('3C')];
    const withTwo = [...base, card('2S')];
    assert.ok(rawDealStrength(withTwo) >= rawDealStrength(withLow));
});

test('tiers are ordered and their baselines are monotone', () => {
    for (let i = 1; i < TIERS.length; i++) {
        assert.ok(TIERS[i].min > TIERS[i - 1].min, `tier ${i} min not increasing`);
        assert.ok(TIERS[i].winRate > TIERS[i - 1].winRate, `tier ${i} winRate not increasing`);
        assert.ok(TIERS[i].avgPoints < TIERS[i - 1].avgPoints, `tier ${i} avgPoints not decreasing`);
    }
    // A baseline that does not sum to ~1 of the deal space means the tier
    // cutoffs and the sampled shares have drifted apart.
    const totalShare = TIERS.reduce((s, t) => s + t.share, 0);
    assert.ok(Math.abs(totalShare - 1) < 0.02, `tier shares sum to ${totalShare}`);
});

test('tier assignment respects the cutoffs', () => {
    // Raw score is not directly constructible, so drive it through the cutoffs.
    const cases = [[-9, 'rough'], [-4, 'rough'], [-3, 'weak'], [-1, 'weak'],
                   [0, 'average'], [1, 'average'], [2, 'strong'], [4, 'strong'],
                   [5, 'premium'], [19, 'premium']];
    for (const [raw, expected] of cases) {
        const tier = TIERS.filter(t => raw >= t.min).pop();
        assert.strictEqual(tier.key, expected, `raw ${raw} should be ${expected}`);
    }
});

test('percentile stays within range and tracks the raw score', () => {
    const strong = hand('2S', '2H', '2C', '2D', 'AS', 'AH', 'AC', 'AD', 'KS', 'KH', 'KC', 'KD', 'QS');
    const weak = hand('3D', '4C', '5H', '6S', '7D', '8C', '9H', '10S', '3C', '4H', '5S', '6D', '7C');
    const s = calculateDealStrength(strong), w = calculateDealStrength(weak);
    for (const r of [s, w]) {
        assert.ok(r.percentile >= 0 && r.percentile <= 99, `percentile out of range: ${r.percentile}`);
    }
    assert.ok(s.percentile > w.percentile);
});

test('rankTable orders seats by strength, strongest first', () => {
    const hands = [
        hand('3D', '4C', '5H', '6S', '7D', '8C', '9H', '10S', '3C', '4H', '5S', '6D', '7C'), // weakest
        hand('2S', '2H', '2C', '2D', 'AS', 'AH', 'AC', 'AD', 'KS', 'KH', 'KC', 'KD', 'QS'), // strongest
        hand('3H', '4S', '5D', '6C', '7H', '8S', '9D', '10C', 'JH', 'QS', 'KD', 'AC', '2C'),
        hand('3S', '4D', '5C', '6H', '7S', '8D', '9C', '10H', 'JS', 'QD', 'KC', 'AH', '2H')
    ];
    const scored = rankTable(hands);
    assert.strictEqual(scored.length, 4);
    assert.strictEqual(scored[1].rank, 1, 'the premium hand should rank first');
    assert.strictEqual(scored[0].rank, 4, 'the weakest hand should rank last');

    // Rank must agree with raw score for every pair, ties included.
    for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
            if (scored[a].raw > scored[b].raw) {
                assert.ok(scored[a].rank < scored[b].rank,
                    `seat ${a} (raw ${scored[a].raw}) should rank above seat ${b} (raw ${scored[b].raw})`);
            } else if (scored[a].raw === scored[b].raw) {
                assert.strictEqual(scored[a].rank, scored[b].rank,
                    `equal raws must share a rank (seats ${a}, ${b})`);
            }
        }
    }
});

test('rankTable gives tied hands the same rank', () => {
    // Same rank multiset in two different suits. Kept clear of the 2S bonus,
    // which deliberately breaks symmetry between otherwise identical shapes.
    const shape = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const hands = [
        [...shape.map(r => card(r, 'D')), card('3', 'C')],
        [...shape.map(r => card(r, 'H')), card('3', 'S')],
        hand('2S', '2H', '2C', '2D', 'AS', 'AH', 'AC', 'AD', 'KS', 'KH', 'KC', 'KD', 'QS'),
        hand('4D', '4C', '5H', '6S', '7D', '8C', '9H', '10S', '3C', '4H', '5S', '6D', '7C')
    ];
    const scored = rankTable(hands);
    assert.strictEqual(scored[0].raw, scored[1].raw, 'fixture should produce a tie');
    assert.strictEqual(scored[0].rank, scored[1].rank, 'tied hands must share a rank');
    assert.strictEqual(scored[2].rank, 1, 'the premium hand still ranks first');
});

test('an empty hand scores zero rather than throwing', () => {
    assert.strictEqual(rawDealStrength([]), 0);
    assert.strictEqual(calculateDealStrength([]).raw, 0);
});

test('BASELINE_VERSION is a positive integer', () => {
    assert.ok(Number.isInteger(BASELINE_VERSION) && BASELINE_VERSION > 0);
});

// --- the game-over drill-in --------------------------------------------------
//
// Room.describeDealLuck() is the only thing that ever shows a player anything
// about the deal, and only at game over. What is pinned here is the accumulator
// (which outlives a round, unlike roundDealStrength) and the leak boundary: the
// per-round rank compares all four dealt hands, so it must not appear anywhere
// a round can still be played.

const { Room } = require('../game/RoomManager');

const seatFour = (room) => {
    room.addPlayer({ id: 'p1', name: 'Alice', isBot: false });
    room.addPlayer({ id: 'p2', name: 'Bot Ada', isBot: true });
    room.addPlayer({ id: 'p3', name: 'Bot Bea', isBot: true });
    room.addPlayer({ id: 'p4', name: 'Bot Cy', isBot: true });
    return room;
};

test('deal luck accumulates across rounds and covers every seat', () => {
    const room = seatFour(new Room('DEAL-LUCK', 'short'));
    room.startGame();
    room.roundNumber++;
    room.startRound();

    const luck = room.describeDealLuck();

    // Bots included: the accumulator reads the table, not the stats tables.
    // round_stats only carries registered humans, which is why the game-over
    // screen cannot be built from it.
    assert.deepStrictEqual(
        Object.keys(luck).sort(),
        ['Alice', 'Bot Ada', 'Bot Bea', 'Bot Cy']);

    for (const entry of Object.values(luck)) {
        assert.strictEqual(entry.rounds.length, 2,
            'roundDealStrength is wiped every round; this must not be');
        assert.ok(Number.isInteger(entry.avgPercentile));
        assert.ok(entry.avgPercentile >= 0 && entry.avgPercentile <= 100);
    }
});

test('every round ranks the four seats 1-4', () => {
    const room = seatFour(new Room('DEAL-LUCK-RANKS', 'short'));
    room.startGame();

    const ranks = Object.values(room.describeDealLuck())
        .map(entry => entry.rounds[0].rank)
        .sort();

    assert.strictEqual(ranks.length, 4);
    for (const rank of ranks) {
        assert.ok(rank >= 1 && rank <= 4, `rank out of range: ${rank}`);
    }
    // Ties share the better rank, so 1,1,3,4 is legal and 1,2,3,5 is not.
    assert.strictEqual(ranks[0], 1, 'somebody held the best hand');
});

test('a new game does not inherit the previous game deals', () => {
    const room = seatFour(new Room('DEAL-LUCK-RESET', 'short'));
    room.startGame();
    room.roundNumber++;
    room.startRound();
    assert.strictEqual(room.describeDealLuck()['Alice'].rounds.length, 2);

    // What a lobby restart does: roundNumber back to 0, then start again. This
    // is the same signal roundsWonByName and gameStartedAt reset on.
    room.roundNumber = 0;
    room.gameState = 'waiting';
    room.startGame();

    assert.strictEqual(room.describeDealLuck()['Alice'].rounds.length, 1,
        'a rematch that re-counted the last game would report the wrong deals');
});

test('deal ranks never appear in live room state', () => {
    // The leak boundary. rank is derived from all four dealt hands, so anything
    // a client can read mid-round must not carry it -- see the SECURITY note on
    // rankTable. getGameState() is sent on every room_update.
    const room = seatFour(new Room('DEAL-LUCK-LEAK', 'short'));
    room.startGame();

    const serialized = JSON.stringify(room.getGameState());
    assert.ok(!serialized.includes('dealLuck'), 'room state must not carry deal luck');
    assert.ok(!serialized.includes('tierLabel'), 'room state must not carry deal tiers');
    assert.ok(!('dealHistoryByName' in room.getGameState()));
});

test('the game-level headline is a percentile, not a tier label', () => {
    // Measured over 16,000 simulated 12-round player-games: rounding the mean
    // *tier* to a bucket prints "Average" 77% of the time and can never print
    // "Rough" or "Premium" at all, so the line carries no information. The mean
    // percentile over the same games spans p5=35.7 to p95=63.6. Tiers stay the
    // right unit for a single deal, which is what they were built for.
    const room = seatFour(new Room('DEAL-LUCK-PCT', 'short'));
    room.startGame();
    const entry = Object.values(room.describeDealLuck())[0];

    assert.ok(!('avgTier' in entry) && !('avgTierLabel' in entry),
        'a bucketed average is the thing this replaced');
    assert.ok(Number.isInteger(entry.avgPercentile));

    // Each round carries the number the grid prints and the colour it uses.
    for (const r of entry.rounds) {
        assert.ok(r.percentile >= 0 && r.percentile <= 100, 'strength: the number');
        assert.ok(r.rank >= 1 && r.rank <= 4, 'place: the colour');
        assert.ok(typeof r.tierLabel === 'string' && r.tierLabel, 'tier survives per-round for the tooltip');
    }
});

test('a single round reports that round percentile exactly', () => {
    // A one-round game is the case where an average could hide a rounding bug.
    const room = seatFour(new Room('DEAL-LUCK-ONE', 'short'));
    room.startGame();
    for (const entry of Object.values(room.describeDealLuck())) {
        assert.strictEqual(entry.rounds.length, 1);
        // Rounded, because percentileFor's mid-rank convention returns halves
        // and the headline is a whole number. The per-round value stays exact
        // so the mean is not computed from already-rounded parts.
        assert.strictEqual(entry.avgPercentile, Math.round(entry.rounds[0].percentile));
    }
});
