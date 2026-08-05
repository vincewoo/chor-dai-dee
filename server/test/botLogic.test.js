// server/test/botLogic.test.js
//
// Run with:  node --test server/test/
//
// These lock in the behaviours that were previously wrong. Several of them
// would have failed against the pre-review bot.

const test = require('node:test');
const assert = require('node:assert');

const { BotLogic } = require('../game/BotLogic');
const { Big2Rules, HAND_TYPES } = require('../game/Big2Rules');
const { RANKS, SUITS } = require('../game/Deck');
const { playRound, deal, makeRng, measureHighCardLeakage } = require('./botHarness');

const card = (s) => {
    const suit = s.slice(-1), rank = s.slice(0, -1);
    return { rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) };
};
const hand = (str) => str.split(' ').map(card);
const ctx = (over = {}) => Object.assign({
    playerCardCounts: [10, 10, 10],
    passedPlayers: [], passCount: 0, playedCards: [], playHistory: []
}, over);

test('retention cost is convex and orders control cards correctly', () => {
    const cost = (s) => BotLogic.cardRetentionCost(card(s));

    assert.ok(cost('2S') > cost('2D'), '2 of Spades is the most valuable card in the deck');
    assert.ok(cost('2D') > cost('AS'), 'a 2 outranks an Ace');
    assert.ok(cost('AS') > cost('KS'), 'an Ace outranks a King');
    assert.ok(cost('KS') > cost('QS'), 'a King outranks a Queen');

    // Convexity: the gap at the top must dwarf the gap in the middle.
    const topGap = cost('2D') - cost('AD');
    const midGap = cost('9D') - cost('8D');
    assert.ok(topGap > midGap * 10, `top gap ${topGap} should dwarf mid gap ${midGap}`);
});

test('does not answer a low single with a high card when a cheap one is available', () => {
    // The reported bug: bot holds an 8 and answers a 7 with its King.
    const move = BotLogic.getBotMove(
        hand('4S 6C 8H 10C JD KD AH 2C'),
        Big2Rules.validateHand(hand('7D')),
        false, ctx({ playerCardCounts: [8, 8, 8] }), false
    );
    assert.ok(move, 'should play rather than pass');
    assert.strictEqual(move.length, 1);
    assert.ok(!['K', 'A', '2'].includes(move[0].rank),
        `expected a cheap beater, got ${move[0].rank}${move[0].suit}`);
});

test('high-card leakage stays low across hand sizes', () => {
    // Guards against a regression of the anti-hoarding scoping bug, which
    // produced 55-64% leakage at these hand sizes.
    for (const handSize of [13, 11, 9, 7]) {
        const { rate, trials } = measureHighCardLeakage(BotLogic, { handSize, samples: 150 });
        assert.ok(trials > 50, 'enough samples to be meaningful');
        assert.ok(rate < 0.15, `hand=${handSize}: leakage ${(rate * 100).toFixed(0)}% should stay under 15%`);
    }
});

test('capturing reasoning never changes the decision', () => {
    // A single-candidate short circuit used to skip strategic passing, but only
    // when reasoning was NOT being captured - so the debug panel disagreed with
    // live play precisely where it mattered.
    const rng = makeRng(4242);
    for (let i = 0; i < 60; i++) {
        const hands = deal(rng);
        const toBeat = i % 3 === 0 ? null : Big2Rules.validateHand([hands[1][0]]);
        const context = ctx({ playerCardCounts: [hands[1].length, hands[2].length, hands[3].length] });

        const plain = BotLogic.getBotMove(hands[0], toBeat, false, ctx(context), false);
        const withReasoning = BotLogic.getBotMove(hands[0], toBeat, false, ctx(context), true);

        const a = plain ? plain.map(c => c.rank + c.suit).sort().join(' ') : 'PASS';
        const b = withReasoning.cards ? withReasoning.cards.map(c => c.rank + c.suit).sort().join(' ') : 'PASS';
        assert.strictEqual(a, b, `decision diverged on iteration ${i}`);
    }
});

test('will not spend its only 2 of Spades to beat a low single', () => {
    // 2S is the only legal response here, so this also covers the case where a
    // single-candidate fast path used to bypass the price rule entirely.
    const move = BotLogic.getBotMove(
        hand('2S 3D 4C 5H 6D 7C 8H'),
        Big2Rules.validateHand(hand('9D')),
        false, ctx({ playerCardCounts: [11, 11, 11] }), false
    );
    assert.strictEqual(move, null, 'should pass rather than burn the 2S on a 9');
});

test('does spend the 2 of Spades when the next player is about to go out', () => {
    const move = BotLogic.getBotMove(
        hand('2S 3D 4C 5H 6D 7C 8H'),
        Big2Rules.validateHand(hand('9D')),
        false, ctx({ playerCardCounts: [1, 8, 8] }), false
    );
    assert.ok(move, 'must contest when the next player has one card');
    assert.strictEqual(move[0].rank, '2');
});

// --- the highest-single endgame rule ---------------------------------------
// A legality constraint, not a preference: with the next player on one card, a
// single must be your highest card. It is enforced in legalCandidates, which is
// the one gate every bot passes through -- the heuristic here, and through
// MoveQuality.rankOptions the PPO actor and its persona overlays too. None of
// them generate moves, so filtering the list is what makes them all comply.

test('the highest-single rule leaves only the highest single, and only singles', () => {
    const myHand = hand('4S 6C 8H 10C JD KD AH 2C');
    const all = BotLogic.getAllValidMoves(myHand).filter(Boolean);

    // Next player comfortable: the rule is off, every single is available.
    const relaxed = BotLogic.legalCandidates(all, null, false, [8, 8, 8]);
    const relaxedSingles = relaxed.filter(m => m.type === HAND_TYPES.SINGLE);
    assert.strictEqual(relaxedSingles.length, myHand.length);

    // Next player on one card: exactly one single survives, and it is the 2C.
    const restricted = BotLogic.legalCandidates(all, null, false, [1, 8, 8]);
    const singles = restricted.filter(m => m.type === HAND_TYPES.SINGLE);
    assert.strictEqual(singles.length, 1);
    assert.strictEqual(singles[0].cards[0].rank, '2');

    // Everything that is not a single is untouched. The rule constrains which
    // single you may play, never which shape.
    const nonSingles = (moves) => moves.filter(m => m.type !== HAND_TYPES.SINGLE).length;
    assert.strictEqual(nonSingles(restricted), nonSingles(relaxed));
});

test('the rule fires on the next seat only, not on any opponent at one card', () => {
    const myHand = hand('4S 6C 8H 10C JD KD AH 2C');
    const all = BotLogic.getAllValidMoves(myHand).filter(Boolean);
    const singles = (counts) => BotLogic
        .legalCandidates(all, null, false, counts)
        .filter(m => m.type === HAND_TYPES.SINGLE).length;

    assert.strictEqual(singles([1, 8, 8]), 1, 'next player on one card restricts');
    assert.strictEqual(singles([8, 1, 8]), myHand.length, 'across does not');
    assert.strictEqual(singles([8, 8, 1]), myHand.length, 'previous does not');
});

test('the bot answers a single with its highest card when the next player is out in one', () => {
    // Without the rule the cost model answers a 7 with the cheapest sufficient
    // card. The rule overrides that, and the bot cannot do otherwise: the
    // cheaper answers are no longer in the list it picks from.
    const move = BotLogic.getBotMove(
        hand('4S 6C 8H 10C JD KD AH 2C'),
        Big2Rules.validateHand(hand('7D')),
        false, ctx({ playerCardCounts: [1, 8, 8] }), false
    );

    assert.ok(move, 'must not pass - the pass would hand over the round');
    assert.strictEqual(move.length, 1);
    assert.strictEqual(move[0].rank, '2');
});

test('omitting card counts leaves candidate enumeration unrestricted', () => {
    // The pre-rule callers and the pure enumeration tests pass no counts. That
    // has to keep meaning "no rule", or every one of them changes meaning.
    const myHand = hand('4S 6C 8H 10C JD KD AH 2C');
    const all = BotLogic.getAllValidMoves(myHand).filter(Boolean);
    assert.deepStrictEqual(
        BotLogic.legalCandidates(all, null, false),
        BotLogic.legalCandidates(all, null, false, null)
    );
});

// --- why the block emergency is next-player-only ---------------------------
// selectBestMove overrides the cost model on playerCardCounts[0] === 1 and
// nothing else, which reads like it is ignoring the other two opponents. It is
// not: it is the exact set of positions where our pass ends the trick. This
// test pins the seating fact the branch rests on, because the branch is only
// correct for as long as it holds -- a rules change to turn order or to when
// the pass set clears would silently invalidate it.
//
// Extending the branch to every opponent on one card was measured at -4.8pp of
// win rate. See docs/BOT-HEURISTICS-REVIEW.md section 15.

test('we are the last line of defence exactly when the next player holds the pile', () => {
    const seats = [0, 1, 2, 3].map(i => ({ name: `Bot ${i + 1}`, logic: BotLogic }));
    const rng = makeRng(4242);

    const tally = { 1: { seen: 0, lastToAct: 0 }, 2: { seen: 0, lastToAct: 0 }, 3: { seen: 0, lastToAct: 0 } };

    const original = BotLogic.selectBestMove;
    BotLogic.selectBestMove = function (candidates, hand, lastPlayedHand, isFirstTurn, ctx = {}, capture = false) {
        const owner = ctx.lastPlayedByRelative;
        if (owner >= 1 && owner <= 3) {
            tally[owner].seen++;
            // Our pass ends the trick only if both opponents who are not
            // holding the pile have already passed.
            const others = [1, 2, 3].filter(x => x !== owner);
            if (others.every(x => (ctx.passedPlayers || []).includes(x - 1))) {
                tally[owner].lastToAct++;
            }
        }
        return original.call(this, candidates, hand, lastPlayedHand, isFirstTurn, ctx, capture);
    };

    try {
        for (let r = 0; r < 200; r++) playRound(seats, deal(rng), null);
    } finally {
        BotLogic.selectBestMove = original;
    }

    assert.ok(tally[1].seen > 0 && tally[2].seen + tally[3].seen > 0, 'fixture covered both cases');

    // Next player holds the pile: across and previous sit between them and us,
    // so both have necessarily acted -- and passed, or the pile would be theirs.
    assert.strictEqual(tally[1].lastToAct, tally[1].seen,
        'with the next player on the pile we are always the last to act');

    // Across or previous holds it: the next player still acts after us, so our
    // pass can never be the one that ends the trick.
    assert.strictEqual(tally[2].lastToAct, 0, 'across on the pile - next player still to act');
    assert.strictEqual(tally[3].lastToAct, 0, 'previous on the pile - next player still to act');
});

test('isUnbeatable only claims a forced result', () => {
    const all = [];
    for (const r of RANKS) for (const s of SUITS) all.push(card(`${r}${s}`));

    // 2S with nothing else outstanding.
    assert.strictEqual(
        BotLogic.isUnbeatable(Big2Rules.validateHand([card('2S')]), [card('2S')], []),
        true, '2S is unbeatable as a single');

    // An Ace is beatable while 2s are unaccounted for.
    assert.strictEqual(
        BotLogic.isUnbeatable(Big2Rules.validateHand([card('AS')]), [card('AS')], []),
        false, 'an Ace loses to an outstanding 2');

    // An Ace is unbeatable once every 2 has been played.
    const twosPlayed = ['2D', '2C', '2H', '2S'].map(card);
    assert.strictEqual(
        BotLogic.isUnbeatable(Big2Rules.validateHand([card('AS')]), [card('AS')], twosPlayed),
        true, 'an Ace is unbeatable when all four 2s are gone');
});

test('opponent inference reads the whole round, not just the live pile', () => {
    // Two opponents declined to beat an 8. That is a real read, and it has to
    // survive into the next trick where we are choosing a lead.
    const eight = Big2Rules.validateHand(hand('8D'));
    const models = BotLogic.buildOpponentModels([
        { relative: 1, action: 'pass', hand: eight },
        { relative: 2, action: 'pass', hand: eight },
        { relative: 3, action: 'pass', hand: eight }
    ], [8, 8, 8], hand('3D 4D'), []);

    const inference = BotLogic.inferFromHistory(models);
    assert.strictEqual(inference.opponentsWeakInSingles, true);
    assert.ok(inference.confidence > 0.5);
    assert.strictEqual(inference.singlesCeiling, RANKS.indexOf('8'));
});

test('a demonstrated strategic pass invalidates the read', () => {
    const eight = Big2Rules.validateHand(hand('8D'));
    const king = Big2Rules.validateHand(hand('KD'));

    // They passed on an 8 and later played a King - they were holding out.
    const models = BotLogic.buildOpponentModels([
        { relative: 1, action: 'pass', hand: eight },
        { relative: 1, action: 'play', hand: king },
        { relative: 2, action: 'pass', hand: eight },
        { relative: 3, action: 'pass', hand: eight }
    ], [8, 8, 8], hand('3D 4D'), []);

    assert.strictEqual(models[0].strategicPasser, true);
    assert.strictEqual(BotLogic.inferFromHistory(models).singlesCeiling, null,
        'ceiling must not be claimed once an opponent has shown they hold back');
});

test('bot profiles differ between bots but are stable for one bot', () => {
    const a = BotLogic.getBotProfile('Bot Alpha');
    const b = BotLogic.getBotProfile('Bot Beta');
    assert.deepStrictEqual(a, BotLogic.getBotProfile('Bot Alpha'), 'same name gives the same profile');
    assert.notDeepStrictEqual(a, b, 'different names give different profiles');

    // The names actually used in a room differ by one low-order character.
    // Without avalanche mixing in the hash these all collapse to one profile.
    const table = ['Bot 1', 'Bot 2', 'Bot 3', 'Bot 4'].map(BotLogic.getBotProfile);
    for (const key of ['variability', 'patience', 'aggression']) {
        const values = table.map(p => p[key]);
        const range = Math.max(...values) - Math.min(...values);
        assert.ok(range > 0.05,
            `${key} must differ across the default bot names (range ${range.toFixed(3)})`);
    }

    for (const p of [a, b]) {
        assert.ok(p.variability >= 0.4 && p.variability <= 1.3);
        assert.ok(p.patience >= 0.8 && p.patience <= 1.25);
        assert.ok(p.aggression >= 0.85 && p.aggression <= 1.2);
    }
});

test('decisions are deterministic without a profile', () => {
    const results = new Set();
    for (let i = 0; i < 8; i++) {
        const move = BotLogic.getBotMove(hand('3D 5C 7H 9S 10D JH QC KD AS'), null, false, ctx(), false);
        results.add(move.map(c => c.rank + c.suit).join(' '));
    }
    assert.strictEqual(results.size, 1, 'argmax selection must be stable');
});

test('a profile introduces variation without picking bad moves', () => {
    const rng = makeRng(11);
    const results = new Set();
    const profile = { variability: 1.3, patience: 1, aggression: 1 };
    for (let i = 0; i < 40; i++) {
        const move = BotLogic.getBotMove(hand('3D 5C 7H 9S 10D JH QC KD AS'), null, false,
            ctx({ profile, rng }), false);
        results.add(move.map(c => c.rank + c.suit).join(' '));
        // Variation may reach a control card inside a five-card hand (a
        // 10-J-Q-K-A straight is a fine lead), but must never throw one away
        // as a bare single.
        assert.ok(!(move.length === 1 && ['A', '2'].includes(move[0].rank)),
            `variation must not lead a bare control card, got ${move.map(c => c.rank + c.suit).join(' ')}`);
    }
    assert.ok(results.size > 1, 'a profile should produce more than one line of play');
});

test('full self-play rounds produce only legal moves', () => {
    // playRound throws on any illegal play, unbeatable pile violation, or an
    // opening that omits the 3 of Diamonds.
    const rng = makeRng(2024);
    const seats = [0, 1, 2, 3].map(i => ({ name: `bot${i}`, logic: BotLogic }));
    for (let i = 0; i < 150; i++) {
        const result = playRound(seats, deal(rng), null);
        assert.ok(result.cardsLeft.some(n => n === 0), 'someone must go out');
        assert.strictEqual(result.cardsLeft.filter(n => n === 0).length, 1, 'exactly one winner');
    }
});

test('bots still win tricks - the price rule has not made them passive', () => {
    const rng = makeRng(77);
    const seats = [0, 1, 2, 3].map(i => ({ name: `bot${i}`, logic: BotLogic }));
    let totalCardsLeft = 0, rounds = 60;
    for (let i = 0; i < rounds; i++) {
        totalCardsLeft += playRound(seats, deal(rng), null).cardsLeft.reduce((a, b) => a + b, 0);
    }
    const avgPerPlayer = totalCardsLeft / (rounds * 4);
    assert.ok(avgPerPlayer < 5, `average cards left ${avgPerPlayer.toFixed(2)} suggests bots are stalling`);
});

// --- Penalty-tier awareness ------------------------------------------------
// Round points count cards, not ranks, and the 10-card (2x) and 13-card (3x)
// boundaries make the cards straddling them worth several times face value.
// The rule only applies in rounds we cannot win, so the gate matters as much
// as the bonus.

test('penalty multiplier matches the round scoring tiers', () => {
    // Must agree with Scoring.js: 1-9 = 1x, 10-12 = 2x, 13 = 3x.
    for (const size of [0, 1, 5, 9]) assert.strictEqual(BotLogic.penaltyMultiplier(size), 1, `size ${size}`);
    for (const size of [10, 11, 12]) assert.strictEqual(BotLogic.penaltyMultiplier(size), 2, `size ${size}`);
    assert.strictEqual(BotLogic.penaltyMultiplier(13), 3);
});

test('roundLostness is zero while we are still racing', () => {
    const h = hand('3D 4C 5H 6S 7D');
    // Everyone even.
    assert.strictEqual(BotLogic.roundLostness(h, ctx({ playerCardCounts: [5, 5, 5] })), 0);
    // We are ahead.
    assert.strictEqual(BotLogic.roundLostness(h, ctx({ playerCardCounts: [9, 9, 9] })), 0);
    // Opponents are far from out, so being behind does not matter yet.
    const big = hand('3D 4C 5H 6S 7D 8C 9H 10S JD QC KH');
    assert.strictEqual(BotLogic.roundLostness(big, ctx({ playerCardCounts: [11, 12, 13] })), 0);
});

test('roundLostness rises as we fall behind a player who is nearly out', () => {
    const big = hand('3D 4C 5H 6S 7D 8C 9H 10S JD QC KH');
    const nearlyLost = BotLogic.roundLostness(big, ctx({ playerCardCounts: [1, 8, 9] }));
    const partly = BotLogic.roundLostness(big, ctx({ playerCardCounts: [5, 8, 9] }));
    assert.ok(nearlyLost > partly, `${nearlyLost} should exceed ${partly}`);
    assert.ok(nearlyLost > 0.9, `an 11-card hand against an opponent on 1 is lost: ${nearlyLost}`);
    assert.ok(nearlyLost <= 1 && partly >= 0, 'must stay within 0..1');
});

test('penalty tier value only pays for actually crossing a boundary', () => {
    const lostCtx = ctx({ playerCardCounts: [1, 8, 9] });
    const ten = hand('3D 4C 5H 6S 7D 8C 9H 10S JD QC');   // 10 cards, at the 2x tier
    const single = Big2Rules.validateHand([card('3D')]);

    // 10 -> 9 escapes the 2x multiplier and is worth real points.
    assert.ok(BotLogic.penaltyTierValue(single, ten, lostCtx) > 0);

    // The same play from 9 cards crosses nothing.
    const nine = hand('3D 4C 5H 6S 7D 8C 9H 10S JD');
    assert.strictEqual(BotLogic.penaltyTierValue(single, nine, lostCtx), 0);
});

test('penalty tier value is gated on the round being lost', () => {
    const ten = hand('3D 4C 5H 6S 7D 8C 9H 10S JD QC');
    const single = Big2Rules.validateHand([card('3D')]);

    // Identical crossing, but the round is still live - no bonus, so the bot
    // is never tempted to dump a hand to duck a penalty it may not pay.
    assert.strictEqual(BotLogic.penaltyTierValue(single, ten, ctx({ playerCardCounts: [10, 11, 12] })), 0);
    assert.ok(BotLogic.penaltyTierValue(single, ten, ctx({ playerCardCounts: [1, 8, 9] })) > 0);
});

test('a buried bot sheds volume rather than protecting its high cards', () => {
    // 11 cards against an opponent on one: the round is gone, so the only
    // thing that matters is getting under 10 cards. Leading a five-card hand
    // does that; leading a single 3 does not.
    const buried = hand('3D 4D 5D 6D 7D 8C 9H 10S JC QH 2S');
    const move = BotLogic.getBotMove(buried, null, false, ctx({ playerCardCounts: [1, 9, 10] }), false);
    assert.ok(move.length >= 5, `expected a volume play, got ${move.map(c => c.rank + c.suit).join(' ')}`);
});

// --- 2s inside combinations ------------------------------------------------
// COST_WEIGHT_BY_SIZE discounts cards in a five-card hand on the premise that
// they are unavailable as standalone control. A 2 is the one card for which
// that is provably false, and the bot was dumping 2s in full houses because
// of it.

test('spending a 2 inside a five-card hand is surcharged, low cards are not', () => {
    const h = hand('2S 2H 2C 3D 3C 5H 7S 9D JC');
    const live = ctx({ playerCardCounts: [9, 9, 9] });
    const fullHouseOfTwos = Big2Rules.validateHand(hand('2S 2H 2C 3D 3C'));

    assert.ok(BotLogic.standaloneControlSurcharge(fullHouseOfTwos, h, live, 'early') > 0,
        'a full house built on 2s should be charged for the 2s it spends');

    // A five-card hand with no 2 in it is untouched.
    const lowHand = hand('3D 4C 5H 6S 7D 9C JH');
    const straight = Big2Rules.validateHand(hand('3D 4C 5H 6S 7D'));
    assert.strictEqual(BotLogic.standaloneControlSurcharge(straight, lowHand, live, 'early'), 0);
});

test('a single 2 carries no surcharge - nothing is being discounted', () => {
    const h = hand('2S 5H 7S 9D JC');
    const single = Big2Rules.validateHand([card('2S')]);
    // COST_WEIGHT_BY_SIZE[1] is 1.0, so there is no discount to charge back.
    assert.strictEqual(
        BotLogic.standaloneControlSurcharge(single, h, ctx({ playerCardCounts: [5, 5, 5] }), 'early'), 0);
});

test('the surcharge lifts once the round is lost', () => {
    const h = hand('2S 2H 2C 3D 3C 5H 7S 9D JC 10C 4D');
    const fullHouse = Big2Rules.validateHand(hand('2S 2H 2C 3D 3C'));

    // Still racing: keep the 2s back.
    assert.ok(BotLogic.standaloneControlSurcharge(fullHouse, h, ctx({ playerCardCounts: [10, 11, 11] }), 'early') > 0);

    // Round is gone: points count cards, so dumping five at once is correct
    // and the surcharge must not stand in the way.
    assert.strictEqual(
        BotLogic.standaloneControlSurcharge(fullHouse, h, ctx({ playerCardCounts: [1, 9, 10] }), 'early'), 0);
});

test('bots burn far fewer 2s inside five-card hands than they used to', () => {
    // Regression guard on the reported behaviour. Was 23.5% before the
    // surcharge; anything back near that means the rule has stopped biting.
    const rng = makeRng(4321);
    let inCombo = 0, alone = 0;
    const watcher = {
        getBotMove(...args) {
            const move = BotLogic.getBotMove(...args);
            if (move && move.length === 5) inCombo += move.filter(c => c.rank === '2').length;
            else if (move && move.length) alone += move.filter(c => c.rank === '2').length;
            return move;
        }
    };
    const seats = [0, 1, 2, 3].map(() => ({ name: 'w', logic: watcher }));
    for (let r = 0; r < 400; r++) playRound(seats, deal(rng), null);

    const burned = inCombo / (inCombo + alone) * 100;
    assert.ok(burned < 18, `${burned.toFixed(1)}% of 2s spent inside five-card hands (was 23.5%)`);
});

test('a full house is never built by breaking a second triple', () => {
    // Reported from a live table: holding 444 and 888, the coach recommended
    // the full house 8s-over-4s, which dismantles the 444 and orphans the 4S.
    const h = hand('3S 4D 4C 4S 6H 7H 8D 8C 8S KH KS');
    const org = BotLogic.organizeHand(h);

    for (const combo of org.fiveCardHands) {
        if (combo.type !== HAND_TYPES.FULL_HOUSE) continue;
        const tripleRank = combo.cards[2].rank;
        const pairRank = combo.cards[0].rank === tripleRank ? combo.cards[4].rank : combo.cards[0].rank;
        const heldOfPairRank = h.filter(c => c.rank === pairRank).length;
        assert.notStrictEqual(heldOfPairRank, 3,
            `full house ${combo.cards.map(c => c.rank + c.suit).join(' ')} borrows its pair from a triple`);
    }

    // The 444 survives as a triple in its own right.
    assert.ok(org.triples.some(t => t.rank === '4'), 'the triple of 4s should still be organized as a triple');
});

test('two triples and nothing else stay two triples', () => {
    const org = BotLogic.organizeHand(hand('5D 5C 5H 9D 9C 9H'));
    assert.strictEqual(org.fiveCardHands.length, 0, 'no five-card hand can be built without breaking a triple');
    assert.deepStrictEqual(org.triples.map(t => t.rank).sort(), ['5', '9']);
});

test('a full house drawing its pair from a real pair is still preserved', () => {
    // The rule must only block borrowing from a TRIPLE, not full houses generally.
    const org = BotLogic.organizeHand(hand('8D 8C 8S KH KS 3S 6H'));
    assert.strictEqual(org.fiveCardHands.length, 1);
    assert.strictEqual(org.fiveCardHands[0].type, HAND_TYPES.FULL_HOUSE);
    assert.strictEqual(org.triples.length, 0, 'the 888 is spent inside the full house, not left over');
});

test('leading a triple intact is not charged for breaking a combination', () => {
    // The circular penalty: the organizer built a full house out of a triple,
    // then comboBreakPenalty charged the intact triple for destroying it.
    const h = hand('3S 4D 4C 4S 6H 7H 8D 8C 8S KH KS');
    const org = BotLogic.organizeHand(h);
    const triple4s = Big2Rules.validateHand(hand('4D 4C 4S'));

    assert.strictEqual(BotLogic.comboBreakPenalty(triple4s, org, 'early'), 0,
        'a triple that is played whole breaks nothing');
});

test('organizeHand always reports triples as an array', () => {
    // It used to be created lazily and left undefined, so every consumer had
    // to remember `|| []`.
    assert.deepStrictEqual(BotLogic.organizeHand(hand('3S 5H 9D')).triples, []);
});

test('a triple left behind is worth more than a pair left behind', () => {
    // evaluateFollowUp counted pairs and five-card hands but not triples, so a
    // remainder of 4D 4C 4S scored below a remainder of 4D 4C.
    const single = { type: HAND_TYPES.SINGLE, cards: [card('9S')] };
    const withPair = hand('9S 4D 4C');
    const withTriple = hand('9S 4D 4C 4S');

    const pairScore = BotLogic.evaluateFollowUp(
        single, withPair, BotLogic.organizeHand(withPair)).followUpScore;
    const tripleScore = BotLogic.evaluateFollowUp(
        single, withTriple, BotLogic.organizeHand(withTriple)).followUpScore;

    assert.ok(tripleScore > pairScore,
        `leaving a triple (${tripleScore}) should beat leaving a pair (${pairScore})`);
});
