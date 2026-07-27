// server/test/coach.test.js
//
// The coach is a voice on top of MoveQuality and MoveReview, so what is pinned
// here is the seam rather than any particular wording:
//
//   - the default hint is the top of the same ranked list a move is graded
//     inside; a confidence-gated policy advisor is tested as an explicit seam;
//   - a note is only ever said where MoveReview would say it after the game;
//   - nothing the coach says names a suit, because the Pusoy Dos lens remaps
//     suits per viewer and a server-side suit name would be wrong for half the
//     table.

const test = require('node:test');
const assert = require('node:assert');

const Coach = require('../game/Coach');
const { evaluateMove, rankOptions } = require('../game/MoveQuality');
const { Big2Rules } = require('../game/Big2Rules');
const { RANKS, SUITS } = require('../game/Deck');

const card = (rank, suit) => ({
    rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit)
});

/** Build a hand from "rank+suit" shorthand, e.g. hand('3D', 'KS'). */
const hand = (...codes) => codes.map(code => {
    const suit = code.slice(-1);
    return card(code.slice(0, -1), suit);
});

/** A validated pile, as RoomManager would hold it. */
const pile = (...codes) => Big2Rules.validateHand(hand(...codes));

const context = (opponentCounts = [8, 8, 8]) => ({
    playerCardCounts: opponentCounts,
    passedPlayers: [],
    passCount: 0,
    playedCards: [],
    playHistory: [],
    profile: null
});

const key = (cards) => cards.map(c => `${c.rank}${c.suit}`).sort().join(',');

// ---------------------------------------------------------------------------
// The hint is the top of the ranking
// ---------------------------------------------------------------------------

test('a hint is exactly the move the grader would rank first', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const gameContext = context();

    const suggestion = Coach.suggest({ hand: myHand, lastPlayedHand: null, gameContext });
    const { options } = rankOptions({ hand: myHand, lastPlayedHand: null, gameContext });

    assert.strictEqual(suggestion.action, 'play');
    assert.strictEqual(key(suggestion.cards), key(options[0].move.cards));
});

test('a hint never suggests a move the grader would then call a mistake', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const gameContext = context();
    const suggestion = Coach.suggest({ hand: myHand, lastPlayedHand: null, gameContext });

    const graded = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext,
        action: 'play', cards: suggestion.cards
    });

    assert.strictEqual(graded.rank, 1);
    assert.strictEqual(graded.quality, 'optimal');
});

test('a confident policy advisor can select a different legal hint', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const gameContext = context();
    const { options } = rankOptions({
        hand: myHand, lastPlayedHand: null, gameContext
    });
    const alternative = options[1];
    const suggestion = Coach.suggest({
        hand: myHand,
        lastPlayedHand: null,
        gameContext,
        policyAdvisor: {
            minMargin: 0.5,
            advise: () => ({
                key: alternative.key,
                forced: false,
                guardFallback: false,
                policyMargin: 1.2,
                probability: 0.8,
                policyRef: 'test-policy.json'
            })
        }
    });

    assert.strictEqual(suggestion.source, 'ppo');
    assert.strictEqual(key(suggestion.cards), alternative.key);
    assert.match(suggestion.detail, /learned policy/i);
    assert.strictEqual(suggestion.policyRef, 'test-policy.json');
    assert.doesNotMatch(
        `${suggestion.headline} ${suggestion.detail}`, SUIT_MENTION);
});

test('a low-margin policy hint falls back to deterministic coaching', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const gameContext = context();
    const { options } = rankOptions({
        hand: myHand, lastPlayedHand: null, gameContext
    });
    const suggestion = Coach.suggest({
        hand: myHand,
        lastPlayedHand: null,
        gameContext,
        policyAdvisor: {
            minMargin: 0.5,
            advise: () => ({
                key: options[1].key,
                forced: false,
                guardFallback: false,
                policyMargin: 0.1,
                probability: 0.4,
                policyRef: 'test-policy.json'
            })
        }
    });

    assert.strictEqual(suggestion.source, 'move_quality');
    assert.strictEqual(suggestion.fallbackReason, 'low_margin');
    assert.strictEqual(key(suggestion.cards), options[0].key);
});

test('policy agreement preserves the deterministic factual explanation', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const gameContext = context();
    const deterministic = Coach.suggest({
        hand: myHand, lastPlayedHand: null, gameContext
    });
    const suggestion = Coach.suggest({
        hand: myHand,
        lastPlayedHand: null,
        gameContext,
        policyAdvisor: {
            minMargin: 2,
            advise: () => ({
                key: key(deterministic.cards),
                forced: false,
                guardFallback: false,
                policyMargin: 8,
                probability: 0.99,
                policyRef: 'test-policy.json'
            })
        }
    });

    assert.strictEqual(suggestion.source, 'move_quality');
    assert.strictEqual(suggestion.policyAgreed, true);
    assert.strictEqual(suggestion.detail, deterministic.detail);
});

test('an unavailable policy advisor never breaks deterministic hints', () => {
    const myHand = hand('3D', '4C', '7H', '9S', 'JD', 'QC', 'KH', '2S');
    const suggestion = Coach.suggest({
        hand: myHand,
        lastPlayedHand: null,
        gameContext: context(),
        policyAdvisor: {
            minMargin: 0.5,
            advise: () => {
                throw new Error('model unavailable');
            }
        }
    });
    assert.strictEqual(suggestion.source, 'move_quality');
    assert.strictEqual(suggestion.fallbackReason, 'advisor_error');
});

test('suggested cards are all cards the player actually holds', () => {
    const myHand = hand('3D', '5C', '5H', '8S', '9D', '10C', 'JH', 'AS');
    const suggestion = Coach.suggest({
        hand: myHand, lastPlayedHand: pile('4S'), gameContext: context()
    });

    if (suggestion.action === 'play') {
        for (const c of suggestion.cards) {
            assert.ok(
                myHand.some(h => h.rank === c.rank && h.suit === c.suit),
                `suggested ${c.rank}${c.suit} is not in hand`
            );
        }
    }
});

test('a hand that plays out is suggested as the round-winning move', () => {
    const myHand = hand('5D', '5C');
    const suggestion = Coach.suggest({
        hand: myHand, lastPlayedHand: null, gameContext: context([4, 4, 4])
    });

    assert.strictEqual(suggestion.action, 'play');
    assert.strictEqual(suggestion.cards.length, 2);
    assert.match(suggestion.detail, /whole hand/i);
});

// ---------------------------------------------------------------------------
// Passing
// ---------------------------------------------------------------------------

test('with nothing that beats the pile the coach says the pass is forced', () => {
    const suggestion = Coach.suggest({
        hand: hand('3D', '4C', '5H', '6S', '7D', '8C', '9H'),
        lastPlayedHand: pile('2S'),
        gameContext: context()
    });

    assert.strictEqual(suggestion.action, 'pass');
    assert.strictEqual(suggestion.cards, null);
    assert.match(suggestion.detail, /only move/i);
});

test('the coach suggests sitting out when every response costs more than the trick', () => {
    // Every answer to the pile is a K or better, every card is paired so
    // playing one breaks a shape, and there is no loose low card making the
    // lead worth having. That is the position shouldStrategicPass exists for.
    const myHand = hand('3D', '3C', '4H', '4S', 'KH', 'KS', 'AD', 'AC', '2H', '2S');
    const suggestion = Coach.suggest({
        hand: myHand, lastPlayedHand: pile('QS'), gameContext: context([11, 11, 11])
    });

    assert.strictEqual(suggestion.action, 'pass');
    assert.strictEqual(suggestion.cards, null);
    // The forced-pass wording must not be reused here: this pass is a choice.
    assert.doesNotMatch(suggestion.detail, /only move/i);
});

// ---------------------------------------------------------------------------
// The lens invariant: no suit may ever appear in coach prose
// ---------------------------------------------------------------------------

const SUIT_MENTION = /[♦♣♥♠]|diamond|club|heart|spade/i;

test('describeMove names every hand shape without naming a suit', () => {
    const shapes = [
        hand('7H'),
        hand('9D', '9C'),
        hand('JD', 'JC', 'JH'),
        hand('3D', '4C', '5H', '6S', '7D'),      // straight
        hand('3H', '5H', '9H', 'JH', 'AH'),      // flush
        hand('8D', '8C', '8H', '4S', '4D'),      // full house
        hand('6D', '6C', '6H', '6S', '9D'),      // quads
        hand('4S', '5S', '6S', '7S', '8S'),      // straight flush
        hand('AD', '2C', '3H', '4S', '5D'),      // wheel
    ];

    for (const cards of shapes) {
        const move = Big2Rules.validateHand(cards);
        assert.ok(move, `${key(cards)} should validate`);
        const described = Coach.describeMove(move);
        assert.doesNotMatch(described, SUIT_MENTION, `"${described}" names a suit`);
    }
});

test('no hint in a full deal ever names a suit', () => {
    // Every 13-card deal from a deterministic shuffle, led and responded to.
    const deck = [];
    for (const rank of RANKS) for (const suit of SUITS) deck.push(card(rank, suit));

    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const piles = [null, pile('5D'), pile('9H', '9S'), pile('3C', '4D', '5H', '6S', '7C')];

    for (let seat = 0; seat < 4; seat++) {
        const myHand = deck.slice(seat * 13, seat * 13 + 13);
        for (const lastPlayedHand of piles) {
            const s = Coach.suggest({ hand: myHand, lastPlayedHand, gameContext: context() });
            const prose = `${s.headline} ${s.detail}`;
            assert.doesNotMatch(prose, SUIT_MENTION, `seat ${seat}: "${prose}" names a suit`);
        }
    }
});

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

test('a forced decision draws no reaction', () => {
    const myHand = hand('3D', '4C', '5H');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: pile('2S'), gameContext: context(), action: 'pass'
    });

    assert.strictEqual(quality.scored, false);
    assert.strictEqual(
        Coach.react({ quality, action: 'pass', handSize: myHand.length }),
        null
    );
});

test('a play that empties the hand draws no reaction - the round is over', () => {
    const myHand = hand('5D', '5C');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([4, 4, 4]),
        action: 'play', cards: myHand
    });

    assert.strictEqual(
        Coach.react({ quality, action: 'play', handSize: 2, playedOut: true }),
        null
    );
});

test('missing a round-winning play is called out, with the move that was there', () => {
    const myHand = hand('5D', '5C');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([4, 4, 4]),
        action: 'play', cards: [myHand[0]]
    });

    const note = Coach.react({ quality, action: 'play', handSize: 2 });

    assert.ok(note, 'a missed win must produce a note');
    assert.strictEqual(note.kind, 'missed_win');
    assert.strictEqual(note.tone, 'bad');
    assert.strictEqual(note.bestAction, 'play');
    assert.strictEqual(note.bestMoveCards.length, 2);
    assert.doesNotMatch(note.bestMoveLabel, SUIT_MENTION);
});

test('a note names passing as the alternative, not just the plays', () => {
    // Answering a low single by breaking up a pair of 2s: the model would
    // rather sit the trick out, and a note that omits that is half a
    // correction - there are no cards to draw, so the label has to say it.
    const myHand = hand('3D', '3C', '4H', '4S', 'KH', 'KS', 'AD', 'AC', '2H', '2S');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: pile('QS'), gameContext: context([11, 11, 11]),
        action: 'play', cards: [card('2', 'S')]
    });

    assert.strictEqual(quality.bestMove, 'pass');
    assert.strictEqual(quality.bestMoveCards, null);

    const note = Coach.react({ quality, action: 'play', handSize: myHand.length });
    assert.ok(note, 'spending a 2 where the model would pass must be worth a word');
    assert.strictEqual(note.bestAction, 'pass');
    assert.match(note.bestMoveLabel, /pass/i);
    assert.doesNotMatch(note.bestMoveLabel, SUIT_MENTION);
});

test('finding the forced win is credited, and only while credit is in budget', () => {
    // 2S is unbeatable as a single and leaves a pair that plays out next turn.
    const myHand = hand('2S', '5D', '5C');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: null, gameContext: context([6, 6, 6]),
        action: 'play', cards: [myHand[0]]
    });

    assert.strictEqual(quality.forcedWin, true);

    const credited = Coach.react({ quality, action: 'play', handSize: 3 });
    assert.ok(credited, 'a forced win found must be worth saying');
    assert.strictEqual(credited.tone, 'good');
    // Nothing to correct, so no alternative is offered.
    assert.strictEqual(credited.bestMoveCards, null);
    assert.strictEqual(credited.bestMoveLabel, null);

    assert.strictEqual(
        Coach.react({ quality, action: 'play', handSize: 3, allowCredit: false }),
        null,
        'praise must be withheld once the round budget is spent'
    );
});

test('a reaction only ever fires where the post-game review would agree', () => {
    // classify is the shared gate. Anything it declines - unconfident
    // positions, gambles whose outcome is not known yet - must stay unsaid.
    const { classify } = require('../game/MoveReview');
    const myHand = hand('3D', '4C', '5H', '6S', '7D', '8C', '9H', '10S');
    const quality = evaluateMove({
        hand: myHand, lastPlayedHand: pile('4D'), gameContext: context(),
        action: 'play', cards: [myHand[7]]
    });

    const kind = classify(quality, { outcome: null, playedOut: false, handSize: 8 });
    const note = Coach.react({ quality, action: 'play', handSize: 8 });

    assert.strictEqual(!!note, !!(kind && Coach.COACH_LINES[kind]));
    if (note) assert.strictEqual(note.kind, kind);
});

test('reasoning is only computed when a note actually fires', () => {
    let calls = 0;
    const explainer = () => { calls++; return { bestMoveFactors: [] }; };

    // Forced: no note, so nothing to explain.
    Coach.react({
        quality: evaluateMove({
            hand: hand('3D', '4C'), lastPlayedHand: pile('2S'),
            gameContext: context(), action: 'pass'
        }),
        action: 'pass', handSize: 2, explainer
    });
    assert.strictEqual(calls, 0);

    // A missed win: the note fires, so the position is re-graded once.
    const myHand = hand('5D', '5C');
    Coach.react({
        quality: evaluateMove({
            hand: myHand, lastPlayedHand: null, gameContext: context([4, 4, 4]),
            action: 'play', cards: [myHand[0]]
        }),
        action: 'play', handSize: 2, explainer
    });
    assert.strictEqual(calls, 1);
});

// ---------------------------------------------------------------------------
// Keeping a five-card hand together
// ---------------------------------------------------------------------------

test('a hint does not break up a five-card hand to play a pair out of it', () => {
    // Reported from a live game: six cards, a lone 8 plus a flush holding the
    // other 8. The coach suggested the pair of 8s, which destroys the flush and
    // leaves four singles that each need their own lead.
    //
    // Two mispricings put the pair on top. comboBreakPenalty scaled the loss by
    // the rank of the card pulled out, so breaking the flush with its 8 was
    // priced below the bonus for leading a five-card hand at all; and
    // evaluateFollowUp's card-count ladder scored the four-card remainder above
    // the one-card remainder the flush leaves behind.
    const myHand = hand('8S', '3H', '8H', 'KH', 'AH', '2H');
    const gameContext = context([5, 8, 4]);

    const suggestion = Coach.suggest({ hand: myHand, lastPlayedHand: null, gameContext });

    assert.strictEqual(suggestion.action, 'play');
    assert.strictEqual(suggestion.cards.length, 5,
        `expected the flush, got ${suggestion.cards.map(c => c.rank + c.suit).join(' ')}`);
});

test('breaking a saved combination costs the same whichever card is pulled', () => {
    // The shape is equally destroyed either way, and the rank of the card that
    // leaves is already charged - at full weight - by moveRetentionCost. Pricing
    // it twice here made the cheapest card the cheapest way to wreck the hand.
    const { BotLogic } = require('../game/BotLogic');
    const myHand = hand('8S', '3H', '8H', 'KH', 'AH', '2H');
    const org = BotLogic.organizeHand(myHand);

    const breakWith = (code) => BotLogic.comboBreakPenalty(
        Big2Rules.validateHand(hand(code)), org, 'mid');

    // 3H, 8H and KH all sit inside the one flush; only 8S is outside it.
    assert.ok(breakWith('3H') > 0);
    assert.strictEqual(breakWith('3H'), breakWith('8H'));
    assert.strictEqual(breakWith('3H'), breakWith('KH'));
    assert.strictEqual(breakWith('8S'), 0);
});

test('follow-up strength separates remainders the old card-count ladder tied', () => {
    // The card-count term used to be two flat steps - 100 at three cards or
    // fewer, 50 from four to six - so leaving one card and leaving three scored
    // identically. Held against remainders with the same structure (junk
    // singles: no pairs, no control, no five-card hands), every card shed has to
    // show up as an improvement, or the term is not measuring what it claims to.
    const { BotLogic } = require('../game/BotLogic');

    // Ranks two apart in four different suits: no pair, no straight, no flush
    // and no control card, so the only legal plays are the singles themselves.
    // Every remainder below therefore differs only in how many cards it has.
    const junk = ['3D', '5C', '7H', '9S'];
    const leaving = (n) => {
        const held = hand(...junk.slice(0, n + 1));
        const move = Big2Rules.validateHand([held[held.length - 1]]);
        return BotLogic.evaluateFollowUp(move, held, BotLogic.organizeHand(held)).followUpScore;
    };

    assert.ok(leaving(1) > leaving(2) && leaving(2) > leaving(3),
        `expected strictly decreasing, got ${leaving(1)} / ${leaving(2)} / ${leaving(3)}`);
});
