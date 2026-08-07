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
// Room.describeRoundReview() is the only thing that ever shows a player anything
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

    const luck = room.describeRoundReview();

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

    const ranks = Object.values(room.describeRoundReview())
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
    assert.strictEqual(room.describeRoundReview()['Alice'].rounds.length, 2);

    // What a lobby restart does: roundNumber back to 0, then start again. This
    // is the same signal roundsWonByName and gameStartedAt reset on.
    room.roundNumber = 0;
    room.gameState = 'waiting';
    room.startGame();

    assert.strictEqual(room.describeRoundReview()['Alice'].rounds.length, 1,
        'a rematch that re-counted the last game would report the wrong deals');
});

test('deal ranks never appear in live room state', () => {
    // The leak boundary. rank is derived from all four dealt hands, so anything
    // a client can read mid-round must not carry it -- see the SECURITY note on
    // rankTable. getGameState() is sent on every room_update.
    const room = seatFour(new Room('DEAL-LUCK-LEAK', 'short'));
    room.startGame();

    const serialized = JSON.stringify(room.getGameState());
    assert.ok(!serialized.includes('roundReview'), 'room state must not carry the round review');
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
    const entry = Object.values(room.describeRoundReview())[0];

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
    for (const entry of Object.values(room.describeRoundReview())) {
        assert.strictEqual(entry.rounds.length, 1);
        // Rounded, because percentileFor's mid-rank convention returns halves
        // and the headline is a whole number. The per-round value stays exact
        // so the mean is not computed from already-rounded parts.
        assert.strictEqual(entry.avgPercentile, Math.round(entry.rounds[0].percentile));
    }
});

test('deal strength is ranked across the game, ties sharing the better rank', () => {
    // The standings row prints this instead of the finishing place, which the
    // left gutter already shows. Ranked server-side so the tie convention
    // matches rankTable's rather than being reinvented on the client.
    const room = seatFour(new Room('DEAL-RANK', 'short'));
    room.startGame();
    room.roundNumber++; room.startRound();

    const luck = room.describeRoundReview();
    const entries = Object.values(luck);
    const ranks = entries.map(e => e.dealRank).sort();

    assert.strictEqual(ranks.length, 4);
    assert.strictEqual(ranks[0], 1, 'somebody got the best cards over the game');
    for (const r of ranks) assert.ok(r >= 1 && r <= 4);

    // Better mean percentile must never rank worse.
    const byRank = entries.slice().sort((a, b) => a.dealRank - b.dealRank);
    for (let i = 1; i < byRank.length; i++) {
        assert.ok(byRank[i - 1].avgPercentile >= byRank[i].avgPercentile,
            'ranking must follow the percentiles it is derived from');
    }
    // The unrounded mean is an implementation detail of the ordering.
    for (const e of entries) assert.ok(!('mean' in e));
});

test('the review records what each round actually cost', () => {
    // The table is primarily a scoreboard; deal strength is the context under
    // it. Points are filled in at round end by updateScores, matched on the
    // round number rather than by position, so a score for a round that was
    // never dealt cannot land on another round's row.
    const { calculateRoundScores } = require('../game/Scoring');
    const room = seatFour(new Room('ROUND-REVIEW-PTS', 'short'));
    room.startGame();

    // Alice sheds everything; the bots keep full hands (13 cards => 3x).
    room.players[0].hand = [];
    room.updateScores(calculateRoundScores(room.players[0], room.players));

    const review = room.describeRoundReview();
    const alice = review['Alice'];
    assert.strictEqual(alice.rounds[0].points, 0);
    assert.strictEqual(alice.rounds[0].won, true);
    assert.strictEqual(alice.totalPoints, 0);
    assert.strictEqual(alice.roundsWon, 1);

    for (const name of ['Bot Ada', 'Bot Bea', 'Bot Cy']) {
        const e = review[name];
        assert.strictEqual(e.rounds[0].won, false);
        assert.ok(e.rounds[0].points > 0, 'a full hand costs points');
        assert.strictEqual(e.totalPoints, e.rounds[0].points);
        assert.strictEqual(e.roundsWon, 0);
    }

    // Exactly one winner per round.
    assert.strictEqual(Object.values(review).filter(e => e.rounds[0].won).length, 1);
});

test('a dealt but unscored round stays null rather than zero', () => {
    // Zero is the winner's score. Defaulting an unfinished round to it would
    // invent a win on the game-over screen, so the client renders a dash.
    const room = seatFour(new Room('ROUND-REVIEW-NULL', 'short'));
    room.startGame();

    const entry = Object.values(room.describeRoundReview())[0];
    assert.strictEqual(entry.rounds[0].points, null);
    assert.strictEqual(entry.rounds[0].won, false);
    // ...and an unscored round contributes nothing to the total.
    assert.strictEqual(entry.totalPoints, 0);
});

test('deal strength ranks exactly the seats on the game-over screen', () => {
    // Keying the accumulator on name let a mid-game join or a walkout leave
    // orphaned entries behind, and ranking those produced "Deal strength: 5th"
    // at a four-seat table with a gap where a player nobody could see took a
    // place. Seat keying means only seats exist to rank.
    const room = seatFour(new Room('DEAL-RANK-ORPHAN', 'short'));
    room.startGame();
    room.roundNumber++; room.startRound();

    // Somebody joins mid-game into a seat that was held by another name.
    const departed = room.players[1].name;
    room.players[1] = { id: 'c1', name: 'Charlie', isBot: false, hand: [], joinedMidGame: true };
    room.roundNumber++; room.startRound();

    const review = room.describeRoundReview();
    assert.strictEqual(Object.keys(review).length, 4, 'one entry per seat, never per name');
    assert.ok(!(departed in review), 'a name that no longer holds a seat is not a row');

    const seated = room.players.map(p => review[p.name].dealRank);
    assert.deepStrictEqual([...seated].sort(), [1, 2, 3, 4],
        'the four seats on screen must rank 1-4 with no gaps');

    // The ordering scratch value must never reach the client.
    for (const e of Object.values(review)) assert.ok(!('mean' in e));
});

test('a seat keeps one history when its player walks out mid-game', () => {
    // replaceWithBot renames the seat to `Bot (Alice)`. Keyed by name that
    // split one seat across two entries and dropped the human's own rounds out
    // of their average, while the standings row -- named off the live player --
    // showed only the post-swap rounds. The seat is the continuous thing here:
    // cumulativeScores is already carried across the same handover.
    const room = seatFour(new Room('SEAT-CONTINUITY', 'short'));
    room.startGame();
    room.roundNumber++; room.startRound();

    const before = room.describeRoundReview()['Alice'].rounds.length;
    assert.strictEqual(before, 2);

    // The walkout: same seat, new name.
    room.players[0].name = 'Bot (Alice)';
    room.players[0].isBot = true;
    room.roundNumber++; room.startRound();

    const review = room.describeRoundReview();
    assert.strictEqual(Object.keys(review).length, 4, 'still one entry per seat');
    assert.ok(!('Alice' in review), 'the old name is not a second row');
    assert.strictEqual(review['Bot (Alice)'].rounds.length, 3,
        'the seat keeps the rounds it played under its previous name');
});

test('the dragon deal is not treated as the strongest possible hand', () => {
    // The dragon_win payload used to claim rank 1 "by definition". It is not:
    // thirteen distinct ranks is thirteen plays to shed, so it scores as merely
    // Strong. The instant-win rule and the deal metric measure different things.
    const dragon = RANKS.map((r, i) => card(r, SUITS[i % 4]));
    const d = calculateDealStrength(dragon);
    assert.strictEqual(d.tierKey, 'strong');
    assert.ok(d.percentile < 100, 'a dragon does not top the deal distribution');

    const stacked = hand('2S', '2H', '2C', '2D', 'AS', 'AH', 'AC', 'AD', 'KS', 'KH', 'KC', 'KD', 'QS');
    assert.ok(calculateDealStrength(stacked).raw > d.raw,
        'a hand full of control out-scores the dragon on this metric');
});

test('a player named after an Object.prototype key still gets a row', () => {
    // validateUsername accepts `__proto__`, `constructor`, `toString` and
    // friends -- 3-20 chars of [A-Za-z0-9_], with only `guest_` reserved -- so
    // these are registrable names, not hypotheticals. On a plain object the
    // review's key assignment would set the prototype instead of an own
    // property and the player would silently vanish from the game-over screen.
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
        const room = new Room(`PROTO-${name}`, 'short');
        room.addPlayer({ id: 'p1', name, isBot: false });
        ['Bot 2', 'Bot 3', 'Bot 4'].forEach((n, i) =>
            room.addPlayer({ id: `b${i}`, name: n, isBot: true }));
        room.startGame();

        // Checked through the wire, which is where a prototype-valued key is lost.
        const onTheWire = JSON.parse(JSON.stringify(room.describeRoundReview()));
        assert.ok(Object.prototype.hasOwnProperty.call(onTheWire, name),
            `"${name}" must be a row of its own`);
        assert.strictEqual(onTheWire[name].rounds.length, 1);
        assert.strictEqual(Object.keys(onTheWire).length, 4, `"${name}" table has four seats`);
        assert.ok(onTheWire[name].dealRank >= 1 && onTheWire[name].dealRank <= 4);
    }
});

test('tied game-long deal strength shares the better rank', () => {
    // The tie branch reads the previous entry's unrounded mean, so deleting
    // that scratch value inside the ranking loop made the branch unreachable.
    // Ties are rare per game but routine in short ones.
    const room = seatFour(new Room('DEAL-RANK-TIE', 'short'));
    room.startGame();
    const names = Object.keys(room.describeRoundReview());

    // Force an exact tie, then re-rank through the real code path.
    room.roundHistoryBySeat[1] = room.roundHistoryBySeat[0].map(r => ({ ...r }));
    const tied = room.describeRoundReview();
    assert.strictEqual(tied[names[0]].avgPercentile, tied[names[1]].avgPercentile);
    assert.strictEqual(tied[names[0]].dealRank, tied[names[1]].dealRank,
        'equal deals must share a rank rather than be ordered arbitrarily');
});
