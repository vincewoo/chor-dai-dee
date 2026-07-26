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
//     number comparable across decisions.
//
//     With one exception, and it is the reason `confident` exists. This
//     comment used to claim the shortcuts "are not carrying anything the score
//     misses". Measured against self-play, that was wrong: 30% of decisions
//     taken with five cards or fewer were graded a mistake, and 96% of a
//     strong player's flagged mistakes sat in that range - almost exactly the
//     hands where selectBestMove hands off to solveEndgame. The cost model
//     prices cards; it does not search, and once a hand is small enough to
//     read out, search is the operative question. So:
//
//       - Where search PROVES an answer, the score defers to it. A move that
//         cannot be beaten and leaves a remainder that plays out as one hand
//         is a forced win, and is scored as one.
//       - Where the shortcut is merely a second opinion - solveEndgame's
//         non-guaranteed "power" pick, which is what 78% of those flagged
//         mistakes actually were - neither model has authority, and asserting
//         a blunder would be inventing confidence. The score stands, so
//         aggregate rates are unchanged, but `confident` goes false and a
//         coaching surface must not present the decision as an error.
//
//   - Loss is normalized, not absolute. Raw score gaps are in retention-cost
//     points and their spread varies wildly by position, so an average of them
//     would be dominated by a handful of dramatic turns. Each decision is
//     scored as its share of the gap between the best and worst option
//     available at that moment, which is unit-free, bounded to 0-1, and needs
//     no calibration constant.

const { BotLogic } = require('./BotLogic');
const { Big2Rules } = require('./Big2Rules');

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

// The hand size at which BotLogic.selectBestMove hands off to solveEndgame.
// Kept in step with that threshold deliberately: it marks the boundary where
// the cost model stops being the model the bot itself is using.
const ENDGAME_HAND_SIZE = 5;

// Parity with the "plays out - wins the round" sentinel in scoreLeadMove and
// scoreResponseMove. A forced win is the same outcome one move earlier, so it
// has to sit at the same height or the two would be ranked against each other.
const WIN_SCORE = 1e6;

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
 * The moves among `candidates` that force a win outright.
 *
 * Mirrors the guaranteed-win branch of BotLogic.solveEndgame, with one
 * difference that matters here: solveEndgame returns the FIRST such move it
 * finds, because it only needs one to play. A grader needs all of them - if
 * two moves both force the win, playing either is optimal, and crediting only
 * the one the solver happened to enumerate first would flag the other as a
 * mistake for reaching the same guaranteed outcome.
 *
 * A move qualifies when no outstanding card can beat it (so the lead comes
 * back) and everything left forms a single valid hand (so the next turn empties
 * the hand). Moves that empty the hand immediately are already scored 1e6 by
 * the cost model and need no help.
 *
 * @returns {Set<string>} cardKey of each forcing move.
 */
function forcedWinKeys(candidates, hand, ctx) {
    const winners = new Set();
    if (hand.length > ENDGAME_HAND_SIZE) return winners;

    for (const move of candidates) {
        const remaining = hand.filter(card =>
            !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit));

        if (remaining.length === 0) continue;             // already worth 1e6
        if (!Big2Rules.validateHand(remaining)) continue; // cannot play out next turn
        if (!BotLogic.isUnbeatable(move, hand, ctx.playedCards)) continue;

        winners.add(cardKey(move.cards));
    }
    return winners;
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
 * @returns {object} { scored, forced, confident, quality, lossFraction, rank,
 *                     optionCount, isRisky, bestMove, forcedWin, absoluteLoss,
 *                     spread }. When scored is false the decision carried no
 *                     choice and must be left out of any accuracy figure;
 *                     quality and lossFraction are null. When confident is
 *                     false the score stands but the position is one the cost
 *                     model does not own - see the header - and no coaching
 *                     surface may call it an error.
 */
function evaluateMove({ hand, lastPlayedHand, isFirstTurn = false, gameContext = {}, action, cards = null, explain = false }) {
    // Fewest cards any opponent is holding. Carried on every decision so the
    // stats layer can ask how a player responds with someone about to go out,
    // without having to reconstruct the position.
    const minOpponentCards = Math.min(...(gameContext.playerCardCounts || [13, 13, 13]));

    const unscored = (forced) => ({
        scored: false,
        forced,
        // A decision with no choice cannot be an error, so nothing downstream
        // needs to weigh confidence in it.
        confident: true,
        quality: null,
        lossFraction: null,
        rank: null,
        optionCount: null,
        isRisky: false,
        bestMove: null,
        forcedWin: false,
        absoluteLoss: null,
        spread: null,
        minOpponentCards
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

    // Search settles the position where it can. Computed over the full
    // candidate set rather than the trimmed one: a forcing move that the
    // trim happened to drop would otherwise leave the grader ranking against
    // a best move that was not the best available.
    const forcedWins = forcedWinKeys(candidates, hand, ctx);

    // Off by default. Reasoning is only wanted for the handful of decisions a
    // review actually renders, and capturing it for every graded move would put
    // the cost on the live play path, which grades every turn.
    const options = toScore.map(move => {
        const key = cardKey(move.cards);
        if (forcedWins.has(key)) {
            return {
                action: 'play', key, move, score: WIN_SCORE,
                factors: explain
                    ? [{ factor: 'Cannot be beaten, and the rest plays out next turn', points: WIN_SCORE }]
                    : null
            };
        }
        const scored = lastPlayedHand
            ? BotLogic.scoreResponseMove(move, hand, ctx, gamePhase, trickValue, explain)
            : BotLogic.scoreLeadMove(move, hand, ctx, gamePhase, explain);
        return { action: 'play', key, move, score: scored.score, factors: scored.factors || null };
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
                : -Infinity,
            factors: explain
                ? [passIsAvailable(candidates, hand, ctx, gamePhase)
                    ? { factor: 'Let the trick go rather than pay for it', points: BotLogic.PASS_PRICE }
                    : { factor: 'Passing gives up a trick that has to be contested', points: -Infinity }]
                : null
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

    // Does the cost model own this position?
    //
    // Two places where it does not, both of them positions BotLogic itself
    // decides by another route:
    //
    //   - A small hand with no forced win. solveEndgame takes over here and
    //     picks by a "power" heuristic that is neither the cost model nor a
    //     proof. Two heuristics disagreeing is not evidence of a mistake.
    //   - The next player is on their last card. selectBestMove abandons
    //     scoring outright to block, and whether a given block works depends on
    //     the one card they hold, which is not knowable from here.
    //
    // A win on the board restores confidence, whichever route found it: a move
    // that plays the hand out (scored 1e6 by the cost model itself) or one that
    // forces the win a turn later. Either way the position is settled by proof
    // rather than by pricing, and "you had a win and did not take it" is the
    // most certain grade the module can issue - it must not be filtered out by
    // the same rule that suppresses endgame guesswork.
    const searchSettled = best >= WIN_SCORE;
    const confident = searchSettled || (
        hand.length > ENDGAME_HAND_SIZE &&
        (gameContext.playerCardCounts || [13, 13, 13])[0] > 1
    );

    return {
        scored: true,
        forced: false,
        confident,
        quality: bandFor(lossFraction),
        lossFraction,
        // The gap in raw retention-cost points. lossFraction is normalized to
        // the spread at this one decision, which is what makes it averageable
        // but also means it cannot tell "gave up a lot" from "every option was
        // near-identical". Ranking decisions against each other - picking the
        // worst few in a game - needs the absolute figure, so both are carried.
        absoluteLoss: Number.isFinite(best) && Number.isFinite(chosen.score)
            ? best - chosen.score
            : null,
        spread,
        // The move played was itself a forced win.
        forcedWin: chosen.action === 'play' && forcedWins.has(chosen.key),
        rank: chosenIndex + 1,
        optionCount: options.length,
        // How many of the options were plays rather than the pass, and how many
        // of those won outright. A surface that wants to credit a player for
        // finding a win needs both: when every legal play wins, there was
        // nothing to find, and praising it is flattery rather than coaching.
        playOptions: options.filter(o => o.action === 'play').length,
        winningOptions: options.filter(o => o.score >= WIN_SCORE).length,
        isRisky: chosen.action === 'play' && isRiskyMove(chosen.move, hand, ctx, gamePhase),
        minOpponentCards,
        bestMove: options[0].action === 'pass'
            ? 'pass'
            : options[0].move.cards.map(c => `${c.rank}${c.suit}`).join(' '),
        // Structured form of the same thing. The string above is what the
        // stats layer already stores; a review needs the cards themselves to
        // render them.
        bestMoveCards: options[0].action === 'pass'
            ? null
            : options[0].move.cards.map(c => ({ rank: c.rank, suit: c.suit, value: c.value })),
        bestMoveType: options[0].action === 'pass' ? null : options[0].move.type,
        bestScore: best,
        chosenScore: chosen.score,
        // Populated only under `explain`. The same factor breakdown the bot
        // debug panel renders, for the move the model preferred and for the one
        // actually made - which is the whole content of a coaching note.
        bestMoveFactors: explain ? (options[0].factors || []) : null,
        chosenFactors: explain ? (chosen.factors || []) : null
    };
}

module.exports = {
    evaluateMove,
    forcedWinKeys,
    QUALITY_BANDS,
    MAX_SCORED_CANDIDATES,
    ENDGAME_HAND_SIZE,
    WIN_SCORE
};
