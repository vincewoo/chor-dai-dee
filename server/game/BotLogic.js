// server/game/BotLogic.js
const { Big2Rules, HAND_TYPES } = require('./Big2Rules');
const { RANKS, SUITS } = require('./Deck');
const { worker: advancedBotWorker } = require('./AdvancedBotWorker');

// Hand type priorities for 5-card hands (higher = stronger)
const FIVE_CARD_PRIORITY = {
    [HAND_TYPES.STRAIGHT]: 1,
    [HAND_TYPES.FLUSH]: 2,
    [HAND_TYPES.FULL_HOUSE]: 3,
    [HAND_TYPES.QUADS]: 4,
    [HAND_TYPES.STRAIGHT_FLUSH]: 5
};

// === SCORING CURRENCY ===
//
// Every heuristic in this file is denominated in the same unit: points of
// "retention cost", i.e. what it costs us to no longer hold a card.
//
// The curve is deliberately convex. In Big 2 the gap between an Ace and a 2 is
// enormous while the gap between an 8 and a 9 is nearly noise, so a linear
// rank term models the wrong shape. It also has to be wide enough to matter:
// the previous base term was `100 - move.value`, which spanned only 51 points
// across the whole deck and so could be overridden by any single bonus.
const RANK_RETENTION_COST = {
    '3': 0, '4': 2, '5': 4, '6': 7, '7': 10, '8': 14, '9': 18,
    '10': 24, 'J': 34, 'Q': 46, 'K': 78, 'A': 138, '2': 215
};

// The 2 of Spades is the only single in the deck that cannot be beaten.
const TWO_OF_SPADES_PREMIUM = 105;

// How much of a card's retention cost still applies, by phase. Control held at
// the very end of a hand has little option value left - it has to be spent to
// go out, so hoarding it is its own kind of mistake.
const PHASE_COST_MULTIPLIER = { early: 1.0, mid: 0.78, late: 0.4 };

// A high card locked inside a five-card hand is not really available as
// standalone control, so spending it as part of that hand costs less than
// spending it alone.
const COST_WEIGHT_BY_SIZE = { 1: 1.0, 2: 0.85, 3: 0.7, 5: 0.35 };

// Value of getting one card out of our hand, before card quality is considered.
const SHED_VALUE_PER_CARD = 45;

// Base worth of winning a trick and taking the lead.
const TRICK_BASE_VALUE = 55;

/**
 * What it costs us to give up a single card, as standalone control.
 * @param {Object} card - { rank, suit }
 * @returns {number}
 */
const cardRetentionCost = (card) => {
    let cost = RANK_RETENTION_COST[card.rank] || 0;
    if (card.rank === '2' && card.suit === 'S') cost += TWO_OF_SPADES_PREMIUM;
    // Tiny suit term so ties break toward dumping the lower suit first.
    cost += SUITS.indexOf(card.suit) * 0.5;
    return cost;
};

/**
 * What it costs us to play a whole move, discounted for phase and for the fact
 * that cards inside a larger combination are not standalone control.
 * @param {Object} move - validated hand
 * @param {string} gamePhase - 'early' | 'mid' | 'late'
 * @returns {number}
 */
const moveRetentionCost = (move, gamePhase) => {
    const raw = move.cards.reduce((sum, c) => sum + cardRetentionCost(c), 0);
    const sizeWeight = COST_WEIGHT_BY_SIZE[move.cards.length] || 0.5;
    return raw * sizeWeight * (PHASE_COST_MULTIPLIER[gamePhase] || 1.0);
};

const BotLogic = {
    // Exposed for tests and for the debug panel.
    cardRetentionCost,
    moveRetentionCost,

    /**
     * Main entry point: Get the best move for the bot
     * @param {Array} hand - Bot's current cards
     * @param {Object|null} lastPlayedHand - The hand to beat (null = free play)
     * @param {boolean} isFirstTurn - Whether this is the first turn (must play 3D)
     * @param {Object} gameContext - Game state context
     *   - playerCardCounts: [next, across, previous] card counts
     *   - lastPlayedByRelative: 1=next, 2=across, 3=previous player played last
     *   - passedPlayers: array of indices (0=next, 1=across, 2=previous) who passed
     *   - passCount: total passes this round
     *   - playedCards: array of cards already played this round
     * @param {boolean} captureReasoning - Whether to capture detailed reasoning
     * @returns {Array|Object} - If captureReasoning is false, returns cards array. Otherwise returns { cards, reasoning }
     */
    getBotMove: (hand, lastPlayedHand, isFirstTurn, gameContext = {}, captureReasoning = false) => {
        const reasoning = captureReasoning ? {
            situation: {},
            candidatesConsidered: [],
            strategicFactors: [],
            decision: null
        } : null;

        // === EARLY EXIT OPTIMIZATIONS ===

        // Quick win: Only 1 card left on free play
        if (!lastPlayedHand && hand.length === 1 && !isFirstTurn) {
            if (reasoning) {
                reasoning.decision = { action: 'play', cards: hand.map(c => `${c.rank}${c.suit}`).join(' '), reason: 'Last card - instant win' };
            }
            return captureReasoning ? { cards: hand, reasoning } : hand;
        }

        // Normalize gameContext with defaults
        const ctx = {
            playerCardCounts: gameContext.playerCardCounts || [13, 13, 13],
            lastPlayedByRelative: gameContext.lastPlayedByRelative || null,
            passedPlayers: gameContext.passedPlayers || [],
            passCount: gameContext.passCount || 0,
            playedCards: gameContext.playedCards || [],
            playHistory: gameContext.playHistory || [],
            profile: gameContext.profile || null,
            rng: gameContext.rng || Math.random
        };

        // Analyze what cards are still in play (card counting)
        ctx.cardAnalysis = BotLogic.analyzePlayedCards(hand, ctx.playedCards);

        // Build a model of each opponent from the round's play history.
        ctx.opponentModels = BotLogic.buildOpponentModels(
            ctx.playHistory, ctx.playerCardCounts, hand, ctx.playedCards);

        // Infer what opponents cannot answer.
        //
        // This reads the whole round's history rather than only the live pile.
        // The previous version returned an empty inference whenever there was
        // no hand to beat, yet every consumer sat on the free-play branch - so
        // none of them could ever fire.
        ctx.passInference = BotLogic.inferFromHistory(ctx.opponentModels);

        // Get all valid moves first (needed for organization and analysis)
        const validMoves = BotLogic.getAllValidMoves(hand);
        ctx.allValidMoves = validMoves;

        // Organize hand according to "Poker First" heuristic (with caching)
        const handKey = hand.map(c => `${c.rank}${c.suit}`).sort().join(',');
        if (!gameContext._handOrgCache || gameContext._handOrgCache.key !== handKey) {
            gameContext._handOrgCache = {
                key: handKey,
                // OPTIMIZATION: Pass pre-calculated moves to avoid recalculation
                organization: BotLogic.organizeHand(hand, validMoves)
            };
        }
        ctx.handOrganization = gameContext._handOrgCache.organization;

        if (reasoning) {
            reasoning.situation = {
                handSize: hand.length,
                isFreePlay: !lastPlayedHand,
                isFirstTurn,
                opponentCardCounts: ctx.playerCardCounts,
                passCount: ctx.passCount,
                twosInHand: ctx.cardAnalysis.twosInHand,
                twosOutstanding: ctx.cardAnalysis.twosOutstanding,
                weHaveHighest: ctx.cardAnalysis.weHaveHighest,
                handToBeat: lastPlayedHand ? {
                    type: lastPlayedHand.type,
                    cards: lastPlayedHand.cards?.map(c => `${c.rank}${c.suit}`).join(' '),
                    value: lastPlayedHand.value
                } : null,
                organization: {
                    fiveCardHands: ctx.handOrganization.fiveCardHands.map(h => h.type),
                    pairs: ctx.handOrganization.pairs.length,
                    singles: ctx.handOrganization.singles.length
                }
            };
        }

        // Filter by what can beat the current hand
        let candidates = [];
        if (!lastPlayedHand) {
            // Free play - we can play anything
            candidates = validMoves;
            if (isFirstTurn) {
                // Must include 3D on first turn
                candidates = candidates.filter(move =>
                    move.cards.some(c => c.rank === '3' && c.suit === 'D')
                );
            }
        } else {
            // Must beat the last played hand
            candidates = validMoves.filter(move => Big2Rules.canBeat(move, lastPlayedHand));
        }

        if (candidates.length === 0) {
            if (reasoning) {
                reasoning.decision = {
                    action: 'pass',
                    reason: 'No valid moves available to beat the current hand'
                };
            }
            return captureReasoning ? { cards: null, reasoning } : null;
        }

        // Consider strategic passing.
        //
        // This has to run before any single-candidate short circuit. It used to
        // sit below one, so a bot holding exactly one legal response played it
        // unconditionally - including spending its lone 2S to beat a 9, which is
        // precisely what the price rule below exists to prevent. That short
        // circuit was also gated on `!captureReasoning`, so the debug panel took
        // the other branch and reported a pass while live play burned the card.
        // Reasoning capture must never change the decision.
        const strategicPassResult = BotLogic.shouldStrategicPass(candidates, hand, lastPlayedHand, ctx, captureReasoning);
        const shouldPass = captureReasoning ? strategicPassResult.shouldPass : strategicPassResult;

        if (lastPlayedHand && shouldPass) {
            if (reasoning) {
                reasoning.strategicFactors.push(...(strategicPassResult.factors || []));
                reasoning.decision = {
                    action: 'strategic_pass',
                    reason: strategicPassResult.reason || 'Strategic pass to conserve high cards'
                };
            }
            return captureReasoning ? { cards: null, reasoning } : null;
        }

        if (reasoning && strategicPassResult.factors) {
            reasoning.strategicFactors.push(...strategicPassResult.factors);
        }

        // Only one legal move and we have decided not to pass.
        if (candidates.length === 1) {
            const only = candidates[0];
            if (reasoning) {
                reasoning.decision = {
                    action: 'play',
                    cards: only.cards.map(c => `${c.rank}${c.suit}`).join(' '),
                    type: only.type,
                    reason: 'Only legal move available'
                };
            }
            return captureReasoning ? { cards: only.cards, reasoning } : only.cards;
        }

        // Apply strategic selection
        // PHASE 1.3: Pass all valid moves for flexibility calculation
        // ctx.allValidMoves is already set above
        const selectionResult = BotLogic.selectBestMove(candidates, hand, lastPlayedHand, isFirstTurn, ctx, captureReasoning);
        const selectedMove = captureReasoning ? selectionResult.move : selectionResult;

        if (reasoning) {
            reasoning.candidatesConsidered = selectionResult.scoredMoves?.slice(0, 5).map(sm => ({
                cards: sm.move.cards.map(c => `${c.rank}${c.suit}`).join(' '),
                type: sm.move.type,
                score: Math.round(sm.score),
                factors: sm.factors || []
            })) || [];
            reasoning.decision = {
                action: 'play',
                cards: selectedMove.cards.map(c => `${c.rank}${c.suit}`).join(' '),
                type: selectedMove.type,
                score: Math.round(selectionResult.scoredMoves?.[0]?.score || 0),
                reason: selectionResult.primaryReason || 'Best scoring move'
            };
        }

        return captureReasoning ? { cards: selectedMove.cards, reasoning } : selectedMove.cards;
    },

    /**
     * Get the best move using the Advanced Python PPO Bot
     * @returns {Promise<Array|Object>} - Returns Promise resolving to cards array
     */
    getAdvancedBotMove: async (hand, lastPlayedHand, isFirstTurn, gameContext = {}) => {
        const fallback = () => BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext);

        if (advancedBotWorker.isDisabled()) {
            return fallback();
        }

        let result;
        try {
            result = await advancedBotWorker.request({
                hand: hand,
                lastPlayedHand: lastPlayedHand,
                isFirstTurn: isFirstTurn,
                // Pass count
                passCount: gameContext.passCount || 0,
                // Opponent cards (Next, Across, Previous)
                opponentCardCounts: gameContext.playerCardCounts || [13, 13, 13],
                // Played cards history
                playedCards: gameContext.playedCards || [],
                // Who played last relative to us (for context reconstruction)
                lastPlayedByRelative: gameContext.lastPlayedByRelative
            });
        } catch (err) {
            console.warn('Advanced bot unavailable, falling back to legacy bot:', err.message);
            return fallback();
        }

        if (result.action === 'pass') {
            return null;
        }

        if (result.action !== 'play') {
            return fallback();
        }

        // Validate the move against our own rules engine so a hallucinated action
        // can never put the game into an illegal state.
        const moveCards = result.cards;
        const validMoves = BotLogic.getAllValidMoves(hand);

        const match = validMoves.find(m => {
            if (m.cards.length !== moveCards.length) return false;
            return m.cards.every(c =>
                moveCards.some(mc => mc.rank === c.rank && mc.suit === c.suit)
            );
        });

        if (!match) {
            console.warn('ML Bot suggested invalid move:', moveCards);
            return fallback();
        }

        return match.cards;
    },

    /**
     * Organize the hand according to "Poker First, Pairs Second" heuristic.
     * Identify "Control" (2s, As) and "Trash" (3-6 singles).
     * @param {Array} hand - The cards to organize
     * @param {Array} [precalculatedMoves] - Optional pre-calculated valid moves to avoid redundant calculation
     */
    organizeHand: (hand, precalculatedMoves = null) => {
        const remainingHand = [...hand];
        const organized = {
            fiveCardHands: [],
            pairs: [],
            singles: [],
            trash: [], // Singles 3-6
            control: [] // Aces and 2s
        };

        // 1. Identify 5-card hands first (Greedy approach)
        // We need to use BotLogic functions but manage the remaining cards

        // Helper to check if a move uses only available cards
        const isAvailable = (cards) => cards.every(c =>
            remainingHand.some(rh => rh.rank === c.rank && rh.suit === c.suit)
        );

        // Helper to remove cards
        const removeCards = (cards) => {
            cards.forEach(c => {
                const idx = remainingHand.findIndex(rh => rh.rank === c.rank && rh.suit === c.suit);
                if (idx !== -1) remainingHand.splice(idx, 1);
            });
        };

        // Get all possible 5-card moves from original hand
        // OPTIMIZATION: Use pre-calculated moves if available
        const allMoves = precalculatedMoves || BotLogic.getAllValidMoves(hand);
        const fiveCardMoves = allMoves.filter(m => m.cards.length === 5);

        // Sort by priority (Straight Flush > Quads > Full House > Flush > Straight)
        fiveCardMoves.sort((a, b) => {
            // Apply "Preservation Hierarchy" for late game/general logic
            // 1. Straight Flush / Quads (Highest)
            // 2. Boss Full House (K, A, 2)
            // 3. Ace-High (or 2-High) Flush/Straight
            // 4. Low Full House
            // 5. Other Flushes
            // 6. Other Straights (Lowest)

            const getPreservationPriority = (move) => {
                const type = move.type;

                // 1. Game Enders
                if (type === HAND_TYPES.STRAIGHT_FLUSH || type === HAND_TYPES.QUADS) return 6;

                // 2. Boss Full House (Triple is K, A, or 2)
                if (type === HAND_TYPES.FULL_HOUSE) {
                    // In a sorted Full House, the middle card (index 2) is always part of the triple
                    // e.g., AAA BB or BB AAA -> middle is A
                    const tripleRank = move.cards[2].rank;
                    if (['K', 'A', '2'].includes(tripleRank)) return 5;
                    return 3; // Low Full House
                }

                // 3. High Flush or Straight (Top card is A or 2)
                if (type === HAND_TYPES.FLUSH || type === HAND_TYPES.STRAIGHT) {
                    // Cards are sorted by value, so index 4 is the highest
                    const highRank = move.cards[4].rank;
                    if (['A', '2'].includes(highRank)) return 4;

                    if (type === HAND_TYPES.FLUSH) return 2; // Other Flush
                    return 1; // Other Straight
                }

                return 0;
            };

            const priorityA = getPreservationPriority(a);
            const priorityB = getPreservationPriority(b);

            if (priorityA !== priorityB) return priorityB - priorityA;

            const typeScoreA = FIVE_CARD_PRIORITY[a.type] || 0;
            const typeScoreB = FIVE_CARD_PRIORITY[b.type] || 0;
            if (typeScoreA !== typeScoreB) return typeScoreB - typeScoreA;
            return b.value - a.value; // Higher value preferred
        });

        // Greedily pick
        for (const move of fiveCardMoves) {
            if (isAvailable(move.cards)) {
                organized.fiveCardHands.push(move);
                removeCards(move.cards);
            }
        }

        // 2. Identify Pairs from remaining
        // We need to re-scan remaining hand for pairs
        const byRank = {};
        remainingHand.forEach(c => {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
        });

        for (const rank in byRank) {
            const cards = byRank[rank];
            // If 2, 3, or 4 cards, take pairs
            // If 3 cards (Triple), we can view it as a Pair + Single or Triple.
            // "Pairs Second" implies we prioritize pairs. A Triple contains a Pair.
            // But usually a Triple is better. The heuristic is "Pairs Second", doesn't explicitly say "Triples Third".
            // Let's assume Triples/Pairs are grouped here.

            if (cards.length === 4) {
                // Two pairs
                organized.pairs.push(Big2Rules.validateHand([cards[0], cards[1]]));
                organized.pairs.push(Big2Rules.validateHand([cards[2], cards[3]]));
                removeCards(cards); // All removed
            } else if (cards.length === 3) {
                // Triple (better than pair) or Pair + Single.
                // Let's treat as Triple for now, or just leave as "Pair + Single"?
                // The heuristic "Low Pairs/Triples" in Priority B implies Triples are good.
                // Let's store as a "Triple" type or just handle in logic.
                // For "organize", let's extract the pair and leave a single?
                // Or extract Triple? Let's extract Triple if we can.
                // But the prompt says "Pairs Second".
                // Let's stick to standard Big 2 structures.
                // If we have 3, we have a Triple.
                // For the purpose of "Trash" vs "Control", we want to know what's left.
                // Let's skip extracting pairs/triples explicitly and just say "Pairs/Triples" are non-singles.
                // But `remainingHand` needs to be processed.
            } else if (cards.length === 2) {
                organized.pairs.push(Big2Rules.validateHand(cards));
                removeCards(cards);
            }
        }

        // Re-scan for Triples/Pairs from whatever is left (e.g. from Triples above)
        // Actually, if I didn't remove Triples, they are still in remainingHand.
        // Let's identify Triples too.
         const byRank2 = {};
        remainingHand.forEach(c => {
            if (!byRank2[c.rank]) byRank2[c.rank] = [];
            byRank2[c.rank].push(c);
        });

        for (const rank in byRank2) {
             const cards = byRank2[rank];
             if (cards.length === 3) {
                 // It's a triple
                 // We can add to pairs list as a "Triple" (hacky) or just leave it?
                 // Let's remove it from singles consideration
                 removeCards(cards);
                 // We can treat it as a pair + single for "Trash" analysis?
                 // Or better: Triples are strong. Not trash.
                 // We'll add to a "triples" list (custom)
                 if (!organized.triples) organized.triples = [];
                 organized.triples.push(Big2Rules.validateHand(cards));
             }
        }

        // 3. Identify Trash and Control from Singles (remainder)
        organized.singles = remainingHand.map(c => Big2Rules.validateHand([c]));

        organized.singles.forEach(s => {
            const rank = s.rank;
            // Trash: 3, 4, 5, 6
            if (['3', '4', '5', '6'].includes(rank)) {
                organized.trash.push(s);
            }
            // Control: 2, A
            if (['2', 'A'].includes(rank)) {
                organized.control.push(s);
            }
        });

        return organized;
    },

    /**
     * Determine the current game phase based on hand size
     * @param {number} handSize - Number of cards in hand
     * @returns {string} 'early', 'mid', or 'late'
     */
    getGamePhase: (handSize) => {
        if (handSize > 9) return 'early';
        if (handSize > 5) return 'mid';
        return 'late';
    },

    /**
     * Check if we can win in one trick (play all remaining cards)
     * @param {Array} hand - Current cards in hand
     * @param {Object|null} lastPlayedHand - The hand to beat
     * @returns {Object} { canWin: boolean, move: Object|null }
     */
    canWinInOneTrick: (hand, lastPlayedHand) => {
        // If we have free play, check if all cards form a valid combination
        if (!lastPlayedHand) {
            const allCardsMove = Big2Rules.validateHand(hand);
            if (allCardsMove) {
                return { canWin: true, move: allCardsMove };
            }
        }

        // Check if we can beat the current hand with all our cards
        if (lastPlayedHand && hand.length === lastPlayedHand.cards.length) {
            const allCardsMove = Big2Rules.validateHand(hand);
            if (allCardsMove && Big2Rules.canBeat(allCardsMove, lastPlayedHand)) {
                return { canWin: true, move: allCardsMove };
            }
        }

        return { canWin: false, move: null };
    },

    /**
     * PHASE 2.2: Evaluate follow-up strength after playing a move
     * Simulates what cards remain and evaluates their playability
     * @param {Object} move - The move being considered
     * @param {Array} hand - Current hand
     * @param {Object} handOrganization - Current hand organization
     * @returns {Object} - { followUpScore: number, canLikelyWin: boolean, followUpMoves: number }
     */
    evaluateFollowUp: (move, hand, handOrganization) => {
        // Simulate remaining hand after playing this move
        const remainingCards = hand.filter(card =>
            !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
        );

        if (remainingCards.length === 0) {
            return { followUpScore: 1000, canLikelyWin: true, followUpMoves: 0 };
        }

        // Get all valid moves from remaining hand
        const followUpMoves = BotLogic.getAllValidMoves(remainingCards);
        // OPTIMIZATION: Pass pre-calculated moves to organizeHand
        const followUpOrg = BotLogic.organizeHand(remainingCards, followUpMoves);

        let followUpScore = 0;

        // Score based on follow-up strength
        // 1. Do we have strong 5-card hands remaining?
        followUpScore += followUpOrg.fiveCardHands.length * 80;

        // 2. Do we have pairs remaining?
        followUpScore += followUpOrg.pairs.length * 30;

        // 3. Do we have control cards (2s, As) remaining?
        followUpScore += followUpOrg.control.length * 40;

        // 4. How many valid moves do we have?
        const moveDensity = followUpMoves.length / Math.max(1, remainingCards.length);
        followUpScore += moveDensity * 20;

        // 5. Card count factor (fewer = closer to winning)
        if (remainingCards.length <= 3) {
            followUpScore += 100;
        } else if (remainingCards.length <= 6) {
            followUpScore += 50;
        }

        // Check if we can likely win from this position
        const canLikelyWin =
            remainingCards.length <= 2 ||
            (remainingCards.length <= 5 && followUpOrg.control.length >= 1) ||
            followUpOrg.fiveCardHands.length >= 1;

        return {
            followUpScore,
            canLikelyWin,
            followUpMoves: followUpMoves.length
        };
    },

    /**
     * PHASE 2.3: Endgame solver for hands with ≤5 cards
     * Attempts to find guaranteed winning sequence
     * @param {Array} hand - Current hand (must be ≤5 cards)
     * @param {Object|null} lastPlayedHand - Hand to beat
     * @param {Object} ctx - Game context
     * @returns {Object|null} - { move, guaranteedWin: boolean } or null if no guaranteed win
     */
    /**
     * Can any card still unaccounted for beat this move?
     *
     * Conservative: anything not in our hand and not yet played is treated as
     * being in an opponent's hand, so a true result really is forced.
     * @param {Object} move - validated hand
     * @param {Array} hand - our cards
     * @param {Array} playedCards - cards already played this round
     * @returns {boolean}
     */
    isUnbeatable: (move, hand, playedCards = []) => {
        const seen = new Set([
            ...hand.map(c => `${c.rank}${c.suit}`),
            ...playedCards.map(c => `${c.rank}${c.suit}`)
        ]);

        const outstanding = [];
        for (const rank of RANKS) {
            for (const suit of SUITS) {
                if (!seen.has(`${rank}${suit}`)) {
                    outstanding.push({ rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) });
                }
            }
        }
        if (outstanding.length === 0) return true;

        const byRank = {};
        outstanding.forEach(c => {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
        });

        if (move.type === HAND_TYPES.SINGLE) {
            return !outstanding.some(c => c.value > move.value);
        }

        if (move.type === HAND_TYPES.PAIR || move.type === HAND_TYPES.TRIPLE) {
            const need = move.cards.length;
            return !Object.values(byRank).some(cards =>
                cards.length >= need && cards.some(c => c.value > move.value));
        }

        // Five-card hands: a straight flush only loses to a higher straight
        // flush; quads lose to those plus a higher quad. Anything weaker can be
        // beaten by shapes that are impractical to enumerate here, so treat it
        // as beatable rather than risk a false "forced win".
        if (move.type === HAND_TYPES.STRAIGHT_FLUSH || move.type === HAND_TYPES.QUADS) {
            const strongerMoves = BotLogic.getAllValidMoves(outstanding)
                .filter(m => m.cards.length === 5 && Big2Rules.canBeat(m, move));
            return strongerMoves.length === 0;
        }

        return false;
    },

    solveEndgame: (hand, lastPlayedHand, ctx) => {
        if (hand.length > 5) return null;

        const { playerCardCounts } = ctx;

        // Get all valid moves
        const allMoves = BotLogic.getAllValidMoves(hand);

        // Filter candidates
        let candidates = lastPlayedHand
            ? allMoves.filter(m => Big2Rules.canBeat(m, lastPlayedHand))
            : allMoves;

        if (candidates.length === 0) return null;

        // Try to find a genuinely forced win.
        //
        // The two-move win only works if nobody can take the lead away in
        // between: we play `move`, everyone is forced to pass, we lead again
        // and play every remaining card. The second play does not need to be
        // unbeatable - emptying the hand ends the round either way - but the
        // FIRST one does. The previous version checked the second play instead
        // of the first, and additionally called any leftover pair a guaranteed
        // win, so most of its "guaranteed" claims were unfounded.
        for (const move of candidates) {
            const remainingCards = hand.filter(card =>
                !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
            );

            // If this empties our hand, we win outright.
            if (remainingCards.length === 0) {
                return { move, guaranteedWin: true, reason: 'Empties hand - instant win' };
            }

            // Everything else has to survive a round of opponents.
            if (!BotLogic.isUnbeatable(move, hand, ctx.playedCards)) continue;

            const remainingAsMove = Big2Rules.validateHand(remainingCards);
            if (remainingAsMove) {
                return {
                    move,
                    guaranteedWin: true,
                    reason: `Forced 2-move win: ${move.type} cannot be beaten, then ${remainingAsMove.type} plays out`
                };
            }
        }

        // No guaranteed win found, but return best move for endgame
        // Prefer moves that give us the most powerful remaining hand
        let bestMove = null;
        let bestRemainingPower = -Infinity;

        for (const move of candidates) {
            const remainingCards = hand.filter(card =>
                !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
            );

            // Calculate power of remaining cards
            let power = 0;

            remainingCards.forEach(card => {
                const rankIndex = RANKS.indexOf(card.rank);
                power += rankIndex * 10;

                if (card.rank === '2') power += 100;
                if (card.rank === 'A') power += 50;
            });

            // Prefer fewer cards
            power += (5 - remainingCards.length) * 30;

            // Check if remaining forms valid combo
            const remainingAsMove = Big2Rules.validateHand(remainingCards);
            if (remainingAsMove) {
                power += 200; // Big bonus for valid combo
            }

            if (power > bestRemainingPower) {
                bestRemainingPower = power;
                bestMove = move;
            }
        }

        return bestMove ? { move: bestMove, guaranteedWin: false } : null;
    },

    /**
     * How urgently we need to stop an opponent going out.
     * 0 = no pressure, 3 = the next player wins unless we block.
     * The next player matters most because they act immediately after us.
     */
    dangerLevel: (hand, ctx) => {
        const counts = ctx.playerCardCounts;
        const nextOpp = counts[0];
        const minOpp = Math.min(...counts);

        let level = 0;
        if (nextOpp <= 1) level = 3;
        else if (nextOpp <= 3) level = 2;
        else if (nextOpp <= 5) level = 1;

        if (minOpp <= 2) level = Math.max(level, 2);
        else if (minOpp <= 4) level = Math.max(level, 1);

        // If we are as close to going out as they are, racing beats blocking.
        if (hand.length <= minOpp) level = Math.max(0, level - 1);

        return level;
    },

    /**
     * What winning the current trick is worth to us.
     *
     * This is the "price of the trick" the bot pays retention cost against: a
     * card is worth spending only when the lead it buys is worth more than the
     * card. The old code expressed one hard-coded instance of this idea (never
     * spend a 2 on a 3-9 single); this generalises it to every card.
     */
    evaluateTrickValue: (hand, ctx, gamePhase) => {
        let value = TRICK_BASE_VALUE;

        const org = ctx.handOrganization;
        if (org) {
            // The lead is worth more when we have cheap cards waiting to go and
            // strong shapes to run.
            value += Math.min(3, org.trash.length) * 18;
            value += Math.min(2, org.fiveCardHands.length) * 35;
        }

        // Denying the lead to someone about to go out is worth far more than
        // the cards it costs.
        const danger = BotLogic.dangerLevel(hand, ctx);
        value += danger * danger * 45;

        if (gamePhase === 'late') value += 90;
        else if (gamePhase === 'mid') value += 30;

        return value;
    },

    /**
     * Cost of pulling cards out of combinations we were saving.
     *
     * Replaces a flat -150 "Breaks Organized Hand" penalty. The flat version
     * landed disproportionately on low cards (they sit inside straights far
     * more often than high cards do) and so actively pushed the bot toward
     * spending its high cards. Scaling by what is actually lost fixes that:
     * pulling the 3 out of a straight is cheap, pulling its Ace is not.
     */
    comboBreakPenalty: (move, handOrganization, gamePhase) => {
        if (!handOrganization) return 0;
        let penalty = 0;
        const inMove = (c) => move.cards.some(mc => mc.rank === c.rank && mc.suit === c.suit);

        for (const combo of handOrganization.fiveCardHands) {
            const pulled = combo.cards.filter(inMove);
            // Untouched, or we are playing the combo itself - nothing is lost.
            if (pulled.length === 0 || pulled.length === combo.cards.length) continue;

            const priority = FIVE_CARD_PRIORITY[combo.type] || 1;
            const highestPulled = Math.max(...pulled.map(c => RANKS.indexOf(c.rank)));
            penalty += (18 + priority * 10) * (0.5 + highestPulled / RANKS.length);
        }

        for (const pair of handOrganization.pairs) {
            const used = pair.cards.filter(inMove).length;
            if (used === 1) {
                penalty += 20 + (RANK_RETENTION_COST[pair.rank] || 0) * 0.25;
            }
        }

        for (const triple of (handOrganization.triples || [])) {
            const used = triple.cards.filter(inMove).length;
            if (used > 0 && used < 3) {
                penalty += 25 + (RANK_RETENTION_COST[triple.rank] || 0) * 0.3;
            }
        }

        // Shapes matter less once we are just trying to empty our hand.
        return penalty * (gamePhase === 'late' ? 0.35 : 1);
    },

    /**
     * Score a move played as a LEAD (free play).
     */
    scoreLeadMove: (move, hand, ctx, gamePhase, captureReasoning = false) => {
        const factors = captureReasoning ? [] : null;
        const isWin = move.cards.length === hand.length;
        if (isWin) {
            return { move, score: 1e6, factors: captureReasoning ? [{ factor: 'Plays out - wins the round', points: 1e6 }] : null };
        }

        const shed = move.cards.length * SHED_VALUE_PER_CARD;
        const cost = moveRetentionCost(move, gamePhase);
        const broken = BotLogic.comboBreakPenalty(move, ctx.handOrganization, gamePhase);

        let score = shed - cost - broken;
        if (factors) {
            factors.push({ factor: `Sheds ${move.cards.length}`, points: shed });
            factors.push({ factor: 'Card retention cost', points: -Math.round(cost) });
            if (broken) factors.push({ factor: 'Breaks a saved combination', points: -Math.round(broken) });
        }

        // Five-card hands are the cheapest way to unload volume and the hardest
        // shape for opponents to answer.
        if (FIVE_CARD_PRIORITY[move.type]) {
            score += 60;
            if (factors) factors.push({ factor: 'Leads a five-card hand', points: 60 });
        } else if (move.type === HAND_TYPES.PAIR || move.type === HAND_TYPES.TRIPLE) {
            score += 25;
            if (factors) factors.push({ factor: 'Leads a pair/triple', points: 25 });
        }

        // Prefer leads we can follow up on.
        if (hand.length > 5) {
            const followUp = BotLogic.evaluateFollowUp(move, hand, ctx.handOrganization);
            const bonus = Math.min(90, followUp.followUpScore / 4);
            score += bonus;
            if (factors) factors.push({ factor: 'Follow-up strength', points: Math.round(bonus) });
            if (followUp.followUpMoves < 3 && hand.length > 7) {
                score -= 60;
                if (factors) factors.push({ factor: 'Leaves few options', points: -60 });
            }
        }

        // Under pressure, lead something they cannot answer rather than
        // something cheap. Expressed through hold probability so it does not
        // need to hard-code which ranks count as "high".
        const danger = BotLogic.dangerLevel(hand, ctx);
        if (danger >= 2) {
            const holdProb = BotLogic.estimateControlProbability(move, hand, ctx);
            const bonus = danger * 55 * holdProb * (ctx.profile ? ctx.profile.aggression : 1);
            score += bonus;
            if (factors) factors.push({ factor: `Blocking lead (danger ${danger})`, points: Math.round(bonus) });
        }

        // Opponents who have shown they cannot answer a shape are worth probing.
        const weakness = ctx.passInference;
        if (weakness && weakness.confidence > 0) {
            if (weakness.opponentsWeakInSingles && move.type === HAND_TYPES.SINGLE) {
                const bonus = Math.round(weakness.confidence * 70);
                score += bonus;
                if (factors) factors.push({ factor: 'Opponents weak in singles', points: bonus });
            }
            if (weakness.opponentsWeakInPairs && move.type === HAND_TYPES.PAIR) {
                const bonus = Math.round(weakness.confidence * 60);
                score += bonus;
                if (factors) factors.push({ factor: 'Opponents weak in pairs', points: bonus });
            }
            if (weakness.opponentsWeakInFiveCards && FIVE_CARD_PRIORITY[move.type]) {
                score -= 45;
                if (factors) factors.push({ factor: 'Hold five-card hand - opponents cannot answer it', points: -45 });
            }
        }

        return { move, score, factors };
    },

    /**
     * Score a move played as a RESPONSE to a live pile.
     *
     * The decisive term is retention cost versus the value of the trick. This
     * is what stops the bot answering a 7 with a King while holding an 8: the
     * King costs ~78 to give up and the 8 costs ~14, a gap far larger than any
     * bonus in this function.
     */
    scoreResponseMove: (move, hand, ctx, gamePhase, trickValue, captureReasoning = false) => {
        const factors = captureReasoning ? [] : null;
        const isWin = move.cards.length === hand.length;
        if (isWin) {
            return { move, score: 1e6, factors: captureReasoning ? [{ factor: 'Plays out - wins the round', points: 1e6 }] : null };
        }

        const shed = move.cards.length * SHED_VALUE_PER_CARD;
        const cost = moveRetentionCost(move, gamePhase);
        const broken = BotLogic.comboBreakPenalty(move, ctx.handOrganization, gamePhase);

        let score = shed - cost - broken;
        if (factors) {
            factors.push({ factor: `Sheds ${move.cards.length}`, points: shed });
            factors.push({ factor: 'Card retention cost', points: -Math.round(cost) });
            if (broken) factors.push({ factor: 'Breaks a saved combination', points: -Math.round(broken) });
        }

        // What we stand to gain if this play holds up and we take the lead.
        const holdProb = BotLogic.estimateControlProbability(move, hand, ctx);
        const controlGain = trickValue * holdProb;
        score += controlGain;
        if (factors) {
            factors.push({ factor: `Trick value x ${(holdProb * 100).toFixed(0)}% hold`, points: Math.round(controlGain) });
        }

        // With an opponent about to go out, taking the trick matters more than
        // the card it costs.
        const danger = BotLogic.dangerLevel(hand, ctx);
        if (danger >= 2) {
            const bonus = danger * 45 * holdProb * (ctx.profile ? ctx.profile.aggression : 1);
            score += bonus;
            if (factors) factors.push({ factor: `Must not concede (danger ${danger})`, points: Math.round(bonus) });
        }

        return { move, score, factors };
    },

    /**
     * Determine if we should pass even though we can play.
     *
     * Generalises the old "don't waste a 2 on a 3-9 single" rule: pass whenever
     * no legal response is worth its retention cost, measured against what the
     * trick is actually worth to us right now.
     */
    shouldStrategicPass: (candidates, hand, lastPlayedHand, ctx, captureReasoning = false) => {
        const factors = captureReasoning ? [] : null;
        const result = (shouldPass, reason = null) =>
            captureReasoning ? { shouldPass, factors, reason } : shouldPass;

        // Nothing to pass on.
        if (!lastPlayedHand) return result(false);

        // Never pass up the round.
        if (candidates.some(m => m.cards.length === hand.length)) {
            if (factors) factors.push({ factor: 'Winning move available - never pass', points: 0 });
            return result(false);
        }

        // The next player is one card from going out; anything is better than
        // handing them the lead.
        if (ctx.playerCardCounts[0] <= 1) {
            if (factors) factors.push({ factor: 'Next player has 1 card - must contest', points: 0 });
            return result(false, 'Must try to stop the next player');
        }

        const gamePhase = BotLogic.getGamePhase(hand.length);
        const trickValue = BotLogic.evaluateTrickValue(hand, ctx, gamePhase);

        // Score every legal response and keep the results for selectBestMove,
        // which would otherwise repeat the same work.
        const scored = candidates.map(m =>
            BotLogic.scoreResponseMove(m, hand, ctx, gamePhase, trickValue, captureReasoning));
        scored.sort((a, b) => b.score - a.score);
        ctx._scoredResponses = scored;
        ctx._trickValue = trickValue;

        const best = scored[0];

        // Down to a handful of cards, sitting out a trick is usually worse than
        // any card it saves - we need the tempo to go out.
        if (hand.length <= 4 || gamePhase === 'late') return result(false);

        // A small negative band rather than zero, so the bot does not become
        // passive over marginal trades. A patient bot demands a better price.
        const PASS_THRESHOLD = -12 * (ctx.profile ? ctx.profile.patience : 1);
        if (best.score < PASS_THRESHOLD) {
            const cheapest = best.move.cards.map(c => `${c.rank}${c.suit}`).join(' ');
            if (factors) {
                factors.push({
                    factor: `Cheapest response (${cheapest}) costs more than the trick is worth`,
                    points: Math.round(best.score)
                });
            }
            return result(true, `Price of the trick too high (best response scores ${Math.round(best.score)})`);
        }

        return result(false);
    },

    /**
     * Choose among the top-scoring moves.
     *
     * With no profile this is a plain argmax, so tests and the benchmark stay
     * deterministic. Given a profile it samples from moves within a small
     * window of the best, which is what stops four bots at one table playing
     * like one bot.
     */
    pickScoredMove: (scoredMoves, ctx) => {
        const profile = ctx.profile;
        if (!profile || !profile.variability) return scoredMoves[0];

        const best = scoredMoves[0].score;
        // Never gamble on a move that is meaningfully worse, and never on a
        // forced or winning play.
        if (best >= 1e6) return scoredMoves[0];

        const window = 30 * profile.variability;
        const pool = scoredMoves.filter(sm => best - sm.score <= window);
        if (pool.length <= 1) return scoredMoves[0];

        const temperature = Math.max(1, window / 2);
        const weights = pool.map(sm => Math.exp((sm.score - best) / temperature));
        const total = weights.reduce((a, b) => a + b, 0);
        const rng = ctx.rng || Math.random;

        let r = rng() * total;
        for (let i = 0; i < pool.length; i++) {
            r -= weights[i];
            if (r <= 0) return pool[i];
        }
        return pool[0];
    },

    /**
     * Select the best move using strategic considerations.
     */
    selectBestMove: (candidates, hand, lastPlayedHand, isFirstTurn, ctx = {}, captureReasoning = false) => {
        const gamePhase = BotLogic.getGamePhase(hand.length);

        const finish = (move, scoredMoves, primaryReason) => {
            if (!captureReasoning) return move;
            return { move, scoredMoves, primaryReason };
        };

        // Win outright if we can.
        const winCheck = BotLogic.canWinInOneTrick(hand, lastPlayedHand);
        if (winCheck.canWin) {
            return finish(
                winCheck.move,
                [{ move: winCheck.move, score: 1e6, factors: [{ factor: 'ONE-TRICK WIN!', points: 1e6 }] }],
                'Can play every remaining card this turn'
            );
        }

        // Emergency: the next player goes out unless we take this trick away.
        // Worth overriding the cost model outright.
        if (ctx.playerCardCounts[0] === 1) {
            const multi = candidates.filter(m => m.type !== HAND_TYPES.SINGLE);
            const pool = (!lastPlayedHand && multi.length) ? multi : candidates;
            const pick = (!lastPlayedHand && multi.length)
                ? pool.reduce((best, m) => (m.value < best.value ? m : best))   // cheapest shape they must beat
                : pool.reduce((best, m) => (m.value > best.value ? m : best));  // highest card available
            return finish(
                pick,
                [{ move: pick, score: 5e4, factors: [{ factor: 'EMERGENCY: next player has 1 card', points: 5e4 }] }],
                'Next player has one card - blocking'
            );
        }

        // Endgame solver takes over once the hand is small enough to read out.
        if (hand.length <= 5) {
            const endgame = BotLogic.solveEndgame(hand, lastPlayedHand, ctx);
            if (endgame) {
                const score = endgame.guaranteedWin ? 999000 : 800;
                return finish(
                    endgame.move,
                    [{
                        move: endgame.move,
                        score,
                        factors: [{ factor: endgame.guaranteedWin ? 'ENDGAME: forced win' : 'Endgame: optimal', points: score }]
                    }],
                    endgame.reason || 'Endgame optimal play'
                );
            }
        }

        // Scoring is the expensive part, so cap how many candidates reach it.
        // Keep both ends of the range: the cheapest moves for shedding and the
        // strongest for forcing a pass.
        let candidatesToScore = candidates;
        if (candidates.length > 30) {
            const sorted = [...candidates].sort((a, b) => a.value - b.value);
            const seen = new Set();
            candidatesToScore = [...sorted.slice(0, 15), ...sorted.slice(-15)].filter(m => {
                const key = m.cards.map(c => `${c.rank}${c.suit}`).join(',');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        let scoredMoves;
        if (lastPlayedHand) {
            // shouldStrategicPass already scored these; reuse unless the
            // candidate set was trimmed differently.
            if (ctx._scoredResponses && ctx._scoredResponses.length === candidates.length) {
                scoredMoves = ctx._scoredResponses;
            } else {
                const trickValue = ctx._trickValue != null
                    ? ctx._trickValue
                    : BotLogic.evaluateTrickValue(hand, ctx, gamePhase);
                scoredMoves = candidatesToScore.map(m =>
                    BotLogic.scoreResponseMove(m, hand, ctx, gamePhase, trickValue, captureReasoning));
                scoredMoves.sort((a, b) => b.score - a.score);
            }
        } else {
            scoredMoves = candidatesToScore.map(m =>
                BotLogic.scoreLeadMove(m, hand, ctx, gamePhase, captureReasoning));
            scoredMoves.sort((a, b) => b.score - a.score);
        }

        const chosen = BotLogic.pickScoredMove(scoredMoves, ctx);

        if (captureReasoning) {
            let primaryReason = 'Best score';
            const chosenEntry = scoredMoves.find(sm => sm.move === chosen.move) || scoredMoves[0];
            if (chosenEntry.factors && chosenEntry.factors.length > 0) {
                primaryReason = chosenEntry.factors.reduce((prev, curr) =>
                    Math.abs(curr.points) > Math.abs(prev.points) ? curr : prev
                ).factor;
            }
            return { move: chosen.move, scoredMoves, primaryReason };
        }

        return chosen.move;
    },

    /**
     * Analyze played cards
     */
    analyzePlayedCards: (hand, playedCards) => {
        // Track all 52 cards
        const allCards = {};
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                const key = `${rank}${suit}`;
                allCards[key] = 'unknown'; // unknown, played, in_hand
            }
        }

        // Mark cards in our hand
        for (const card of hand) {
            allCards[`${card.rank}${card.suit}`] = 'in_hand';
        }

        // Mark played cards
        for (const card of playedCards) {
            allCards[`${card.rank}${card.suit}`] = 'played';
        }

        // Calculate what's still out there
        const analysis = {
            twosOutstanding: 0,
            twosInHand: 0,
            highestOutstanding: null,
            weHaveHighest: false
        };

        // Find outstanding cards
        let highestOutstandingValue = -1;
        let highestInHandValue = -1;

        for (const key in allCards) {
            const rank = key.slice(0, -1);
            const suit = key.slice(-1);
            const value = RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit);

            if (allCards[key] === 'unknown') {
                if (rank === '2') analysis.twosOutstanding++;
                if (value > highestOutstandingValue) {
                    highestOutstandingValue = value;
                    analysis.highestOutstanding = { rank, suit, value };
                }
            } else if (allCards[key] === 'in_hand') {
                if (rank === '2') analysis.twosInHand++;
                if (value > highestInHandValue) {
                    highestInHandValue = value;
                }
            }
        }

        analysis.weHaveHighest = highestInHandValue >= highestOutstandingValue;
        return analysis;
    },

    /**
     * PHASE 2.1: Create opponent hand model for tracking probabilities
     * @param {number} opponentIndex - Index of opponent (0=next, 1=across, 2=previous)
     * @param {number} cardCount - Number of cards opponent has
     * @returns {Object} - Opponent model
     */
    createOpponentModel: (opponentIndex, cardCount) => {
        return {
            index: opponentIndex,
            cardCount: cardCount,
            possibleCards: new Set([...Array(52).keys()]), // All cards possible initially
            unlikelyCards: new Set(), // Cards they probably don't have
            likelyHasPairs: 0.33, // Probability they have pairs
            likelyHas2s: 0.25, // Probability they have 2s (4 2s / 52 cards / 4 players)
            likelyHasFiveCardHands: 0.2,
            passHistory: [], // What they passed on
            playHistory: [], // What they played
            aggressionScore: 0.5, // 0=passive, 1=aggressive
            lastAction: null,
            // Rank index of the lowest single they declined to beat. Bounds what
            // they can answer - unless they have shown they pass strategically.
            minSinglePassed: null,
            maxSinglePlayed: -1,
            strategicPasser: false
        };
    },

    /**
     * Replay a round's play history into one model per opponent.
     * @param {Array} playHistory - [{ relative: 1|2|3, action, hand }]
     * @param {Array} playerCardCounts - [next, across, previous]
     * @param {Array} myHand - our cards
     * @param {Array} playedCards - all cards played this round
     * @returns {Array} three models, indexed 0=next, 1=across, 2=previous
     */
    buildOpponentModels: (playHistory, playerCardCounts, myHand, playedCards) => {
        const models = [0, 1, 2].map(i => BotLogic.createOpponentModel(i, playerCardCounts[i]));

        for (const entry of playHistory || []) {
            const idx = entry.relative - 1;
            if (idx < 0 || idx > 2 || !entry.hand) continue;
            BotLogic.updateOpponentModel(models[idx], entry.action, entry.hand, myHand, playedCards);
        }

        return models;
    },

    /**
     * Read opponent weaknesses out of their models.
     *
     * A player who declined to beat a 9 cannot hold a higher single they were
     * willing to spend. That read is only trustworthy until they show they are
     * capable of passing on a card they could have beaten - after that we stop
     * believing their passes, the same way a human would.
     */
    inferFromHistory: (opponentModels) => {
        const inference = {
            opponentsLikelyWeak: false,
            opponentsWeakInSingles: false,
            opponentsWeakInPairs: false,
            opponentsWeakInFiveCards: false,
            confidence: 0,
            singlesCeiling: null   // rank index nobody credibly beats
        };

        if (!opponentModels || !opponentModels.length) return inference;

        let singlesPassers = 0, pairPassers = 0, fivePassers = 0, trusted = 0;
        let ceiling = null;

        for (const model of opponentModels) {
            if (model.cardCount === 0) continue;

            if (model.minSinglePassed !== null && !model.strategicPasser) {
                trusted++;
                if (model.minSinglePassed < 9) singlesPassers++;
                ceiling = ceiling === null ? model.minSinglePassed : Math.max(ceiling, model.minSinglePassed);
            }
            if (model.passHistory.some(h => h.type === HAND_TYPES.PAIR)) pairPassers++;
            if (model.passHistory.some(h => FIVE_CARD_PRIORITY[h.type])) fivePassers++;
        }

        // Only a ceiling every live opponent has demonstrated is worth acting on.
        const liveOpponents = opponentModels.filter(m => m.cardCount > 0).length;
        if (trusted >= liveOpponents && liveOpponents > 0 && ceiling !== null) {
            inference.singlesCeiling = ceiling;
        }

        if (singlesPassers >= 2) {
            inference.opponentsWeakInSingles = true;
            inference.opponentsLikelyWeak = true;
            inference.confidence = Math.max(inference.confidence, singlesPassers >= 3 ? 0.8 : 0.6);
        } else if (singlesPassers === 1) {
            inference.confidence = Math.max(inference.confidence, 0.3);
        }

        if (pairPassers >= 2) {
            inference.opponentsWeakInPairs = true;
            inference.opponentsLikelyWeak = true;
            inference.confidence = Math.max(inference.confidence, 0.6);
        }

        if (fivePassers >= 2) {
            inference.opponentsWeakInFiveCards = true;
            inference.confidence = Math.max(inference.confidence, 0.7);
        }

        return inference;
    },

    /**
     * Per-bot temperament, derived from the bot's name so a given bot behaves
     * consistently within and across games while differing from its neighbours.
     * @param {string} name
     * @returns {Object} { variability, patience, aggression }
     */
    getBotProfile: (name) => {
        const text = String(name || '');
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (Math.imul(hash, 31) + text.charCodeAt(i)) >>> 0;
        }

        // Avalanche (murmur3 finalizer). Bots are named "Bot 1".."Bot 4", which
        // differ in a single low-order character; without mixing, that
        // difference never reaches the upper bytes and every bot at the table
        // ends up with the same temperament.
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;
        hash >>>= 0;

        const spread = (offset, min, max) =>
            min + (((hash >>> offset) & 0xff) / 255) * (max - min);

        return {
            // How far below the best-scoring move this bot will wander.
            variability: spread(0, 0.4, 1.3),
            // Multiplies the price a trick has to clear before it will contest.
            patience: spread(8, 0.8, 1.25),
            // Multiplies how hard it pushes when an opponent is running low.
            aggression: spread(16, 0.85, 1.2)
        };
    },

    /**
     * PHASE 2.1: Update opponent model based on their action
     * @param {Object} model - Opponent model
     * @param {string} action - 'play' or 'pass'
     * @param {Object} hand - The hand they played (if action=play) or passed on (if action=pass)
     * @param {Array} myHand - Our current hand
     * @param {Array} playedCards - All played cards
     */
    updateOpponentModel: (model, action, hand, myHand, playedCards) => {
        model.lastAction = action;

        if (action === 'pass') {
            model.passHistory.push(hand);

            // Update probabilities based on what they passed on
            if (hand.type === HAND_TYPES.SINGLE) {
                const rankIndex = RANKS.indexOf(hand.cards[0].rank);

                // The lowest single they have declined bounds what they can beat.
                model.minSinglePassed = model.minSinglePassed === null
                    ? rankIndex
                    : Math.min(model.minSinglePassed, rankIndex);

                // They likely don't have higher singles
                // Remove cards higher than what they passed on (with 70% confidence)
                for (let r = rankIndex + 1; r < RANKS.length; r++) {
                    for (let s = 0; s < 4; s++) {
                        const cardValue = r * 4 + s;
                        const cardRank = RANKS[r];
                        const cardSuit = SUITS[s];

                        // Don't eliminate if in our hand or already played
                        const inOurHand = myHand.some(c => c.rank === cardRank && c.suit === cardSuit);
                        const wasPlayed = playedCards.some(c => c.rank === cardRank && c.suit === cardSuit);

                        if (!inOurHand && !wasPlayed) {
                            model.unlikelyCards.add(cardValue);
                        }
                    }
                }

                // Increase pair probability (they might be holding combos)
                model.likelyHasPairs = Math.min(0.9, model.likelyHasPairs + 0.1);

            } else if (hand.type === HAND_TYPES.PAIR) {
                // They likely don't have higher pairs
                model.likelyHasPairs = Math.max(0.1, model.likelyHasPairs - 0.1);

            } else if ([HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH, HAND_TYPES.FULL_HOUSE].includes(hand.type)) {
                // They likely don't have 5-card hands
                model.likelyHasFiveCardHands = Math.max(0.05, model.likelyHasFiveCardHands - 0.2);
            }

            // Passing is less aggressive
            model.aggressionScore = Math.max(0, model.aggressionScore - 0.05);

        } else if (action === 'play') {
            model.playHistory.push(hand);

            // Update based on what they played
            if (hand.cards) {
                if (hand.type === HAND_TYPES.SINGLE) {
                    const rankIndex = RANKS.indexOf(hand.cards[0].rank);
                    model.maxSinglePlayed = Math.max(model.maxSinglePlayed, rankIndex);
                    // They passed on something lower than a card they were
                    // holding all along - their passes no longer bound them.
                    if (model.minSinglePassed !== null && rankIndex > model.minSinglePassed) {
                        model.strategicPasser = true;
                    }
                }

                // Remove played cards from possible cards
                hand.cards.forEach(card => {
                    const cardValue = RANKS.indexOf(card.rank) * 4 + SUITS.indexOf(card.suit);
                    model.possibleCards.delete(cardValue);
                });

                // If they played a 2
                if (hand.cards.some(c => c.rank === '2')) {
                    model.likelyHas2s = Math.max(0, model.likelyHas2s - 0.25);
                }

                // If they played a 5-card hand
                if (hand.cards.length === 5) {
                    model.likelyHasFiveCardHands = Math.max(0, model.likelyHasFiveCardHands - 0.3);
                }

                // If they played a pair
                if (hand.type === HAND_TYPES.PAIR) {
                    model.likelyHasPairs = Math.max(0, model.likelyHasPairs - 0.15);
                }
            }

            // Playing is more aggressive
            model.aggressionScore = Math.min(1, model.aggressionScore + 0.05);
        }
    },

    /**
     * PHASE 3.1: Estimate probability of regaining control after this move
     * @param {Object} move - The move being considered
     * @param {Array} hand - Current hand
     * @param {Object} ctx - Game context
     * @returns {number} - Probability (0-1)
     */
    estimateControlProbability: (move, hand, ctx) => {
        const { playerCardCounts, cardAnalysis, passInference } = ctx;

        let probability = 0.5; // Base 50%

        // Factor 1: Move strength
        // Higher cards = more likely everyone passes
        if (move.type === HAND_TYPES.SINGLE) {
            const rankIndex = RANKS.indexOf(move.cards[0].rank);
            if (rankIndex >= 11) probability += 0.3; // A or 2
            else if (rankIndex >= 9) probability += 0.15; // K or Q
            else if (rankIndex <= 4) probability -= 0.2; // Low card
        } else if (FIVE_CARD_PRIORITY[move.type]) {
            // 5-card hands are harder to beat
            const typePriority = FIVE_CARD_PRIORITY[move.type];
            probability += typePriority * 0.1;
        }

        // Factor 2: Opponent weakness inference
        if (passInference && passInference.opponentsLikelyWeak) {
            probability += passInference.confidence * 0.2;
        }

        // Factor 2b: A single above the ceiling every opponent has demonstrated
        // is very likely to stand up. This is the payoff for tracking passes
        // across trick boundaries.
        if (move.type === HAND_TYPES.SINGLE && passInference && passInference.singlesCeiling !== null
            && passInference.singlesCeiling !== undefined) {
            if (RANKS.indexOf(move.cards[0].rank) > passInference.singlesCeiling) {
                probability += 0.35;
            }
        }

        // Factor 3: Card counting
        // If we have the highest outstanding card, very likely to regain control
        if (cardAnalysis && cardAnalysis.weHaveHighest) {
            probability += 0.3;
        }

        // Factor 4: Opponent card counts
        // If opponents have many cards, less likely to have strong responses
        const avgOpponentCards = playerCardCounts.reduce((a, b) => a + b, 0) / 3;
        if (avgOpponentCards >= 10) {
            probability += 0.1;
        }

        return Math.min(1.0, Math.max(0.0, probability));
    },

    // Helpers
    getAllValidMoves: (hand) => {
        const moves = [];
        const byRank = {};
        const bySuit = {};
        hand.forEach(c => {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        });

        // Singles
        for (const card of hand) moves.push(Big2Rules.validateHand([card]));

        // Pairs
        for (const rank in byRank) {
            const cards = byRank[rank];
            if (cards.length >= 2) {
                // OPTIMIZATION: Limit pair generation
                // For 2 cards: 1 combo, for 3: 3 combos, for 4: 6 combos
                // Only generate all if <= 3 cards, otherwise pick strategic ones
                if (cards.length <= 3) {
                    for (let i = 0; i < cards.length; i++) {
                        for (let j = i + 1; j < cards.length; j++) {
                            moves.push(Big2Rules.validateHand([cards[i], cards[j]]));
                        }
                    }
                } else {
                    // 4 cards: pick lowest and highest pairs
                    moves.push(Big2Rules.validateHand([cards[0], cards[1]])); // Lowest
                    moves.push(Big2Rules.validateHand([cards[2], cards[3]])); // Highest
                }
            }
        }

        // Triples
        for (const rank in byRank) {
            const cards = byRank[rank];
            if (cards.length >= 3) {
                // OPTIMIZATION: For 3 cards = 1 combo, for 4 cards = 4 combos
                // Just use the direct triple or pick strategic ones
                if (cards.length === 3) {
                    moves.push(Big2Rules.validateHand(cards));
                } else {
                    // 4 cards: pick lowest triple and highest triple
                    moves.push(Big2Rules.validateHand([cards[0], cards[1], cards[2]])); // Lowest
                    moves.push(Big2Rules.validateHand([cards[1], cards[2], cards[3]])); // Highest
                }
            }
        }

        // 5-card hands
        if (hand.length >= 5) {
            const straights = BotLogic.findAllStraights(hand, byRank);
            straights.forEach(s => { const v = Big2Rules.validateHand(s); if(v) moves.push(v); });

            for (const suit in bySuit) {
                if (bySuit[suit].length >= 5) {
                    // OPTIMIZATION: Limit flush combinations
                    // Instead of all C(n,5) combinations, pick strategic ones
                    const suitCards = bySuit[suit].sort((a, b) => a.value - b.value);

                    if (suitCards.length <= 6) {
                        // For 5-6 cards, generate all (manageable: 1-6 combos)
                        const flushes = BotLogic.getCombinations(suitCards, 5);
                        flushes.forEach(f => {
                            const v = Big2Rules.validateHand(f);
                            if(v && v.type === HAND_TYPES.FLUSH) moves.push(v);
                        });
                    } else {
                        // For 7+ cards, pick strategic representatives:
                        // 1. Lowest 5 (shed trash)
                        // 2. Highest 5 (strongest flush)
                        // 3. Middle representative (if hand is large)
                        const lowest5 = suitCards.slice(0, 5);
                        const highest5 = suitCards.slice(-5);

                        const v1 = Big2Rules.validateHand(lowest5);
                        if (v1 && v1.type === HAND_TYPES.FLUSH) moves.push(v1);

                        const v2 = Big2Rules.validateHand(highest5);
                        if (v2 && v2.type === HAND_TYPES.FLUSH) moves.push(v2);

                        // Add one middle option if we have 9+ cards
                        if (suitCards.length >= 9) {
                            const mid = Math.floor(suitCards.length / 2);
                            const middle5 = suitCards.slice(mid - 2, mid + 3);
                            const v3 = Big2Rules.validateHand(middle5);
                            if (v3 && v3.type === HAND_TYPES.FLUSH) moves.push(v3);
                        }
                    }
                }
            }

            const fullHouses = BotLogic.findAllFullHouses(hand, byRank);
            fullHouses.forEach(fh => { const v = Big2Rules.validateHand(fh); if(v) moves.push(v); });

            const quads = BotLogic.findAllQuads(hand, byRank);
            quads.forEach(q => { const v = Big2Rules.validateHand(q); if(v) moves.push(v); });
        }

        return moves.filter(m => m !== null);
    },

    findAllStraights: (hand, byRank) => {
        const straights = [];
        // Wheel A-2-3-4-5
        if (['A','2','3','4','5'].every(r => byRank[r]?.length))
            straights.push(...BotLogic.getStraightCombinations(['A','2','3','4','5'], byRank));
        // 2-3-4-5-6
        if (['2','3','4','5','6'].every(r => byRank[r]?.length))
            straights.push(...BotLogic.getStraightCombinations(['2','3','4','5','6'], byRank));

        // Standard
        for (let i = 0; i <= 7; i++) {
            const ranks = RANKS.slice(i, i+5);
            if (!ranks.includes('2') && ranks.every(r => byRank[r]?.length)) {
                straights.push(...BotLogic.getStraightCombinations(ranks, byRank));
            }
        }
        return straights;
    },

    getStraightCombinations: (ranks, byRank) => {
        const combinations = [];
        const cardOptions = ranks.map(r => byRank[r] || []);

        // OPTIMIZATION: Instead of generating ALL combinations (exponential),
        // generate only strategic representatives:
        // 1. Lowest value (shed trash cards)
        // 2. Highest value (strongest straight)
        // This reduces from O(k^5) to O(1) combinations per straight pattern

        // Build lowest combination (prefer lowest suits)
        const lowest = cardOptions.map(options =>
            options.reduce((best, curr) => curr.value < best.value ? curr : best)
        );
        combinations.push(lowest);

        // Build highest combination (prefer highest suits)
        const highest = cardOptions.map(options =>
            options.reduce((best, curr) => curr.value > best.value ? curr : best)
        );

        // Only add if different from lowest
        const isSame = lowest.every((card, idx) =>
            card.rank === highest[idx].rank && card.suit === highest[idx].suit
        );
        if (!isSame) {
            combinations.push(highest);
        }

        return combinations;
    },

    findAllFullHouses: (hand, byRank) => {
        const fullHouses = [];
        const triples = Object.keys(byRank).filter(r => byRank[r].length >= 3);
        const pairs = Object.keys(byRank).filter(r => byRank[r].length >= 2);

        // OPTIMIZATION: Instead of generating ALL combinations, pick strategic ones:
        // - Lowest value triple + pair (shed low cards)
        // - Highest value triple + pair (strongest full house)
        // IMPORTANT: Avoid using 2s in pairs when lower alternatives exist
        // This reduces from O(T×C(3,3)×P×C(2,2)) to O(T×P)

        // Sort pairs by rank value to prioritize non-2 pairs
        const pairsSorted = pairs.sort((a, b) => {
            // Strongly deprioritize 2s - put them at the end
            if (a === '2' && b !== '2') return 1;
            if (b === '2' && a !== '2') return -1;
            // Otherwise sort by rank index (lower first)
            return RANKS.indexOf(a) - RANKS.indexOf(b);
        });

        triples.forEach(tRank => {
            const tripleCards = byRank[tRank];

            // Pick lowest 3 cards for triple (if exactly 3) or generate both options (if 4)
            const tripleCombos = tripleCards.length === 3
                ? [tripleCards]
                : [tripleCards.slice(0, 3), [tripleCards[0], tripleCards[1], tripleCards[3]]];

            tripleCombos.forEach(triple => {
                // Track if we've added a full house for this triple already
                let addedLowFullHouse = false;

                pairsSorted.forEach(pRank => {
                    if (pRank !== tRank) {
                        const pairCards = byRank[pRank];

                        // CRITICAL FIX: Skip using 2s as pairs if we have other pair options
                        // Only use 2s if this is the ONLY pair available for this triple
                        if (pRank === '2' && !addedLowFullHouse && pairsSorted.filter(p => p !== tRank && p !== '2').length > 0) {
                            // Skip 2s if we have other pair choices
                            return;
                        }

                        // Pick lowest 2 cards for pair
                        const pair = pairCards.slice(0, 2);
                        fullHouses.push([...triple, ...pair]);
                        addedLowFullHouse = true;

                        // If more than 2 cards available, also add highest pair
                        // BUT: Never add high pair if it's 2s (too valuable)
                        if (pairCards.length > 2 && pRank !== '2') {
                            const highPair = pairCards.slice(-2);
                            const isSame = pair[0].suit === highPair[0].suit && pair[1].suit === highPair[1].suit;
                            if (!isSame) {
                                fullHouses.push([...triple, ...highPair]);
                            }
                        }
                    }
                });
            });
        });
        return fullHouses;
    },

    findAllQuads: (hand, byRank) => {
        const quads = [];
        Object.keys(byRank).filter(r => byRank[r].length === 4).forEach(rank => {
            const quadCards = byRank[rank];
            hand.forEach(card => {
                if (card.rank !== rank) quads.push([...quadCards, card]);
            });
        });
        return quads;
    },

    getCombinations: (arr, k) => {
        if (k > arr.length) return [];
        if (k === arr.length) return [arr];
        if (k === 1) return arr.map(x => [x]);
        const res = [];
        const combine = (start, combo) => {
            if (combo.length === k) { res.push([...combo]); return; }
            for (let i = start; i < arr.length; i++) {
                combo.push(arr[i]);
                combine(i + 1, combo);
                combo.pop();
            }
        };
        combine(0, []);
        return res;
    }
};

/**
 * Generation of the heuristic bot, recorded on every logged game so a model
 * trained later can tell which opponent it was actually facing.
 *
 * Bump whenever a change to this file or to BotContext.js alters what the bot
 * plays -- new or retuned heuristics, changed scoring constants, changed
 * profile sampling. Not for comments or pure refactors, though
 * test/versionPins.test.js will still ask, because it cannot tell the
 * difference and a human can.
 *
 * This has moved roughly ten times already ("Rework bot heuristics around a
 * single scoring currency", the run of fix(bot) penalty commits). Those
 * generations are not backfillable, so 1 means "as of the first logged game",
 * not "the first version of this bot".
 *
 * Changelog:
 *   1 - as of the first logged game.
 */
const BOT_LOGIC_VERSION = 1;

/**
 * Which PPO checkpoint the advanced bot loads. Recorded per seat so a corpus
 * spanning a checkpoint swap stays interpretable -- once a second checkpoint
 * exists, games logged before it are otherwise ambiguous forever.
 */
const PPO_CHECKPOINT = 'modelParameters136500';
const PPO_CHECKPOINT_GEN = 136500; // training step, a natural generation number

module.exports = { BotLogic, BOT_LOGIC_VERSION, PPO_CHECKPOINT, PPO_CHECKPOINT_GEN };
