// server/game/Coach.js
//
// The coach: a live hint on request, and an unprompted note about the move you
// just made.
//
// Nothing here decides anything. Both halves are a voice on top of machinery
// that already exists, and that is the point:
//
//   - The hint is the top of MoveQuality.rankOptions - the same ranked list
//     evaluateMove grades a played move inside. A coach that recommended a move
//     on one scale while the grader marked it on another would contradict
//     itself inside a single turn, which is exactly what sharing the ranker
//     rules out.
//   - The note is MoveReview.classify, the same function that decides which
//     decisions are worth showing in a post-game review, run against the grade
//     RoomManager already computes for every human move. So a mistake called
//     out at the table is the same mistake the review will list afterwards,
//     described in the same terms.
//
// Two things the live path cannot do that the review can, both of them
// deliberate:
//
//   - No outcome. A review knows whether a gamble was beaten because it reads
//     the rest of the round; at the table the trick has not resolved yet.
//     `outcome: null` is passed to classify, which drops the two gamble kinds
//     and leaves the kinds that are decidable from the position alone.
//   - No opponent hands. A review replays from the tape and can show what you
//     were up against. Here the observation is built from the acting seat and
//     carries opponents' card COUNTS only (see BotContext), so there is nothing
//     to leak - and nothing sent to a client may ever be derived from another
//     player's cards.
//
// Prose rule: never name a suit. The Pusoy Dos lens remaps every rendered suit
// per viewer, and a server string saying "the 5 of diamonds" would be wrong for
// half the table. Ranks are lens-invariant, so descriptions are built from
// ranks and shapes; the client renders the cards themselves through the
// lens-aware glyph.

const { rankOptions, WIN_SCORE } = require('./MoveQuality');
const { classify, HIGHLIGHT_KINDS } = require('./MoveReview');
const { HAND_TYPES } = require('./Big2Rules');

// How many scoring factors a hint carries. The bubble shows them as a short
// list under the sentence; past three it stops being a reason and becomes a
// spreadsheet.
const MAX_FACTORS = 3;

// An opponent at or below this many cards is close enough to going out that
// holding the lead is the operative question, not the price of the card.
// Matches the threshold BotLogic.dangerLevel treats as pressure.
const PRESSURE_CARDS = 3;

/**
 * Coach voice for each review kind.
 *
 * MoveReview's own `title`/`detail` are written for a post-game list read in
 * retrospect. Live, mid-turn, the same finding needs to be shorter and in the
 * second person - so the kind and the grading behind it are shared, and only
 * the wording differs.
 *
 * `credit` marks the kinds that praise rather than correct; they are rationed
 * (see `react`) because an owl that congratulates every good move is noise
 * within one round.
 */
const COACH_LINES = {
    missed_win: {
        headline: 'Oh no — that was the round!',
        line: 'You were holding a play that emptied your hand. It would have won there and then.'
    },
    missed_forced_win: {
        headline: 'Oh no — you had a forced win.',
        line: 'Nothing left in the deck could have beaten that play, and the rest of your hand would have gone out on your next turn.'
    },
    blunder: {
        headline: 'That one was expensive.',
        line: 'There was a much cheaper way through this. What you played gave up more of your hand than the position asked for.'
    },
    found_forced_win: {
        headline: 'Beautiful — that is the forced win.',
        line: 'Nothing out there beats it, and the rest of your hand plays out next turn.',
        credit: true
    },
    hard_position: {
        headline: 'Nicely judged.',
        line: 'Plenty of options there and they were far apart in value. You took the best one.',
        credit: true
    }
};

// Face cards read as words rather than letters: "the pair of Jacks", not "the
// pair of Js". Number ranks are left as digits, which is how players say them.
const RANK_NAME = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
const rankName = (rank) => RANK_NAME[rank] || rank;
const ranks = (rank) => (RANK_NAME[rank] ? `${RANK_NAME[rank]}s` : `${rank}s`);

/**
 * Describe a move in ranks and shape only.
 *
 * Deliberately suit-free - see the header. A single is "the 7" even when two
 * 7s are held: the bubble renders the actual cards beside the sentence and the
 * hint auto-selects them, so the prose does not have to disambiguate.
 */
function describeMove(move) {
    const cards = move.cards;
    const byRank = {};
    for (const c of cards) byRank[c.rank] = (byRank[c.rank] || 0) + 1;

    switch (move.type) {
        case HAND_TYPES.SINGLE:
            return `the ${rankName(cards[0].rank)}`;
        case HAND_TYPES.PAIR:
            return `the pair of ${ranks(cards[0].rank)}`;
        case HAND_TYPES.TRIPLE:
            return `the three ${ranks(cards[0].rank)}`;
        case HAND_TYPES.QUADS: {
            const quad = Object.keys(byRank).find(r => byRank[r] === 4);
            return `the four ${ranks(quad)}`;
        }
        case HAND_TYPES.FULL_HOUSE: {
            const triple = Object.keys(byRank).find(r => byRank[r] === 3);
            const pair = Object.keys(byRank).find(r => byRank[r] === 2);
            return `the full house, ${ranks(triple)} over ${ranks(pair)}`;
        }
        case HAND_TYPES.STRAIGHT:
            // Cards arrive sorted by value, so the ends are the ends - except
            // for the two wheel straights, where a 2 sorts to the top while
            // reading as the low card. Naming both ends of those would be
            // wrong, so they are described by shape alone.
            return byRank['2'] && byRank['3']
                ? 'the low straight'
                : `the ${rankName(cards[0].rank)}-to-${rankName(cards[4].rank)} straight`;
        case HAND_TYPES.FLUSH:
            return `the flush, ${rankName(cards[4].rank)} high`;
        case HAND_TYPES.STRAIGHT_FLUSH:
            return 'the straight flush';
        default:
            return 'that hand';
    }
}

/** Trim the factor list to what fits in a bubble, and drop the sentinels. */
function presentFactors(factors) {
    if (!factors) return [];
    return factors
        .filter(f => f.points !== 0)
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, MAX_FACTORS)
        .map(f => ({
            factor: f.factor,
            // WIN_SCORE and -Infinity are ordering sentinels, not quantities. A
            // bubble reading "+1000000" says nothing the sentence has not
            // already said.
            points: Number.isFinite(f.points) && Math.abs(f.points) < WIN_SCORE
                ? Math.round(f.points)
                : null
        }));
}

/**
 * Why this play, in one sentence.
 *
 * Every branch is a fact the ranker actually established, in decreasing order
 * of how much it settles the position. The generic tail is the only one that
 * describes the cost model in general terms, and it still only claims what the
 * factor list shows: whether the move broke up a saved combination.
 */
function explainPlay({ move, hand, score, isOnlyOption, minOpponentCards, factors }) {
    if (score >= WIN_SCORE && move.cards.length === hand.length) {
        return 'That is your whole hand — play it and the round is yours.';
    }
    if (score >= WIN_SCORE) {
        return 'Nothing left out there can beat this, and the rest of your hand plays out on your next turn.';
    }
    if (isOnlyOption) {
        return 'It is the only legal play here, so there is nothing to weigh up.';
    }
    if (minOpponentCards <= PRESSURE_CARDS) {
        return 'Someone is close to going out. Holding the lead is worth more right now than the card it costs you.';
    }
    if (move.cards.length === 5) {
        return 'Five cards at once is the cheapest way to unload volume, and it is the hardest shape for anyone to answer.';
    }
    const breaksCombo = factors.some(f => f.factor === 'Breaks a saved combination');
    if (move.cards.length > 1) {
        return breaksCombo
            ? `Clears ${move.cards.length} cards. It does cost you a combination you were saving, but the rest of the field is worse.`
            : `Clears ${move.cards.length} cards without touching anything you are saving.`;
    }
    return breaksCombo
        ? 'Cheapest way through, even though it pulls a card out of a combination you were holding together.'
        : 'Cheapest card that does the job — your stronger cards keep their value for later.';
}

/**
 * What to suggest at this decision.
 *
 * @param {object[]} hand           The player's hand.
 * @param {object|null} lastPlayedHand  The pile to beat, or null when leading.
 * @param {boolean} isFirstTurn     Opening turn of the game (3D must be played).
 * @param {object} gameContext      From BotContext.buildGameContext.
 *
 * @returns {object} { action, cards, type, headline, detail, factors,
 *                     confident, optionCount }. `cards` is null for a pass.
 *                     `confident` is false where the cost model is not the
 *                     model the bot itself uses (small hands the endgame solver
 *                     owns, and the last-card block); the hint still stands but
 *                     is presented as an opinion rather than a correction.
 */
function suggest({ hand, lastPlayedHand = null, isFirstTurn = false, gameContext = {} }) {
    const counts = gameContext.playerCardCounts || [13, 13, 13];
    const minOpponentCards = Math.min(...counts);

    const { options, candidates } = rankOptions({
        hand, lastPlayedHand, isFirstTurn, gameContext, explain: true
    });

    // Nothing legal. Only reachable with a pile on the table - a lead always
    // has at least one legal move - so the pass is forced rather than chosen.
    if (options.length === 0) {
        return {
            action: 'pass',
            cards: null,
            type: null,
            headline: 'Nothing you hold beats that.',
            detail: 'No combination in your hand can answer the pile, so passing is your only move.',
            factors: [],
            confident: true,
            optionCount: 1
        };
    }

    const best = options[0];
    const factors = presentFactors(best.factors);

    // Same confidence rule as MoveQuality: a proven win settles the position
    // whatever the cost model thinks, and otherwise a small hand belongs to the
    // endgame solver rather than to pricing.
    const confident = best.score >= WIN_SCORE || (hand.length > 5 && counts[0] > 1);

    if (best.action === 'pass') {
        return {
            action: 'pass',
            cards: null,
            type: null,
            headline: 'Sit this one out.',
            detail: 'Everything you could play here costs you more than the trick is worth. Let it go and keep the cards.',
            factors,
            confident,
            optionCount: options.length
        };
    }

    const move = best.move;
    return {
        action: 'play',
        cards: move.cards.map(c => ({ rank: c.rank, suit: c.suit, value: c.value })),
        type: move.type,
        headline: `Play ${describeMove(move)}.`,
        detail: explainPlay({
            move,
            hand,
            score: best.score,
            isOnlyOption: candidates.length === 1,
            minOpponentCards,
            factors
        }),
        factors,
        confident,
        optionCount: options.length
    };
}

/**
 * React to a move that was just made.
 *
 * @param {object} quality      A MoveQuality grade of the move, taken against
 *                              the position BEFORE it was applied.
 * @param {'play'|'pass'} action
 * @param {number} handSize     Cards held before the move.
 * @param {boolean} playedOut   The move emptied the hand and ended the round.
 * @param {boolean} allowCredit Whether a praise note is still in budget this
 *                              round. Errors are always worth saying; praise
 *                              repeated every few turns is just noise.
 * @param {function} explainer  Re-grades the same decision with `explain: true`,
 *                              called only when a note actually fires. Grading
 *                              every ply with reasoning on would double the
 *                              cost of the live play path for output nobody
 *                              reads - the same reason MoveReview defers it.
 *
 * @returns {object|null} The note, or null when this move is not worth a word.
 */
function react({ quality, action, handSize, playedOut = false, allowCredit = true, explainer = null }) {
    if (!quality) return null;

    // outcome: null - the trick has not resolved, so the two gamble kinds
    // cannot be decided yet and classify drops them. They are what the
    // post-game review adds on top of this.
    const kind = classify(quality, { outcome: null, playedOut, handSize });
    if (!kind) return null;

    const copy = COACH_LINES[kind];
    if (!copy) return null;
    if (copy.credit && !allowCredit) return null;

    const explained = explainer ? explainer() : null;

    return {
        kind,
        tone: HIGHLIGHT_KINDS[kind].tone,
        headline: copy.headline,
        detail: copy.line,
        action,
        // What the coach would have done instead. Null when the player already
        // found the best move, which is every credit kind.
        //
        // Passing gets named too. It is a real alternative and often the one
        // being missed - a note that says the move was expensive without saying
        // what to do instead is only half a correction - but it has no cards to
        // draw, so the label carries it alone.
        bestAction: quality.rank === 1 ? null : (quality.bestMove === 'pass' ? 'pass' : 'play'),
        bestMoveCards: quality.rank === 1 ? null : quality.bestMoveCards,
        bestMoveLabel: quality.rank === 1
            ? null
            : (quality.bestMove === 'pass'
                ? 'pass — let the trick go'
                : (quality.bestMoveCards
                    ? describeMove({ type: quality.bestMoveType, cards: quality.bestMoveCards })
                    : null)),
        factors: presentFactors(explained ? explained.bestMoveFactors : null)
    };
}

module.exports = {
    suggest,
    react,
    describeMove,
    COACH_LINES,
    PRESSURE_CARDS,
    MAX_FACTORS
};
