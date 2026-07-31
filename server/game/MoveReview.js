// server/game/MoveReview.js
//
// Turns a logged game into a handful of coachable moments for one player.
//
// The grading is not done here - MoveQuality already prices every legal option
// and ranks the one played among them. What this module adds is the step that
// makes a review usable rather than merely accurate: deciding which of a few
// hundred graded decisions are worth showing a person.
//
// Three things shape that decision, all of them measured rather than assumed.
//
//   - Volume. A game produces around 270 decisions per player, of which ~155
//     involve a real choice. A weak player draws a "mistake" grade on roughly
//     30% of them. A list of ninety mistakes is not coaching, it is noise, so
//     the output is a small ranked set and every entry has to earn its place.
//
//   - Confidence. MoveQuality reports `confident: false` where the cost model
//     is not the model the bot itself uses - small hands the endgame solver
//     owns, and the last-card block. Those are two heuristics disagreeing, not
//     evidence of an error, and nothing here may present them as one.
//
//   - Kind, not degree. Ranking purely by loss produces a list of unexplained
//     numbers. Each highlight is instead a named situation with a reason that
//     can be stated in a sentence - "you had a forced win", "that gamble was
//     always going to be beaten" - because a player can act on a named mistake
//     and cannot act on a percentile.
//
// Positions are reconstructed by Replayer from the tape, so a decision is
// graded here exactly as it was graded live: both paths build the observation
// with BotContext.buildGameContext and score it profile-free. Nothing about the
// review is stored at play time.

const { replayRound } = require('./Replayer');
const { evaluateMove, WIN_SCORE } = require('./MoveQuality');
const { ACTION, decodeCards } = require('./TapeCodec');
const { BotLogic } = require('./BotLogic');

const { SHED_VALUE_PER_CARD } = BotLogic;

// The floor below which a loss is not worth a player's attention.
//
// Denominated in the same retention-cost points as everything else, and
// anchored to an existing constant rather than fitted: SHED_VALUE_PER_CARD is
// what the model pays for getting a single card out of the hand, so it is the
// smallest unit of real progress in the game. Giving up less than that is
// beneath the resolution of the cost model and should not be called a mistake.
const MATERIAL_LOSS = SHED_VALUE_PER_CARD;

// How many highlights a review returns. Chess reviews surface a handful of
// moments from a whole game; the useful number here is the same order.
const DEFAULT_LIMIT = 6;

// A position is "hard" when the player had real alternatives and they were
// genuinely far apart - picking the best move out of three near-identical
// options is not a display of skill worth congratulating.
const HARD_POSITION_MIN_OPTIONS = 8;
const HARD_POSITION_MIN_SPREAD = SHED_VALUE_PER_CARD * 4;

/**
 * Every highlight kind.
 *
 * `tier` orders kinds against each other; `absoluteLoss` orders within a tier.
 * Two tiers rather than a weight per kind, because the alternative ranks badly
 * in both directions. Sorting purely by loss lets the 1e6 win sentinel win
 * every comparison by arithmetic rather than by importance. Sorting purely by
 * kind puts a 46-point failed gamble above a 500-point blunder, which is not
 * how a player would rank their own game.
 *
 *   3  proven - search settled it, so there is nothing to argue with
 *   2  costly - the cost model's judgement, ranked by how much it cost
 *   1  credit - things worth saying about play that went right
 */
const TIER = { PROVEN: 3, COSTLY: 2, CREDIT: 1 };

/**
 * Named groupings, so a caller can ask for "the mistakes" without knowing which
 * kinds count as one.
 *
 * These exist because the stats page links into them: a number is only useful
 * to a player if they can get from it to the moves behind it, and the link has
 * to name the thing the number measures rather than a list of internal kinds.
 */
const TOPICS = {
    mistakes: ['missed_win', 'missed_forced_win', 'blunder'],
    gambles: ['failed_gamble', 'won_gamble'],
    best: ['found_forced_win', 'won_gamble', 'hard_position']
};

const HIGHLIGHT_KINDS = {
    missed_win: {
        tone: 'bad', tier: TIER.PROVEN,
        title: 'Missed a winning play',
        detail: 'You could have played out and taken the round here.'
    },
    missed_forced_win: {
        tone: 'bad', tier: TIER.PROVEN,
        title: 'Missed a forced win',
        detail: 'One move could not have been beaten, and the rest of your hand would have played out next turn.'
    },
    failed_gamble: {
        tone: 'bad', tier: TIER.COSTLY,
        title: 'Gamble that was beaten',
        detail: 'You committed a card the table was likely to beat, and it was.'
    },
    blunder: {
        tone: 'bad', tier: TIER.COSTLY,
        title: 'Costly choice',
        detail: 'A cheaper option was available that kept more of your hand intact.'
    },
    found_forced_win: {
        tone: 'good', tier: TIER.CREDIT,
        title: 'Found the forced win',
        detail: 'Unbeatable, with the rest of the hand playing out behind it.'
    },
    won_gamble: {
        tone: 'good', tier: TIER.CREDIT,
        title: 'Gamble that paid off',
        detail: 'You committed a card that could have been beaten, and held the lead.'
    },
    hard_position: {
        tone: 'good', tier: TIER.CREDIT,
        title: 'Best move in a hard spot',
        detail: 'Many options, widely different in value, and you took the top one.'
    }
};

/** Compact wire form for a card. */
const wireCard = (c) => ({ rank: c.rank, suit: c.suit, value: c.value });

/**
 * The other seats' hands in seating order RELATIVE to the reviewed seat:
 * index 0 is the reviewed seat itself (null — you are not your own
 * opponent), 1 the next player, 2 across, 3 previous. The client labels
 * rows by index ("Next"/"Across"/"Prev"), so absolute seat order would
 * mislabel every game where the reviewed player was not seat 0.
 */
const relativeOpponentHands = (hands, seat, wire = wireCard) =>
    hands.map((_, offset) =>
        offset === 0 ? null : hands[(seat + offset) % hands.length].map(wire));

/**
 * Did this play survive to take the trick?
 *
 * Walks forward through the round's snapshots from the play at `index`.
 * The pile is the record: while it still belongs to our seat the play is
 * standing, a pile owned by anyone else means it was beaten, and a cleared pile
 * means the trick resolved with us on top.
 *
 * Returns 'success', 'failed', or null when the round ended before the question
 * was settled. Null is not a failure - it is counted as neither, matching
 * RoomManager.clearPendingRiskyDecisions, which drops plays still pending at a
 * round boundary rather than guessing at them.
 */
function playOutcome(snapshots, index) {
    const seat = snapshots[index].seat;

    for (let i = index + 1; i < snapshots.length; i++) {
        const snap = snapshots[i];
        // The pile cleared: the trick resolved. Whoever is on lead won it.
        if (snap.pile === null) return snap.seat === seat ? 'success' : 'failed';
        // Somebody played over the top of us.
        if (snap.pileSeat !== seat) return 'failed';
    }
    return null;
}

/**
 * Which named situation, if any, does this decision belong to?
 *
 * Order matters: the tests run from most specific to least, so a missed win is
 * never also reported as an ordinary costly choice.
 */
function classify(quality, { outcome, playedOut, handSize }) {
    // A play that emptied the hand ended the round. Nothing to coach.
    if (playedOut) return null;

    if (!quality.scored) return null;

    // Everything below asserts an error or a success. Neither is sayable where
    // the cost model is not the operative model.
    if (!quality.confident) return null;

    const lost = quality.absoluteLoss;

    // --- errors ------------------------------------------------------------
    if (quality.bestScore >= WIN_SCORE && quality.chosenScore < WIN_SCORE) {
        // The best line ended the round. Whether it did so this turn or next
        // changes what to tell the player, so the two are separate kinds: a
        // move using every card wins now, anything shorter is the forced win
        // that plays out a turn later.
        const playsOutNow = quality.bestMoveCards
            && quality.bestMoveCards.length === handSize;
        return playsOutNow ? 'missed_win' : 'missed_forced_win';
    }

    if (quality.isRisky && outcome === 'failed' && lost >= MATERIAL_LOSS) {
        return 'failed_gamble';
    }

    if (quality.lossFraction > 0.40 && lost >= MATERIAL_LOSS) {
        return 'blunder';
    }

    // --- things worth crediting --------------------------------------------
    // Only when the player could have got it wrong. With two cards left and one
    // of them the only legal answer, taking the win is not a find, and a review
    // that applauds it is flattering rather than coaching.
    if (quality.forcedWin && quality.playOptions > quality.winningOptions) {
        return 'found_forced_win';
    }

    if (quality.isRisky && outcome === 'success' && quality.rank === 1) {
        return 'won_gamble';
    }

    if (
        quality.rank === 1 &&
        quality.optionCount >= HARD_POSITION_MIN_OPTIONS &&
        Number.isFinite(quality.spread) && quality.spread >= HARD_POSITION_MIN_SPREAD
    ) {
        return 'hard_position';
    }

    return null;
}

/**
 * Grade one player's decisions in one round and return the highlights.
 *
 * @param {object} round        An mlog_round row.
 * @param {object[]} actions    That round's mlog_action rows.
 * @param {number} seat         The seat being reviewed.
 * @returns {{ highlights: object[], scored: number, graded: number, error: Error|null }}
 */
function reviewRound(round, actions, seat) {
    // Non-strict: one corrupt round must not take the rest of the game with it.
    const replay = replayRound(round, actions, { strict: false });
    const { snapshots } = replay;

    const highlights = [];
    let scored = 0;
    let graded = 0;

    for (let i = 0; i < snapshots.length; i++) {
        const snap = snapshots[i];
        if (snap.seat !== seat) continue;

        const entry = snap.action;
        // Server-generated passes against a lone 2S are not decisions.
        if (entry.action === ACTION.AUTO_PASS) continue;

        const isPlay = entry.action === ACTION.PLAY;
        const cards = isPlay ? decodeCards(entry.cards_mask) : null;
        const playedOut = isPlay && cards.length === snap.hands[seat].length;

        // First pass is cheap and un-explained; only a highlight pays for
        // reasoning. Grading every ply with captureReasoning on would roughly
        // double the cost of a review for output nobody reads.
        const quality = evaluateMove({
            hand: snap.hands[seat],
            lastPlayedHand: snap.pile,
            isFirstTurn: round.round_number === 1 && snap.playedCards.length === 0,
            gameContext: snap.obs,
            action: isPlay ? 'play' : 'pass',
            cards
        });

        graded++;
        if (quality.scored) scored++;

        const outcome = isPlay ? playOutcome(snapshots, i) : null;
        const kind = classify(quality, {
            outcome, playedOut, handSize: snap.hands[seat].length
        });
        if (!kind) continue;

        // Re-grade the few that made the cut, this time with the factor
        // breakdown that explains why.
        const explained = evaluateMove({
            hand: snap.hands[seat],
            lastPlayedHand: snap.pile,
            isFirstTurn: round.round_number === 1 && snap.playedCards.length === 0,
            gameContext: snap.obs,
            action: isPlay ? 'play' : 'pass',
            cards,
            explain: true
        });

        highlights.push({
            kind,
            ...HIGHLIGHT_KINDS[kind],
            roundNumber: round.round_number,
            ply: entry.ply,

            // The position, as the player saw it.
            hand: snap.hands[seat].map(wireCard),
            pile: snap.pile
                ? { type: snap.pile.type, cards: snap.pile.cards.map(wireCard) }
                : null,
            action: isPlay ? 'play' : 'pass',
            cardsPlayed: cards ? cards.map(wireCard) : null,
            opponentCardCounts: snap.obs.playerCardCounts,

            // What the player could not see. Replay knows every hand, and this
            // is the half of a review that a live hint could never give: not
            // "this was worse" but "here is what you were up against".
            // Rotated to the reviewed seat so the client's Next/Across/Prev
            // labels are correct from any chair.
            opponentHands: relativeOpponentHands(snap.hands, seat),

            // The grade.
            quality: quality.quality,
            lossFraction: quality.lossFraction,
            absoluteLoss: quality.absoluteLoss,
            rank: quality.rank,
            optionCount: quality.optionCount,
            isRisky: quality.isRisky,
            riskOutcome: outcome,

            // The alternative, and the reasoning behind both sides.
            bestMove: quality.bestMove,
            bestMoveCards: quality.bestMoveCards,
            bestMoveType: quality.bestMoveType,
            bestMoveFactors: explained.bestMoveFactors,
            chosenFactors: explained.chosenFactors
        });
    }

    return { highlights, scored, graded, error: replay.error };
}

/**
 * Review a whole game for one player.
 *
 * Seat is resolved per round rather than per game: occupancy changes when
 * someone reconnects or a bot takes a seat over, and attributing a whole game
 * to whoever finished in a seat is how a bot's plays end up labelled as a
 * person's.
 *
 * @param {object}   opts.rounds          mlog_round rows.
 * @param {object}   opts.actionsByRound  { [roundNumber]: mlog_action[] }.
 * @param {function} opts.seatForRound    (roundNumber) => seat index, or null
 *                                        when the player did not hold a seat.
 * @param {number}   opts.limit           Highlights to return.
 * @returns {object} { highlights, summary }
 */
function reviewGame({ rounds, actionsByRound, seatForRound, limit = DEFAULT_LIMIT }) {
    const all = [];
    const failedRounds = [];
    let scored = 0;
    let graded = 0;

    for (const round of [...rounds].sort((a, b) => a.round_number - b.round_number)) {
        const seat = seatForRound(round.round_number);
        if (seat === null || seat === undefined) continue;

        const result = reviewRound(round, actionsByRound[round.round_number] || [], seat);
        all.push(...result.highlights);
        scored += result.scored;
        graded += result.graded;
        if (result.error) failedRounds.push(round.round_number);
    }

    const ranked = [...all].sort(byImportance);
    let chosen = limit === Infinity ? ranked : ranked.slice(0, limit);

    // Keep one slot for something that went right.
    //
    // A player with a bad game generates far more errors than a review can
    // show, so the top slots fill with nothing but mistakes. A review that only
    // scolds gets closed, and the credit kinds exist precisely because reading
    // one is the reason a player opens the next one. Costs the least important
    // error in the list, which by construction is the one worth least.
    if (Number.isFinite(limit) && chosen.length === limit && chosen.every(h => h.tone === 'bad')) {
        const bestGood = ranked.find(h => h.tone === 'good');
        if (bestGood) chosen = [...chosen.slice(0, limit - 1), bestGood];
    }

    const counts = {};
    for (const h of all) counts[h.kind] = (counts[h.kind] || 0) + 1;

    return {
        highlights: chosen,
        summary: {
            roundsReviewed: rounds.length - failedRounds.length,
            decisionsGraded: graded,
            // Forced moves are excluded from every rate: a pass with nothing
            // that beats the pile measures the cards, not the player.
            decisionsWithAChoice: scored,
            highlightsFound: all.length,
            countsByKind: counts,
            // Rounds whose tape did not replay cleanly. Reported rather than
            // hidden - a review that silently skipped half a game would read
            // as a clean game.
            unreadableRounds: failedRounds
        }
    };
}

/** Orders highlights the way a review presents them: tier, then what it cost. */
function byImportance(a, b) {
    const byTier = HIGHLIGHT_KINDS[b.kind].tier - HIGHLIGHT_KINDS[a.kind].tier;
    if (byTier !== 0) return byTier;
    return (b.absoluteLoss ?? 0) - (a.absoluteLoss ?? 0);
}

module.exports = {
    reviewGame,
    reviewRound,
    classify,
    playOutcome,
    byImportance,
    relativeOpponentHands,
    HIGHLIGHT_KINDS,
    TOPICS,
    MATERIAL_LOSS,
    DEFAULT_LIMIT
};
