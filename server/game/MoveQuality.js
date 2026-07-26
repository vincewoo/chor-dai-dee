// server/game/MoveQuality.js
//
// Grades a human decision against the bot's own evaluation of the position.
//
// The Tier 3 "decision quality" figures used to come from an if-ladder in
// DecisionAnalyzer that returned 'optimal' as its fallback for essentially
// every play, so an optimal rate said almost nothing. Meanwhile BotLogic
// already prices every legal move in one currency - a convex retention cost
// for the cards given up, set against what the trick is worth. Ranking the
// move a player actually made inside that same list turns "quality" into
// something measured rather than asserted.
//
// Three deliberate choices:
//
//   - No bot profile. getBotProfile gives each bot stable temperament, and
//     pickScoredMove samples near the top rather than taking the argmax. A
//     yardstick must not do either: every player is graded against the same
//     profile-free argmax, so two identical decisions always score the same.
//
//   - The cost model, not the policy. BotLogic.selectBestMove short-circuits
//     around scoring for one-trick wins, the endgame solver, and blocking a
//     player on their last card. Those are policy shortcuts; grading through
//     them would mean a player is measured on one scale in most positions and
//     a synthetic one elsewhere. Scoring every option uniformly keeps the
//     number comparable across decisions. The cost model already accounts for
//     danger and for playing out, so the shortcuts are not carrying anything
//     the score misses.
//
//   - Loss is normalized, not absolute. Raw score gaps are in retention-cost
//     points and their spread varies wildly by position, so an average of them
//     would be dominated by a handful of dramatic turns. Each decision is
//     scored as its share of the gap between the best and worst option
//     available at that moment, which is unit-free, bounded to 0-1, and needs
//     no calibration constant.

const { BotLogic } = require('./BotLogic');

// A decision is only graded when the player actually had a choice. A forced
// pass (nothing beats the pile) and a lone legal lead measure card quality,
// not judgement, and would otherwise pad everyone's accuracy towards 100%.
const QUALITY_BANDS = [
    { key: 'optimal', maxLoss: 0.02 },
    { key: 'good', maxLoss: 0.15 },
    { key: 'inaccuracy', maxLoss: 0.40 },
    { key: 'mistake', maxLoss: Infinity }
];

// Scoring every option is the expensive part. Above this many candidates the
// set is trimmed to both extremes - the cheapest moves for shedding and the
// strongest for forcing a pass - which preserves the best and worst scores the
// loss fraction is measured against. The move actually played is always kept.
const MAX_SCORED_CANDIDATES = 40;

// A play is a gamble when what it stands to lose - the retention cost of the
// cards committed, weighted by the chance of being beaten - is more than the
// price at which the model already considers a trick not worth contesting.
// Reusing PASS_PRICE keeps the threshold tied to the cost model instead of
// being a number fitted to a few example hands.
const RISK_STAKE_THRESHOLD = Math.abs(BotLogic.PASS_PRICE);

/** Stable identity for a set of cards, order-independent. */
const cardKey = (cards) => cards
    .map(c => `${c.rank}${c.suit}`)
    .sort()
    .join(',');

const bandFor = (lossFraction) =>
    QUALITY_BANDS.find(b => lossFraction <= b.maxLoss).key;

/**
 * Would the bot ever sit this trick out? Mirrors the hard overrides in
 * BotLogic.shouldStrategicPass, which refuse to pass regardless of price. When
 * one of them applies, passing is not a priced option but a plain error, so it
 * ranks below every play rather than at the pass threshold.
 */
function passIsAvailable(candidates, hand, ctx, gamePhase) {
    if (candidates.some(m => m.cards.length === hand.length)) return false; // can play out
    if (ctx.playerCardCounts[0] <= 1) return false;                         // must contest
    if (hand.length <= 4 || gamePhase === 'late') return false;             // need the tempo
    return true;
}

/**
 * Is this play a gamble on keeping the lead?
 *
 * Not a question of which rank was played: an ace the model expects to hold is
 * a strong play, while the same ace with the deck still full is a bet. What
 * makes it a bet is the value at stake times the chance of losing it. Pairs
 * with the trick-resolution tracking in RoomManager, which records whether the
 * bet actually came off.
 */
function isRiskyMove(move, hand, ctx, gamePhase) {
    const stake = BotLogic.moveRetentionCost(move, gamePhase);
    const holdProbability = BotLogic.estimateControlProbability(move, hand, ctx);
    return stake * (1 - holdProbability) > RISK_STAKE_THRESHOLD;
}

/**
 * Grade one decision.
 *
 * @param {object[]} hand          The player's hand BEFORE the move.
 * @param {object|null} lastPlayedHand The pile to beat, or null when leading.
 * @param {boolean} isFirstTurn    Opening turn of the game (3D must be played).
 * @param {object} gameContext     From BotContext.buildGameContext, profile-free.
 * @param {'play'|'pass'} action   What the player did.
 * @param {object[]} cards         Cards played, for action 'play'.
 *
 * @returns {object} { scored, forced, quality, lossFraction, rank, optionCount,
 *                     isRisky, bestMove }. When scored is false the decision
 *                     carried no choice and must be left out of any accuracy
 *                     figure; quality and lossFraction are null.
 */
function evaluateMove({ hand, lastPlayedHand, isFirstTurn = false, gameContext = {}, action, cards = null }) {
    const unscored = (forced) => ({
        scored: false,
        forced,
        quality: null,
        lossFraction: null,
        rank: null,
        optionCount: null,
        isRisky: false,
        bestMove: null
    });

    const ctx = BotLogic.buildDecisionContext(hand, { ...gameContext, profile: null });
    const candidates = BotLogic.legalCandidates(ctx.allValidMoves, lastPlayedHand, isFirstTurn);

    // Nothing beat the pile: the pass was forced, not chosen.
    if (candidates.length === 0) return unscored(true);

    // Leading with a single legal shape is equally forced. When there is a pile
    // there are always at least two options, since passing is one of them.
    const optionCount = candidates.length + (lastPlayedHand ? 1 : 0);
    if (optionCount < 2) return unscored(true);

    const gamePhase = BotLogic.getGamePhase(hand.length);
    const chosenKey = action === 'play' && cards ? cardKey(cards) : null;

    // Trim for cost, but never drop the move being graded.
    let toScore = candidates;
    if (candidates.length > MAX_SCORED_CANDIDATES) {
        const half = Math.floor(MAX_SCORED_CANDIDATES / 2);
        const sorted = [...candidates].sort((a, b) => a.value - b.value);
        const kept = [...sorted.slice(0, half), ...sorted.slice(-half)];
        if (chosenKey && !kept.some(m => cardKey(m.cards) === chosenKey)) {
            const chosen = candidates.find(m => cardKey(m.cards) === chosenKey);
            if (chosen) kept.push(chosen);
        }
        const seen = new Set();
        toScore = kept.filter(m => {
            const key = cardKey(m.cards);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    const trickValue = lastPlayedHand
        ? BotLogic.evaluateTrickValue(hand, ctx, gamePhase)
        : null;

    const options = toScore.map(move => {
        const scored = lastPlayedHand
            ? BotLogic.scoreResponseMove(move, hand, ctx, gamePhase, trickValue)
            : BotLogic.scoreLeadMove(move, hand, ctx, gamePhase);
        return { action: 'play', key: cardKey(move.cards), move, score: scored.score };
    });

    if (lastPlayedHand) {
        options.push({
            action: 'pass',
            key: 'pass',
            move: null,
            // Passing sits exactly at the price a response has to clear to be
            // worth making -- the same comparison shouldStrategicPass draws.
            score: passIsAvailable(candidates, hand, ctx, gamePhase)
                ? BotLogic.PASS_PRICE
                : -Infinity
        });
    }

    options.sort((a, b) => b.score - a.score);

    const chosenIndex = options.findIndex(o =>
        action === 'pass' ? o.action === 'pass' : o.key === chosenKey);

    // The move played was not among the legal ones. The server validates before
    // this runs, so this means the position handed in disagrees with the play;
    // grading it would invent a number.
    if (chosenIndex === -1) return unscored(false);

    const best = options[0].score;
    const worst = options[options.length - 1].score;
    const chosen = options[chosenIndex];

    // An infinite spread means the only alternative was something the bot
    // treats as never-do (passing when passing is not an option). Fall back to
    // a binary read: the chosen option is either the best one or the error.
    const spread = Number.isFinite(best) && Number.isFinite(worst) ? best - worst : null;
    let lossFraction;
    if (spread === null) {
        lossFraction = Number.isFinite(chosen.score) && chosen.score === best ? 0 : 1;
    } else if (spread <= 0) {
        // Every option scores the same; there was nothing to get wrong.
        lossFraction = 0;
    } else {
        lossFraction = (best - chosen.score) / spread;
    }

    return {
        scored: true,
        forced: false,
        quality: bandFor(lossFraction),
        lossFraction,
        rank: chosenIndex + 1,
        optionCount: options.length,
        isRisky: chosen.action === 'play' && isRiskyMove(chosen.move, hand, ctx, gamePhase),
        bestMove: options[0].action === 'pass'
            ? 'pass'
            : options[0].move.cards.map(c => `${c.rank}${c.suit}`).join(' ')
    };
}

module.exports = { evaluateMove, QUALITY_BANDS, MAX_SCORED_CANDIDATES };
