// server/game/BotLogic.js
const { Big2Rules, HAND_TYPES } = require('./Big2Rules');
const { RANKS, SUITS } = require('./Deck');
const { spawn } = require('child_process');
const path = require('path');

// Hand type priorities for 5-card hands (higher = stronger)
const FIVE_CARD_PRIORITY = {
    [HAND_TYPES.STRAIGHT]: 1,
    [HAND_TYPES.FLUSH]: 2,
    [HAND_TYPES.FULL_HOUSE]: 3,
    [HAND_TYPES.QUADS]: 4,
    [HAND_TYPES.STRAIGHT_FLUSH]: 5
};

const BotLogic = {
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
            playedCards: gameContext.playedCards || []
        };

        // Analyze what cards are still in play (card counting)
        ctx.cardAnalysis = BotLogic.analyzePlayedCards(hand, ctx.playedCards);

        // PHASE 1.2: Infer opponent weaknesses from passes
        ctx.passInference = BotLogic.inferFromPasses(lastPlayedHand, ctx.passCount, hand, ctx.playedCards);

        // Organize hand according to "Poker First" heuristic (with caching)
        const handKey = hand.map(c => `${c.rank}${c.suit}`).sort().join(',');
        if (!gameContext._handOrgCache || gameContext._handOrgCache.key !== handKey) {
            gameContext._handOrgCache = {
                key: handKey,
                organization: BotLogic.organizeHand(hand)
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

        const validMoves = BotLogic.getAllValidMoves(hand);

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

        // Early exit: Only 1 valid move available
        if (candidates.length === 1 && !captureReasoning) {
            return candidates[0].cards;
        }

        // Consider strategic passing
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

        // Apply strategic selection
        // PHASE 1.3: Pass all valid moves for flexibility calculation
        ctx.allValidMoves = validMoves;
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
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, '../ai/inference.py');

            // Construct input JSON
            const inputData = {
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
            };

            // Set a timeout to fallback if Python script takes too long
            const timeout = setTimeout(() => {
                console.warn('Advanced bot timeout - falling back to legacy bot');
                proc.kill();
                resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
            }, 5000); // 5 second timeout

            const proc = spawn('python3', [pythonScript]);

            let stdoutData = '';
            let stderrData = '';

            proc.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            proc.on('close', (code) => {
                clearTimeout(timeout); // Clear timeout when process completes

                if (code !== 0) {
                    console.error('Python bot failed:', stderrData);
                    // Fallback to legacy bot
                    console.log('Falling back to legacy bot...');
                    resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
                    return;
                }

                try {
                    const result = JSON.parse(stdoutData);

                    if (result.error) {
                         console.error('Python bot error:', result.error);
                         resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
                         return;
                    }

                    if (result.action === 'pass') {
                        resolve(null);
                    } else if (result.action === 'play') {
                        // The Python bot returns card objects.
                        // We need to ensure they match our internal structure if needed.
                        // Our internal structure is { rank: '...', suit: '...' }.
                        // inference.py returns exactly that.

                        // However, we should validate the move is valid using our rules engine.
                        const moveCards = result.cards;
                        const validMoves = BotLogic.getAllValidMoves(hand);

                        // Find matching valid move
                        // This ensures we don't play something illegal if the ML bot hallucinates
                        const match = validMoves.find(m => {
                            if (m.cards.length !== moveCards.length) return false;
                            // Check if all cards match
                            return m.cards.every(c =>
                                moveCards.some(mc => mc.rank === c.rank && mc.suit === c.suit)
                            );
                        });

                        if (match) {
                             resolve(match.cards);
                        } else {
                            console.warn('ML Bot suggested invalid move:', moveCards);
                            // Fallback
                            resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
                        }
                    } else {
                         // Fallback
                         resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
                    }

                } catch (e) {
                    console.error('Failed to parse ML bot output:', e, stdoutData);
                    resolve(BotLogic.getBotMove(hand, lastPlayedHand, isFirstTurn, gameContext));
                }
            });

            // Send input
            proc.stdin.write(JSON.stringify(inputData));
            proc.stdin.end();
        });
    },

    /**
     * Organize the hand according to "Poker First, Pairs Second" heuristic.
     * Identify "Control" (2s, As) and "Trash" (3-6 singles).
     */
    organizeHand: (hand) => {
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
        const allMoves = BotLogic.getAllValidMoves(hand);
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
     * Evaluate position advantage based on turn order and who played last
     * @param {Object} ctx - Game context
     * @returns {Object} - { isLastToAct, positionAdvantage, canPlayFreely }
     */
    evaluatePositionAdvantage: (ctx) => {
        const { passedPlayers, lastPlayedByRelative } = ctx;

        // Check if we're last to act (all other players have passed)
        const isLastToAct = passedPlayers && passedPlayers.length === 3;

        // Calculate position advantage score
        let positionAdvantage = 0;

        if (isLastToAct) {
            // Being last is powerful - we know everyone else passed
            positionAdvantage = 150;
        } else if (lastPlayedByRelative !== null) {
            // Calculate how many players act after us
            // If lastPlayedByRelative = 1 (next player), then next player goes after us
            // If lastPlayedByRelative = 3 (previous player), they just played, we're first

            if (lastPlayedByRelative === 3) {
                // Previous player just played, we're first to respond (weak position)
                positionAdvantage = -30;
            } else if (lastPlayedByRelative === 1) {
                // Next player played, we're last or second-to-last (strong position)
                positionAdvantage = 50;
            } else {
                // Across player played, we're in middle position
                positionAdvantage = 0;
            }
        }

        return {
            isLastToAct,
            positionAdvantage,
            canPlayFreely: isLastToAct // Can play more aggressively if last
        };
    },

    /**
     * Evaluate if we have strong follow-up plays after taking the lead
     * @param {Object} handOrganization - Organized hand structure
     * @param {Array} hand - Current cards in hand
     * @returns {boolean} true if we have strong follow-up
     */
    hasStrongFollowUp: (handOrganization, hand) => {
        // Strong follow-up indicators:
        // 1. We have 5-card hands ready to play
        if (handOrganization.fiveCardHands.length > 0) return true;

        // 2. We have multiple pairs (can control the game)
        if (handOrganization.pairs.length >= 2) return true;

        // 3. We have multiple control cards (2s or As)
        if (handOrganization.control.length >= 2) return true;

        // 4. We're close to winning (few cards left)
        if (hand.length <= 3) return true;

        return false;
    },

    /**
     * PHASE 1.3: Calculate flexibility score for cards in a move
     * Cards that appear in more combos are more flexible and should be preserved
     * @param {Array} moveCards - Cards in the proposed move
     * @param {Array} hand - Current hand
     * @param {Array} allMoves - All possible valid moves
     * @returns {number} - Flexibility score (lower = more rigid, higher = more flexible)
     */
    calculateCardFlexibility: (moveCards, hand, allMoves) => {
        let totalFlexibility = 0;

        // For each card in the move, count how many different combos it appears in
        moveCards.forEach(moveCard => {
            let comboCount = 0;

            // Count how many moves include this card
            allMoves.forEach(move => {
                const cardInMove = move.cards.some(c =>
                    c.rank === moveCard.rank && c.suit === moveCard.suit
                );
                if (cardInMove) comboCount++;
            });

            // Add to total flexibility
            // Cards in many combos = high flexibility (we want to keep these)
            // Cards in few combos = low flexibility (we can play these)
            totalFlexibility += comboCount;
        });

        // Average flexibility per card
        return totalFlexibility / moveCards.length;
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
        const followUpOrg = BotLogic.organizeHand(remainingCards);

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
     * PHASE 2.2: Plan a winning sequence (2-move lookahead)
     * @param {Array} candidates - Candidate moves
     * @param {Array} hand - Current hand
     * @param {Object} handOrganization - Hand organization
     * @returns {Object} - { move: Object, sequenceScore: number, plan: string }
     */
    plan2MoveSequence: (candidates, hand, handOrganization) => {
        let bestSequence = null;
        let bestScore = -Infinity;

        for (const move of candidates) {
            const followUp = BotLogic.evaluateFollowUp(move, hand, handOrganization);

            // Calculate sequence score
            let sequenceScore = followUp.followUpScore;

            // Bonus if this leads to likely win
            if (followUp.canLikelyWin) {
                sequenceScore += 200;
            }

            // Penalty for moves that leave us with no good options
            if (followUp.followUpMoves < 3 && hand.length > 5) {
                sequenceScore -= 100;
            }

            if (sequenceScore > bestScore) {
                bestScore = sequenceScore;
                bestSequence = {
                    move,
                    sequenceScore,
                    followUpScore: followUp.followUpScore,
                    canLikelyWin: followUp.canLikelyWin,
                    plan: `Play ${move.type}, ${hand.length - move.cards.length} cards remain, ${followUp.followUpMoves} follow-up moves`
                };
            }
        }

        return bestSequence;
    },

    /**
     * PHASE 3.2: Multi-step sequence planning (3-5 moves lookahead)
     * Uses recursive search with pruning to find optimal sequences
     * @param {Array} hand - Current hand
     * @param {Object|null} lastPlayedHand - Hand to beat (null if free play)
     * @param {number} depth - How many moves to look ahead (3-5)
     * @param {Object} ctx - Game context
     * @returns {Object} - { sequence: Array<Object>, totalScore: number, winProbability: number }
     */
    planMultiMoveSequence: (hand, lastPlayedHand, depth, ctx) => {
        // Only use for hands with 6-10 cards (too expensive for larger hands, too simple for smaller)
        if (hand.length > 10 || hand.length <= 5 || depth <= 0) {
            return null;
        }

        const cache = new Map();

        const recursivePlan = (currentHand, currentDepth, alpha, beta) => {
            // Terminal conditions
            if (currentHand.length === 0) {
                return { sequence: [], score: 10000, winProbability: 1.0 };
            }

            if (currentDepth === 0) {
                // Evaluate terminal position
                const terminalScore = BotLogic.evaluateTerminalPosition(currentHand, ctx);
                return { sequence: [], score: terminalScore, winProbability: terminalScore / 1000 };
            }

            // Check cache
            const cacheKey = currentHand.map(c => `${c.rank}${c.suit}`).sort().join(',') + `:${currentDepth}`;
            if (cache.has(cacheKey)) {
                return cache.get(cacheKey);
            }

            // Get all valid moves (assuming free play for simplicity in lookahead)
            const allMoves = BotLogic.getAllValidMoves(currentHand);

            // Prune to top candidates (limit branching factor)
            const candidateLimit = currentDepth >= 3 ? 8 : 12;
            const candidates = BotLogic.selectTopCandidates(allMoves, currentHand, candidateLimit);

            let bestPlan = null;
            let bestScore = -Infinity;

            for (const move of candidates) {
                // Simulate move
                const remainingHand = currentHand.filter(card =>
                    !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
                );

                // Immediate value of this move
                const immediateValue = BotLogic.evaluateMoveValue(move, currentHand, ctx);

                // Recursive call
                const futureResult = recursivePlan(remainingHand, currentDepth - 1, alpha, beta);

                // Total score with decay (future moves are less certain)
                const decayFactor = 0.85;
                const totalScore = immediateValue + (futureResult.score * decayFactor);

                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    bestPlan = {
                        sequence: [move, ...futureResult.sequence],
                        score: totalScore,
                        winProbability: remainingHand.length === 0 ? 1.0 : futureResult.winProbability * 0.9
                    };
                }

                // Alpha-beta pruning
                alpha = Math.max(alpha, totalScore);
                if (beta <= alpha) {
                    break; // Beta cutoff
                }
            }

            cache.set(cacheKey, bestPlan);
            return bestPlan || { sequence: [], score: 0, winProbability: 0 };
        };

        return recursivePlan(hand, Math.min(depth, 4), -Infinity, Infinity);
    },

    /**
     * PHASE 3.2: Select top candidates for multi-move planning (pruning)
     * @param {Array} allMoves - All valid moves
     * @param {Array} hand - Current hand
     * @param {number} limit - Max candidates to return
     * @returns {Array} - Top candidates
     */
    selectTopCandidates: (allMoves, hand, limit) => {
        // Score each move quickly
        const scored = allMoves.map(move => {
            let score = 0;

            // Prefer shedding more cards
            score += move.cards.length * 20;

            // Prefer low value cards
            score += (100 - move.value);

            // Prefer 5-card hands
            if (FIVE_CARD_PRIORITY[move.type]) {
                score += 100;
            }

            // Prefer moves that empty hand
            if (move.cards.length === hand.length) {
                score += 1000;
            }

            return { move, score };
        });

        // Sort and return top N
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(s => s.move);
    },

    /**
     * PHASE 3.2: Evaluate terminal position (leaf node in search tree)
     * @param {Array} hand - Remaining hand
     * @param {Object} ctx - Game context
     * @returns {number} - Score
     */
    evaluateTerminalPosition: (hand, ctx) => {
        if (hand.length === 0) return 10000;

        let score = 0;

        // Fewer cards = better
        score += (13 - hand.length) * 100;

        // Analyze remaining cards
        const org = BotLogic.organizeHand(hand);

        // Penalize if cards don't form good combos
        const validMoves = BotLogic.getAllValidMoves(hand);
        score += validMoves.length * 10;

        // Bonus if all cards form one combo
        const allAsCombo = Big2Rules.validateHand(hand);
        if (allAsCombo) {
            score += 500;
        }

        // Bonus for control cards
        score += org.control.length * 50;

        return score;
    },

    /**
     * PHASE 3.2: Evaluate immediate value of a move (for multi-move planning)
     * @param {Object} move - Move to evaluate
     * @param {Array} hand - Current hand
     * @param {Object} ctx - Game context
     * @returns {number} - Value score
     */
    evaluateMoveValue: (move, hand, ctx) => {
        let value = 0;

        // Shedding value
        value += move.cards.length * 30;

        // Low card value
        const avgValue = move.cards.reduce((sum, c) => sum + c.value, 0) / move.cards.length;
        value += (52 - avgValue);

        // 5-card bonus
        if (FIVE_CARD_PRIORITY[move.type]) {
            value += 80;
        }

        // Win bonus
        if (move.cards.length === hand.length) {
            value += 5000;
        }

        return value;
    },

    /**
     * PHASE 3.3: Monte Carlo simulation for move evaluation
     * Runs random simulations to estimate win probability
     * @param {Object} move - Move to evaluate
     * @param {Array} hand - Current hand
     * @param {Object} ctx - Game context
     * @param {number} numSimulations - Number of simulations to run (default: 50)
     * @returns {Object} - { winRate: number, avgPlacement: number, confidence: number }
     */
    monteCarloSimulation: (move, hand, ctx, numSimulations = 50) => {
        const { playerCardCounts, playedCards } = ctx;

        let wins = 0;
        let totalPlacement = 0;

        for (let i = 0; i < numSimulations; i++) {
            // Simulate game from this position
            const result = BotLogic.simulateGame(move, hand, playerCardCounts, playedCards);

            if (result.placement === 1) wins++;
            totalPlacement += result.placement;
        }

        return {
            winRate: wins / numSimulations,
            avgPlacement: totalPlacement / numSimulations,
            confidence: Math.min(1.0, numSimulations / 100) // More sims = higher confidence
        };
    },

    /**
     * PHASE 3.3: Simulate a single game from current position
     * @param {Object} initialMove - Our first move
     * @param {Array} ourHand - Our current hand
     * @param {Array} opponentCardCounts - Opponent card counts [next, across, previous]
     * @param {Array} playedCards - Cards already played
     * @returns {Object} - { placement: number (1-4), cardsRemaining: number }
     */
    simulateGame: (initialMove, ourHand, opponentCardCounts, playedCards) => {
        // Simulate our hand after initial move
        let ourSimHand = ourHand.filter(card =>
            !initialMove.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
        );

        // Distribute unknown cards to opponents
        const unknownCards = BotLogic.getUnknownCards(ourHand, playedCards);
        const opponentHands = BotLogic.distributeCardsToOpponents(unknownCards, opponentCardCounts);

        // Simulate game until someone wins
        let round = 0;
        const maxRounds = 50; // Prevent infinite loops

        while (round < maxRounds && ourSimHand.length > 0) {
            // Simulate opponent plays (simplified)
            for (let i = 0; i < 3; i++) {
                if (opponentHands[i].length > 0) {
                    // Opponent plays random valid move or passes
                    const opponentMoves = BotLogic.getAllValidMoves(opponentHands[i]);
                    if (opponentMoves.length > 0 && Math.random() < 0.6) {
                        // Play random move (60% chance)
                        const randomMove = opponentMoves[Math.floor(Math.random() * opponentMoves.length)];
                        opponentHands[i] = opponentHands[i].filter(card =>
                            !randomMove.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
                        );

                        // Check if opponent won
                        if (opponentHands[i].length === 0) {
                            // Count how many finished before us
                            const finishedBefore = opponentHands.filter(h => h.length === 0).length;
                            return { placement: finishedBefore + 2, cardsRemaining: ourSimHand.length };
                        }
                    }
                }
            }

            // Our turn - play simplistically
            const ourMoves = BotLogic.getAllValidMoves(ourSimHand);
            if (ourMoves.length > 0) {
                // Play lowest value move
                const lowMove = ourMoves.reduce((best, curr) =>
                    curr.value < best.value ? curr : best
                );
                ourSimHand = ourSimHand.filter(card =>
                    !lowMove.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
                );

                if (ourSimHand.length === 0) {
                    // We won! Count how many finished before us
                    const finishedBefore = opponentHands.filter(h => h.length === 0).length;
                    return { placement: finishedBefore + 1, cardsRemaining: 0 };
                }
            }

            round++;
        }

        // Timeout - estimate placement by card count
        const allHands = [ourSimHand, ...opponentHands];
        allHands.sort((a, b) => a.length - b.length);
        const ourIndex = allHands.findIndex(h => h === ourSimHand);

        return { placement: ourIndex + 1, cardsRemaining: ourSimHand.length };
    },

    /**
     * PHASE 3.3: Get unknown cards (not in our hand, not played)
     * @param {Array} ourHand - Our hand
     * @param {Array} playedCards - Played cards
     * @returns {Array} - Unknown cards
     */
    getUnknownCards: (ourHand, playedCards) => {
        const allCards = [];
        for (const rank of RANKS) {
            for (const suit of SUITS) {
                const card = { rank, suit, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) };
                const inOurHand = ourHand.some(c => c.rank === rank && c.suit === suit);
                const wasPlayed = playedCards.some(c => c.rank === rank && c.suit === suit);
                if (!inOurHand && !wasPlayed) {
                    allCards.push(card);
                }
            }
        }
        return allCards;
    },

    /**
     * PHASE 3.3: Distribute unknown cards to opponents
     * @param {Array} unknownCards - Cards to distribute
     * @param {Array} opponentCardCounts - [next, across, previous]
     * @returns {Array} - [hand1, hand2, hand3]
     */
    distributeCardsToOpponents: (unknownCards, opponentCardCounts) => {
        // Shuffle unknown cards
        const shuffled = [...unknownCards].sort(() => Math.random() - 0.5);

        const hands = [[], [], []];
        let cardIndex = 0;

        // Distribute according to card counts
        for (let i = 0; i < 3; i++) {
            const count = opponentCardCounts[i];
            hands[i] = shuffled.slice(cardIndex, cardIndex + count);
            cardIndex += count;
        }

        return hands;
    },

    /**
     * PHASE 2.3: Endgame solver for hands with ≤5 cards
     * Attempts to find guaranteed winning sequence
     * @param {Array} hand - Current hand (must be ≤5 cards)
     * @param {Object|null} lastPlayedHand - Hand to beat
     * @param {Object} ctx - Game context
     * @returns {Object|null} - { move, guaranteedWin: boolean } or null if no guaranteed win
     */
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

        // Try to find a guaranteed winning sequence
        for (const move of candidates) {
            const remainingCards = hand.filter(card =>
                !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
            );

            // If this empties our hand, we win!
            if (remainingCards.length === 0) {
                return { move, guaranteedWin: true, reason: 'Empties hand - instant win' };
            }

            // If remaining cards can all be played as one hand
            const remainingAsMove = Big2Rules.validateHand(remainingCards);
            if (remainingAsMove) {
                // We can play all remaining cards next turn
                // This guarantees win if:
                // 1. We'll have free play (everyone passes on our current move)
                // 2. Or remaining hand is so strong no one can beat it

                const isUnbeatable =
                    remainingAsMove.type === HAND_TYPES.STRAIGHT_FLUSH ||
                    (remainingAsMove.type === HAND_TYPES.QUADS) ||
                    (remainingAsMove.cards.some(c => c.rank === '2' && c.suit === 'S'));

                if (isUnbeatable || remainingCards.length <= 2) {
                    return {
                        move,
                        guaranteedWin: true,
                        reason: `2-move win: Play ${move.type}, then play ${remainingAsMove.type}`
                    };
                }
            }

            // Check if remaining cards give us total control
            // (all high cards that opponents can't beat)
            if (remainingCards.length <= 2) {
                const allHigh = remainingCards.every(c =>
                    ['A', '2'].includes(c.rank)
                );
                if (allHigh) {
                    return {
                        move,
                        guaranteedWin: true,
                        reason: 'Remaining cards are all control (A/2)'
                    };
                }
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
     * Determine if we should pass even though we can play
     * Implements "Don't Waste the 2s" and "Price" rules
     * Enhanced with Strategic Yielding logic
     */
    shouldStrategicPass: (candidates, hand, lastPlayedHand, ctx, captureReasoning = false) => {
        const { playerCardCounts, passCount, lastPlayedByRelative } = ctx;
        const factors = captureReasoning ? [] : null;

        const result = (shouldPass, reason = null) => {
            if (captureReasoning) {
                return { shouldPass, factors, reason };
            }
            return shouldPass;
        };

        // Can't pass on free play (no hand to beat)
        if (!lastPlayedHand) {
            return result(false);
        }

        // --- Emergency Override: Next player has 1 card ---
        if (playerCardCounts[0] === 1) {
            if (factors) factors.push('Emergency: Next player has 1 card - MUST PLAY');
            return result(false, "Must try to stop next player (1 card left)");
        }

        // Always play if we can win right now
        const winningMove = candidates.find(m => m.cards.length === hand.length);
        if (winningMove) {
             if (factors) factors.push('Winning move available - never pass');
             return result(false);
        }

        const bestCandidate = candidates.reduce((best, curr) =>
            curr.value < best.value ? curr : best
        );

        // "Don't Waste the 2s" - The "Price" of a trick
        if (lastPlayedHand.type === HAND_TYPES.SINGLE) {
            const lowestBeater = bestCandidate.cards[0];
            const lastRank = lastPlayedHand.cards[0].rank;
            const beaterRank = lowestBeater.rank;

            // "If an opponent plays a 9, and your only higher single is a 2, PASS."
            // Rule: Opponent played < 10 (3-9), and we need a 2.
            const isLowCard = ['3','4','5','6','7','8','9'].includes(lastRank);

            if (isLowCard && beaterRank === '2') {
                // Check if we have multiple 2s. If we have spare, maybe okay.
                // But heuristic says "Trading a 2 for a 9 is a terrible trade."
                const twosInHand = hand.filter(c => c.rank === '2').length;
                if (twosInHand < 2 && hand.length > 3) {
                     if (factors) factors.push(`Price Rule: Don't waste last 2 on a ${lastRank}`);
                     return result(true, "Price of trick too high (wasting 2)");
                }
            }

            // Similar logic for Aces if beating very low cards?
            // "You need that 2 to beat an Ace or King later."
        }

        // "Save the 2 of Spades"
        // "Never play it unless guaranteeing a win... or must stop opponent"
        if (bestCandidate.cards.some(c => c.rank === '2' && c.suit === 'S')) {
            // Check if "Must stop opponent"
            const minOpponentCards = Math.min(...playerCardCounts);
            const isEmergency = minOpponentCards <= 3;
            const isWin = hand.length === bestCandidate.cards.length;

            if (!isEmergency && !isWin) {
                // Try to find a move that doesn't use 2S
                const noTwoSMove = candidates.find(m => !m.cards.some(c => c.rank === '2' && c.suit === 'S'));
                if (!noTwoSMove) {
                    // Only have 2S. Pass.
                    if (factors) factors.push('Save the 2 of Spades (Nuclear Option)');
                    return result(true, "Saving 2 of Spades");
                }
            }
        }

        // Defensive: "Freeze the Winner" logic in passing?
        // No, passing is passive. Freezing is active (playing high).

        // --- PRIORITY 2: Strategic Yielding ---
        // "Don't win every trick, win the right ones"
        // Yield control if opponent played high card and we have weak follow-up

        const bestResponse = candidates.reduce((best, curr) =>
            curr.value < best.value ? curr : best
        );

        // Check if opponent played a high card
        const opponentPlayedHigh =
            lastPlayedHand.cards[0].rank === '2' ||
            lastPlayedHand.cards[0].rank === 'A' ||
            FIVE_CARD_PRIORITY[lastPlayedHand.type];

        // Check if we'd respond with mid-tier card (7-Q)
        const weHaveMidTier =
            bestResponse.type === HAND_TYPES.SINGLE &&
            ['7','8','9','10','J','Q'].includes(bestResponse.cards[0].rank);

        // Evaluate follow-up strength
        const hasWeakFollowUp = !BotLogic.hasStrongFollowUp(ctx.handOrganization, hand);

        // Strategic yield: Let opponent burn their high card
        if (opponentPlayedHigh && weHaveMidTier && hasWeakFollowUp && hand.length > 5) {
            if (factors) factors.push('Strategic Yield: Let opponent burn high card');
            return result(true, "Yielding control - opponent played high, we have weak follow-up");
        }

        return result(false);
    },

    /**
     * Analyze hand composition to determine strategic strengths
     * Returns an object describing what hand types we're strong/weak in
     */
    analyzeHandComposition: (hand) => {
        // Reuse analyze logic or simplified version
        const allMoves = BotLogic.getAllValidMoves(hand);

        const movesByType = {};
        Object.values(HAND_TYPES).forEach(t => movesByType[t] = []);

        allMoves.forEach(m => {
            if (movesByType[m.type]) {
                movesByType[m.type].push(m);
            }
        });

        return {
            movesByType,
            totalMoves: allMoves.length
        };
    },

    /**
     * Select the best move using strategic considerations
     * Implements "Play Low, or Play Long" and "Freeze the Winner"
     * Enhanced with Game Phase Strategy, Anti-Hoarding, Lead Strength, and One-Trick Win Detection
     */
    selectBestMove: (candidates, hand, lastPlayedHand, isFirstTurn, ctx = {}, captureReasoning = false) => {
        const { playerCardCounts, handOrganization, passInference, allValidMoves } = ctx;
        const nextPlayerCards = playerCardCounts[0];

        // "Freeze the Winner" Check
        const nextPlayerLow = nextPlayerCards < 5;

        // Define common variables for heuristics
        const minOpponentCards = Math.min(...playerCardCounts);

        // PHASE 1.1: Evaluate position advantage
        const positionInfo = BotLogic.evaluatePositionAdvantage(ctx);

        // PHASE 1.2: Get opponent weakness inference (default if not available)
        const opponentWeakness = passInference || { opponentsLikelyWeak: false, confidence: 0 };

        // --- PRIORITY 1: Determine Game Phase ---
        const gamePhase = BotLogic.getGamePhase(hand.length);

        // --- PRIORITY 5: Check for One-Trick Win ---
        const winCheck = BotLogic.canWinInOneTrick(hand, lastPlayedHand);
        if (winCheck.canWin && captureReasoning) {
            return {
                move: winCheck.move,
                scoredMoves: [{ move: winCheck.move, score: 999999, factors: [{ factor: 'ONE-TRICK WIN!', points: 999999 }] }],
                primaryReason: 'Can win the entire game this turn!'
            };
        } else if (winCheck.canWin) {
            return winCheck.move;
        }

        // PHASE 2.3: Use endgame solver for hands with ≤5 cards
        if (hand.length <= 5) {
            const endgameSolution = BotLogic.solveEndgame(hand, lastPlayedHand, ctx);
            if (endgameSolution) {
                if (captureReasoning) {
                    const score = endgameSolution.guaranteedWin ? 999000 : 800;
                    return {
                        move: endgameSolution.move,
                        scoredMoves: [{
                            move: endgameSolution.move,
                            score,
                            factors: [{
                                factor: endgameSolution.guaranteedWin ? 'ENDGAME SOLVER: Guaranteed Win!' : 'Endgame Solver: Optimal',
                                points: score
                            }]
                        }],
                        primaryReason: endgameSolution.reason || 'Endgame optimal play'
                    };
                }
                return endgameSolution.move;
            }
        }

        // PHASE 3.2: Use multi-step planning for mid-game (6-10 cards, free play)
        if (!lastPlayedHand && hand.length >= 6 && hand.length <= 10 && gamePhase === 'mid') {
            const multiStepPlan = BotLogic.planMultiMoveSequence(hand, lastPlayedHand, 3, ctx);
            if (multiStepPlan && multiStepPlan.winProbability > 0.7) {
                // High win probability sequence found
                const firstMove = multiStepPlan.sequence[0];
                if (captureReasoning) {
                    return {
                        move: firstMove,
                        scoredMoves: [{
                            move: firstMove,
                            score: 950,
                            factors: [{
                                factor: `Multi-Step Plan: ${multiStepPlan.winProbability.toFixed(0)}% win chance`,
                                points: 950
                            }]
                        }],
                        primaryReason: `3-move sequence with ${(multiStepPlan.winProbability * 100).toFixed(0)}% win probability`
                    };
                }
                return firstMove;
            }
        }

        // OPTIMIZATION: Pre-filter candidates if too many
        // Scoring is expensive, so limit to top candidates by value
        let candidatesToScore = candidates;
        if (candidates.length > 30) {
            // Sort by value (lower = better for shedding)
            const sorted = [...candidates].sort((a, b) => a.value - b.value);

            // Take top 15 lowest + top 15 highest (to cover both shed and force-pass strategies)
            candidatesToScore = [
                ...sorted.slice(0, 15),  // 15 lowest
                ...sorted.slice(-15)     // 15 highest
            ];

            // Remove duplicates (in case of small candidate sets)
            const seen = new Set();
            candidatesToScore = candidatesToScore.filter(m => {
                const key = m.cards.map(c => `${c.rank}${c.suit}`).join(',');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        // Priority Scoring
        const scoredMoves = candidatesToScore.map(move => {
            let score = 0;
            const factors = captureReasoning ? [] : null;
            const isWin = move.cards.length === hand.length;

            // Special Case: Next player has 1 card
            if (playerCardCounts[0] === 1) {
                // 1. Free Play Scenario
                if (!lastPlayedHand) {
                    // Priority 1: Play ANY Multi-card hand (Pair, Triple, 5-card)
                    if (move.type !== HAND_TYPES.SINGLE) {
                        // Massive score to ensure it beats any single
                        // Base 50000.
                        // Prefer lower multi-card hands? Or any?
                        // User said "prioritize playing any multi-card hand".
                        // Let's use standard shedding logic (inverted value) within this tier.
                        score = 50000 + (100 - move.value);
                        if (factors) factors.push({ factor: 'EMERGENCY: Play Multi-Card Hand (Free Play)', points: 50000 });
                        return { move, score, factors };
                    }

                    // Priority 2: Play Highest Single (if no multi-card hand available/chosen)
                    if (move.type === HAND_TYPES.SINGLE) {
                        // Score lower than Multi-card (20000 range) but higher than normal
                        // Value * 100 to prioritize rank
                        score = 20000 + (move.value * 100);
                        if (factors) factors.push({ factor: 'EMERGENCY: Play Highest Single (Free Play)', points: 20000 });
                        return { move, score, factors };
                    }
                }

                // 2. Responding to Single
                else if (lastPlayedHand.type === HAND_TYPES.SINGLE && move.type === HAND_TYPES.SINGLE) {
                    // MUST play Highest Single
                    score = 20000 + (move.value * 100);
                    if (factors) factors.push({ factor: 'EMERGENCY: Play Highest Single (Response)', points: 20000 });
                    return { move, score, factors };
                }
            }

            // Base score: prefer lower value (standard shedding)
            // Invert value so lower = higher score
            // Max value is around 60 (Straight Flush A-2-3-4-5).
            score += (100 - move.value);

            // PHASE 1.1: Apply position advantage
            if (positionInfo.isLastToAct && lastPlayedHand) {
                // Being last to act is powerful - be more aggressive
                score += positionInfo.positionAdvantage;
                if (factors) factors.push({ factor: 'Last to Act - Aggressive Play', points: positionInfo.positionAdvantage });

                // Can play slightly higher cards more confidently
                if (move.type === HAND_TYPES.SINGLE && move.cards[0].rank !== '2') {
                    score += 30;
                    if (factors) factors.push({ factor: 'Position Confidence Boost', points: 30 });
                }
            } else if (positionInfo.positionAdvantage !== 0) {
                // Apply general position modifier
                score += positionInfo.positionAdvantage;
                const posLabel = positionInfo.positionAdvantage > 0 ? 'Good Position' : 'Weak Position';
                if (factors) factors.push({ factor: posLabel, points: positionInfo.positionAdvantage });
            }

            // PHASE 1.3: Calculate and apply flexibility scoring
            if (allValidMoves && !lastPlayedHand && gamePhase === 'early') {
                // On free plays in early game, prefer playing rigid cards (low flexibility)
                const flexibility = BotLogic.calculateCardFlexibility(move.cards, hand, allValidMoves);

                // Lower flexibility = better (play rigid cards first)
                // Flexibility typically ranges from 1 (only in 1 combo) to 20+ (in many combos)
                const flexibilityPenalty = Math.min(50, flexibility * 5);
                score -= flexibilityPenalty;
                if (factors) factors.push({ factor: `Flexibility (${flexibility.toFixed(1)})`, points: -flexibilityPenalty });
            }

            // PHASE 2.2: Evaluate follow-up strength (2-move lookahead)
            if (!lastPlayedHand && hand.length > 5 && !isWin) {
                // On free plays with more than 5 cards, consider follow-up strength
                const followUp = BotLogic.evaluateFollowUp(move, hand, handOrganization);

                // Bonus for good follow-up positions
                const followUpBonus = Math.min(100, followUp.followUpScore / 3);
                score += followUpBonus;
                if (factors) factors.push({ factor: `Follow-Up Strength`, points: followUpBonus });

                // Big bonus if this leads to likely win
                if (followUp.canLikelyWin) {
                    score += 120;
                    if (factors) factors.push({ factor: 'Path to Victory', points: 120 });
                }

                // Penalty if this leaves us with very few options
                if (followUp.followUpMoves < 3 && hand.length > 7) {
                    score -= 80;
                    if (factors) factors.push({ factor: 'Weak Follow-Up Options', points: -80 });
                }
            }

            // PHASE 3.1: Add Expected Value component
            // Calculate EV for critical decisions (late game or close matches)
            if (gamePhase === 'late' || (gamePhase === 'mid' && hand.length <= 8)) {
                const ev = BotLogic.calculateExpectedValue(move, hand, lastPlayedHand, ctx);
                const evBonus = Math.floor(ev / 5); // Scale down to fit with other scoring
                score += evBonus;
                if (factors) factors.push({ factor: `Expected Value`, points: evBonus });
            }

            // PHASE 3.3: Monte Carlo sampling for uncertain positions (optional, expensive)
            // Only use on free plays in mid-game when decision is unclear
            if (!lastPlayedHand && gamePhase === 'mid' && hand.length >= 7 && hand.length <= 9) {
                // Only run MC for top candidates to save time
                // This would be determined by existing score at this point
                if (score > 200 || isWin) { // Promising candidate
                    // Run minimal simulations (20 for speed)
                    const mcResult = BotLogic.monteCarloSimulation(move, hand, ctx, 20);
                    const mcBonus = Math.floor(mcResult.winRate * 150);
                    score += mcBonus;
                    if (factors) factors.push({ factor: `Monte Carlo (${(mcResult.winRate * 100).toFixed(0)}% win)`, points: mcBonus });
                }
            }

            // --- PRIORITY 1: Game Phase Strategy ---
            if (gamePhase === 'early') {
                // Early game: Shed trash, avoid using control cards
                if (move.type === HAND_TYPES.SINGLE && ['3','4','5','6'].includes(move.cards[0].rank)) {
                    score += 100;
                    if (factors) factors.push({ factor: 'Early Game: Dump Trash', points: 100 });
                }

                // Avoid fights - don't use control cards (A, 2) unless winning
                // Check all cards in the move, not just the first
                const hasTwos = move.cards.some(c => c.rank === '2');
                const hasAces = move.cards.some(c => c.rank === 'A');

                if (hasTwos && !isWin) {
                    // Extra penalty for using 2s in early game
                    const numTwos = move.cards.filter(c => c.rank === '2').length;
                    const penalty = -150 * numTwos;
                    score += penalty;
                    if (factors) factors.push({
                        factor: `Early Game: Save 2s (${numTwos}x)`,
                        points: penalty
                    });
                }

                if (hasAces && !isWin && !hasTwos) {
                    // Moderate penalty for using Aces in early game (if not already penalized for 2s)
                    score -= 100;
                    if (factors) factors.push({ factor: 'Early Game: Save Aces', points: -100 });
                }
            }

            if (gamePhase === 'mid') {
                // Mid-game: Assert control if we have dominance
                if (BotLogic.hasStrongFollowUp(handOrganization, hand)) {
                    if (!lastPlayedHand) {
                        score += 80;
                        if (factors) factors.push({ factor: 'Mid-Game: Assert Control', points: 80 });
                    }
                }

                // --- PRIORITY 3: Anti-Hoarding Logic ---
                // Shed high singles to avoid hoarding
                if (move.type === HAND_TYPES.SINGLE && ['K', 'A'].includes(move.cards[0].rank)) {
                    score += 60;
                    if (factors) factors.push({ factor: 'Mid-Game: Shed High Singles (Anti-Hoard)', points: 60 });
                }

                // Reduce protection of high pairs in mid-game
                if (move.type === HAND_TYPES.PAIR && ['K', 'A'].includes(move.cards[0].rank)) {
                    score += 40;
                    if (factors) factors.push({ factor: 'Mid-Game: Play High Pairs (Anti-Hoard)', points: 40 });
                }
            }

            if (gamePhase === 'late') {
                // Late game: Maximum aggression - prevent opponents from going out
                // Calculate if we can empty hand in sequence
                if (hand.length <= 5) {
                    // Bonus for any move that reduces hand size
                    score += 100;
                    if (factors) factors.push({ factor: 'Late Game: Aggressive Shedding', points: 100 });
                }
            }

            // --- Leading Strategy (Free Play) ---
            if (!lastPlayedHand) {
                // PHASE 1.2: If opponents are weak in singles, aggressively lead with singles
                if (opponentWeakness.opponentsWeakInSingles && move.type === HAND_TYPES.SINGLE) {
                    const bonus = Math.floor(opponentWeakness.confidence * 100);
                    score += bonus;
                    if (factors) factors.push({ factor: 'Opponents Weak in Singles - Exploit', points: bonus });
                }

                // PHASE 1.2: If opponents weak in pairs, lead with pairs
                if (opponentWeakness.opponentsWeakInPairs && move.type === HAND_TYPES.PAIR) {
                    const bonus = Math.floor(opponentWeakness.confidence * 80);
                    score += bonus;
                    if (factors) factors.push({ factor: 'Opponents Weak in Pairs - Exploit', points: bonus });
                }

                // PHASE 1.2: If opponents weak in 5-cards, prefer other plays
                if (opponentWeakness.opponentsWeakInFiveCards && FIVE_CARD_PRIORITY[move.type]) {
                    score -= 60;
                    if (factors) factors.push({ factor: 'Save 5-Card - Opponents Weak', points: -60 });
                }

                // --- PRIORITY 4: Lead Strength Evaluation ---
                // Only take lead if we have strong follow-up (except in late game)
                // PHASE 1.2: But if opponents are likely weak, we can lead more freely
                if (gamePhase !== 'late' && !BotLogic.hasStrongFollowUp(handOrganization, hand)) {
                    // We have weak follow-up, penalize taking lead
                    // But reduce penalty if opponents are weak
                    const penalty = opponentWeakness.opponentsLikelyWeak
                        ? -60 // Reduced penalty
                        : -120; // Normal penalty
                    score += penalty;
                    const label = opponentWeakness.opponentsLikelyWeak
                        ? 'Weak Follow-Up (Reduced - Opponents Weak)'
                        : 'Weak Follow-Up: Avoid Leading';
                    if (factors) factors.push({ factor: label, points: penalty });
                }

                // Priority A: 5-Card Hands
                if (FIVE_CARD_PRIORITY[move.type]) {
                    score += 200; // Big bonus
                    if (factors) factors.push({ factor: 'Priority A: 5-Card Hand', points: 200 });

                    // Check if this specific move is in our "Organized" plan
                    const isOrganized = handOrganization.fiveCardHands.some(h =>
                        h.type === move.type && h.value === move.value
                    );
                    if (isOrganized) {
                        score += 50; // Stick to plan
                        if (factors) factors.push({ factor: 'Follows Hand Organization', points: 50 });
                    }
                }

                // Priority B: Low Pairs/Triples
                else if (move.type === HAND_TYPES.PAIR || move.type === HAND_TYPES.TRIPLE) {
                    score += 100;
                    if (factors) factors.push({ factor: 'Priority B: Pair/Triple', points: 100 });

                    // Prefer low ones
                    if (move.value < 20) {
                        score += 20;
                        if (factors) factors.push({ factor: 'Low Pair/Triple', points: 20 });
                    }
                }

                // Priority C: Low Singles
                else if (move.type === HAND_TYPES.SINGLE) {
                    // "Dump the trash first" (Singles 3-6)
                    if (['3','4','5','6'].includes(move.cards[0].rank)) {
                        score += 80;
                        if (factors) factors.push({ factor: 'Priority C: Trash Single', points: 80 });
                    }
                }

                // Exception: "Running the Board" - High cards
                // If next player is low, we SHOULD play high (Defensive Heuristic overrides Leading Strategy)
                if (nextPlayerLow) {
                     // "Play High immediately. Do not play a low single..."
                     if (move.type === HAND_TYPES.SINGLE) {
                         if (move.value < 40) { // < King
                             score -= 200; // Penalize low singles
                             if (factors) factors.push({ factor: 'Freeze: Avoid Low Single', points: -200 });
                         } else {
                             score += 150; // Boost high singles
                             if (factors) factors.push({ factor: 'Freeze: Play High Single', points: 150 });
                         }
                     }
                     // Prefer Pairs/5-cards to force pass
                     if (move.type !== HAND_TYPES.SINGLE) {
                         score += 50;
                     }
                }
            }

            // --- Beating Strategy ---
            else {
                // "Freeze the Winner" Overrides
                if (nextPlayerLow) {
                    // "Do not play a low single... They likely have a single junk card"
                    if (move.type === HAND_TYPES.SINGLE && move.value < 40) { // < King
                         score -= 200;
                         if (factors) factors.push({ factor: 'Freeze: Avoid Low Single', points: -200 });
                    }

                    // "Force the Pass. Play a high card..."
                    if (move.cards[0].rank === 'K' || move.cards[0].rank === 'A') {
                        score += 100;
                        if (factors) factors.push({ factor: 'Freeze: Force Pass with High Card', points: 100 });
                    }
                }

                // "Mid-Range" Rule: If Jack, play Queen/King ("cheap" shedding)
                // Naturally handled by "lowest winning card" logic, but let's boost "cheap" wins
                const valueGap = move.value - lastPlayedHand.value;
                if (valueGap < 4) { // Very close value
                    score += 20;
                    if (factors) factors.push({ factor: 'Cheap Shedding (Mid-Range)', points: 20 });
                }
            }

            // --- General Heuristics ---

            // Penalize breaking 5-card hands from organization
            // If this move uses a card that belongs to an organized 5-card hand, and this move is NOT that hand
            const usesReservedCard = move.cards.some(c =>
                handOrganization.fiveCardHands.some(h =>
                    h.cards.some(hc => hc.rank === c.rank && hc.suit === c.suit)
                )
            );

            // But only if we are not playing that 5-card hand right now
            const isTheFiveCardHand = handOrganization.fiveCardHands.some(h =>
                h.type === move.type && h.value === move.value
            );

            if (usesReservedCard && !isTheFiveCardHand) {
                // Breaking a flush/straight/etc.
                score -= 150;
                if (factors) factors.push({ factor: 'Breaks Organized Hand', points: -150 });
            }

            // Rule 3: Top-Heavy Pair Protection
            // Don't break pairs of A, K, Q to beat a single card
            // BUT: Anti-hoarding overrides this in mid-game
            if (move.type === HAND_TYPES.SINGLE && !isWin) {
                const rank = move.cards[0].rank;
                if (['A', 'K', 'Q'].includes(rank)) {
                    // Check if this card comes from an organized Pair
                    const isFromPair = handOrganization.pairs.some(p =>
                        p.cards.some(pc => pc.rank === rank && pc.suit === move.cards[0].suit)
                    );

                    if (isFromPair) {
                        // In mid-game, reduce penalty (anti-hoarding)
                        const penalty = gamePhase === 'mid' ? -50 : -100;
                        score += penalty;
                        if (factors) factors.push({
                            factor: gamePhase === 'mid' ? 'Break High Pair (Reduced - Mid Game)' : 'Break High Pair Protection',
                            points: penalty
                        });
                    }
                }
            }

            // Rule 4: The "2" Breaker Rule
            // Only split a pair of 2s if desperate
            if (move.type === HAND_TYPES.SINGLE && move.cards[0].rank === '2') {
                const isFromPairOfTwos = handOrganization.pairs.some(p => p.rank === '2');

                if (isFromPairOfTwos) {
                    // Check if desperate:
                    // 1. We are winning (handled by isWin check in 'score' bonuses?) -> Actually need explicit check here
                    // 2. Next player low on cards (Danger mode) -> maybe valid then?
                    // Rule says "regain control right now to play a 5-card hand or end the game"

                    const isDesperate = isWin || (nextPlayerLow && minOpponentCards <= 2);

                    if (!isDesperate) {
                        score -= 300; // Major penalty for breaking Pair of 2s unnecessarily
                        if (factors) factors.push({ factor: 'Break Pair of 2s (Not Desperate)', points: -300 });
                    }
                }
            }

            // Rule 4.5: Avoid Playing Triple 2s and Breaking Quads
            if (move.type === HAND_TYPES.TRIPLE && move.cards[0].rank === '2' && !isWin) {
                // Count how many 2s we have in total
                const totalTwos = hand.filter(c => c.rank === '2').length;

                if (totalTwos === 4) {
                    // Breaking quad 2s to play triple 2s is extremely wasteful!
                    // Quads are nearly unbeatable, triple 2s can be beaten by other triples with higher suit
                    const isDesperate = nextPlayerLow || ctx.playerCardCounts.some(c => c <= 2);

                    if (!isDesperate) {
                        score -= 500; // Massive penalty - similar to wasting 2S
                        if (factors) factors.push({
                            factor: 'Breaking Quad 2s (Save for Quads!)',
                            points: -500
                        });
                    }
                } else if (totalTwos === 3) {
                    // Playing triple 2s in early/mid game when not desperate
                    const isDesperate = nextPlayerLow || ctx.playerCardCounts.some(c => c <= 2);

                    if (!isDesperate && gamePhase !== 'late') {
                        score -= 200; // Significant penalty
                        if (factors) factors.push({
                            factor: 'Playing Triple 2s (Early/Mid Game)',
                            points: -200
                        });
                    }
                }
            }

            // Rule 5: Avoid Wasting 2s in Full Houses
            // Full houses should use lower cards when possible
            if (move.type === HAND_TYPES.FULL_HOUSE && !isWin) {
                const twosInMove = move.cards.filter(c => c.rank === '2');

                if (twosInMove.length > 0) {
                    // Determine if 2s are in the triple or pair part
                    // In a full house, the middle card (index 2) is always part of the triple
                    const sortedMove = [...move.cards].sort((a, b) => {
                        const aVal = RANKS.indexOf(a.rank) * 4 + SUITS.indexOf(a.suit);
                        const bVal = RANKS.indexOf(b.rank) * 4 + SUITS.indexOf(b.suit);
                        return aVal - bVal;
                    });
                    const tripleRank = sortedMove[2].rank;

                    // Check if 2s are in the pair (not triple)
                    const twosInPair = twosInMove.filter(c => c.rank !== tripleRank);

                    if (twosInPair.length > 0) {
                        // Using 2s as a pair in full house is wasteful
                        // Only acceptable in desperate situations
                        const isDesperate = nextPlayerLow || ctx.playerCardCounts.some(c => c <= 2);

                        if (!isDesperate) {
                            // Massive penalty - this is almost as bad as breaking pair of 2s
                            const penalty = twosInPair.length === 2 ? -400 : -250;
                            score += penalty;
                            if (factors) factors.push({
                                factor: `Wasting ${twosInPair.length} 2(s) in Full House Pair`,
                                points: penalty
                            });
                        }
                    } else if (tripleRank === '2') {
                        // Using triple 2s in full house - less problematic but still not ideal
                        // Only penalize if not desperate
                        const isDesperate = nextPlayerLow || ctx.playerCardCounts.some(c => c <= 2);
                        if (!isDesperate && gamePhase !== 'late') {
                            score -= 100;
                            if (factors) factors.push({
                                factor: 'Using Triple 2s in Full House (Questionable)',
                                points: -100
                            });
                        }
                    }
                }
            }

            // Note: Straights with 2s (A-2-3-4-5 and 2-3-4-5-6) are the HIGHEST straights
            // and should be played strategically - no blanket penalty needed

            // Rule 6: Avoid Wasting 2s in Flushes
            // Only use 2s in flushes when necessary (high value flush or desperate)
            if (move.type === HAND_TYPES.FLUSH && !isWin) {
                const twosInMove = move.cards.filter(c => c.rank === '2');

                if (twosInMove.length > 0) {
                    // Check if this is a high-value flush (has multiple high cards)
                    const highCards = move.cards.filter(c => ['A', 'K', 'Q'].includes(c.rank));
                    const isHighValueFlush = highCards.length >= 3;

                    // Only acceptable in desperate situations or if it's a genuinely strong flush
                    const isDesperate = nextPlayerLow || ctx.playerCardCounts.some(c => c <= 2);

                    if (!isDesperate && !isHighValueFlush) {
                        // Penalize using 2s in mediocre flushes
                        const penalty = twosInMove.length * -200;
                        score += penalty;
                        if (factors) factors.push({
                            factor: `Wasting ${twosInMove.length} 2(s) in Mediocre Flush`,
                            points: penalty
                        });
                    } else if (!isDesperate && isHighValueFlush && gamePhase === 'early') {
                        // Even high flushes shouldn't use 2s in early game
                        score -= 100;
                        if (factors) factors.push({
                            factor: 'Using 2 in Flush (Early Game)',
                            points: -100
                        });
                    }
                }
            }

            // Save 2 of Spades (Nuclear Option) - unless winning
            if (move.cards.some(c => c.rank === '2' && c.suit === 'S') && !isWin) {
                // Only use if "must stop opponent"
                if (nextPlayerLow || ctx.playerCardCounts.some(c => c <= 3)) {
                    // OK to use
                } else {
                    score -= 500; // Big penalty
                    if (factors) factors.push({ factor: 'Save 2S', points: -500 });
                }
            }

            return { move, score, factors };
        });

        // Sort by score
        scoredMoves.sort((a, b) => b.score - a.score);

        if (captureReasoning) {
            let primaryReason = 'Best score';
            if (scoredMoves[0].factors && scoredMoves[0].factors.length > 0) {
                 // Find max absolute point factor
                 primaryReason = scoredMoves[0].factors.reduce((prev, curr) =>
                     Math.abs(curr.points) > Math.abs(prev.points) ? curr : prev
                 ).factor;
            }
            return {
                move: scoredMoves[0].move,
                scoredMoves,
                primaryReason
            };
        }

        return scoredMoves[0].move;
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
            lastAction: null
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
     * PHASE 2.1: Estimate opponent hand strength based on model
     * @param {Object} model - Opponent model
     * @returns {string} - Strength assessment: 'very-weak', 'weak', 'medium', 'strong', 'very-strong'
     */
    estimateOpponentStrength: (model) => {
        let strengthScore = 50; // Base 50/100

        // Adjust based on card count
        if (model.cardCount <= 3) {
            strengthScore += 30; // Very dangerous with few cards
        } else if (model.cardCount <= 6) {
            strengthScore += 15;
        } else if (model.cardCount >= 11) {
            strengthScore -= 15; // Weak if many cards
        }

        // Adjust based on probabilities
        if (model.likelyHas2s > 0.5) strengthScore += 20;
        if (model.likelyHasFiveCardHands > 0.5) strengthScore += 15;
        if (model.likelyHasPairs > 0.6) strengthScore += 10;

        // Adjust based on pass history
        const recentPasses = model.passHistory.slice(-3);
        const passedOnLowCards = recentPasses.filter(h =>
            h.type === HAND_TYPES.SINGLE && RANKS.indexOf(h.cards[0].rank) < 7
        ).length;

        if (passedOnLowCards >= 2) {
            strengthScore -= 25; // Weak if passing on low cards
        }

        // Convert to assessment
        if (strengthScore >= 80) return 'very-strong';
        if (strengthScore >= 60) return 'strong';
        if (strengthScore >= 40) return 'medium';
        if (strengthScore >= 20) return 'weak';
        return 'very-weak';
    },

    /**
     * PHASE 3.1: Calculate Expected Value (EV) of a move
     * @param {Object} move - The move to evaluate
     * @param {Array} hand - Current hand
     * @param {Object|null} lastPlayedHand - Hand to beat
     * @param {Object} ctx - Game context
     * @returns {number} - Expected value score
     */
    calculateExpectedValue: (move, hand, lastPlayedHand, ctx) => {
        const { playerCardCounts, cardAnalysis, passInference } = ctx;

        let ev = 0;

        // Component 1: Immediate Card Value (shedding value)
        // Lower cards = higher value to shed
        const sheddingValue = move.cards.reduce((sum, card) => {
            const rankIndex = RANKS.indexOf(card.rank);
            return sum + (13 - rankIndex) * 5; // 3 = 50pts, 2 = 5pts
        }, 0);
        ev += sheddingValue;

        // Component 2: Control Probability × Control Value
        const controlProb = BotLogic.estimateControlProbability(move, hand, ctx);
        const controlValue = BotLogic.calculateControlValue(hand, move, ctx);
        ev += controlProb * controlValue;

        // Component 3: Cost of Using High Cards
        const cardCost = move.cards.reduce((sum, card) => {
            let cost = 0;
            if (card.rank === '2') cost = 100; // Very high cost
            else if (card.rank === 'A') cost = 50;
            else if (card.rank === 'K') cost = 30;
            return sum + cost;
        }, 0);

        // Discount cost in late game (need to use them eventually)
        const gamePhase = BotLogic.getGamePhase(hand.length);
        const costMultiplier = gamePhase === 'late' ? 0.3 : gamePhase === 'mid' ? 0.7 : 1.0;
        ev -= cardCost * costMultiplier;

        // Component 4: Opponent Response Probability
        // If opponents likely can't respond, increase EV
        if (passInference && passInference.opponentsLikelyWeak) {
            const opponentFailProb = passInference.confidence;
            ev += opponentFailProb * 80;
        }

        // Component 5: Win Probability Boost
        // Moves that lead to likely wins get huge EV boost
        if (hand.length - move.cards.length <= 3) {
            const followUp = BotLogic.evaluateFollowUp(move, hand, ctx.handOrganization);
            if (followUp.canLikelyWin) {
                ev += 500;
            }
        }

        // Component 6: Position Value
        const positionInfo = BotLogic.evaluatePositionAdvantage(ctx);
        if (positionInfo.isLastToAct) {
            // Being last to act increases EV (lower risk)
            ev += 50;
        }

        return ev;
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

    /**
     * PHASE 3.1: Calculate value of having control
     * @param {Array} hand - Current hand
     * @param {Object} move - Move being considered
     * @param {Object} ctx - Game context
     * @returns {number} - Value score
     */
    calculateControlValue: (hand, move, ctx) => {
        const { handOrganization } = ctx;

        // Simulate remaining hand
        const remainingCards = hand.filter(card =>
            !move.cards.some(mc => mc.rank === card.rank && mc.suit === card.suit)
        );

        if (remainingCards.length === 0) {
            return 1000; // Winning = maximum value
        }

        let value = 0;

        // Value 1: Can we play strong 5-card hands?
        const remainingOrg = BotLogic.organizeHand(remainingCards);
        value += remainingOrg.fiveCardHands.length * 150;

        // Value 2: Can we dump trash?
        value += remainingOrg.trash.length * 30;

        // Value 3: Close to winning
        if (remainingCards.length <= 5) {
            value += 200;
        }

        // Value 4: Have control cards remaining
        value += remainingOrg.control.length * 40;

        return value;
    },

    /**
     * PHASE 1.2: Infer opponent card probabilities based on pass history
     * @param {Object} lastPlayedHand - The hand that was passed on
     * @param {number} passCount - How many players passed
     * @param {Array} hand - Our current hand
     * @param {Array} playedCards - Cards already played
     * @returns {Object} - Inference about opponent hands
     */
    inferFromPasses: (lastPlayedHand, passCount, hand, playedCards) => {
        if (!lastPlayedHand || passCount === 0) {
            return { opponentsLikelyWeak: false, confidence: 0 };
        }

        const inference = {
            opponentsLikelyWeak: false,
            opponentsWeakInSingles: false,
            opponentsWeakInPairs: false,
            opponentsWeakInFiveCards: false,
            confidence: 0,
            unlikelyOpponentCards: []
        };

        // If multiple players passed on a low/medium card, they're likely weak in that type
        if (passCount >= 2) {
            if (lastPlayedHand.type === HAND_TYPES.SINGLE) {
                const rankIndex = RANKS.indexOf(lastPlayedHand.cards[0].rank);

                // If they passed on a card below Queen (rankIndex < 9), they're weak in singles
                if (rankIndex < 9) {
                    inference.opponentsWeakInSingles = true;
                    inference.opponentsLikelyWeak = true;
                    inference.confidence = 0.7;

                    // They likely don't have higher singles (but account for strategic passes)
                    for (let r = rankIndex + 1; r < RANKS.length; r++) {
                        for (let s = 0; s < 4; s++) {
                            const card = { rank: RANKS[r], suit: SUITS[s] };
                            // Don't add if it's in our hand or played
                            const inOurHand = hand.some(c => c.rank === card.rank && c.suit === card.suit);
                            const wasPlayed = playedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                            if (!inOurHand && !wasPlayed) {
                                inference.unlikelyOpponentCards.push(card);
                            }
                        }
                    }
                }
            } else if (lastPlayedHand.type === HAND_TYPES.PAIR) {
                const rankIndex = RANKS.indexOf(lastPlayedHand.cards[0].rank);
                if (rankIndex < 8) {
                    inference.opponentsWeakInPairs = true;
                    inference.opponentsLikelyWeak = true;
                    inference.confidence = 0.6;
                }
            } else if ([HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH, HAND_TYPES.FULL_HOUSE].includes(lastPlayedHand.type)) {
                // If multiple players passed on a 5-card hand, they likely don't have 5-card hands
                inference.opponentsWeakInFiveCards = true;
                inference.confidence = 0.8;
            }
        }

        // If all 3 opponents passed, very high confidence they're weak
        if (passCount === 3) {
            inference.opponentsLikelyWeak = true;
            inference.confidence = Math.min(1.0, inference.confidence + 0.2);
        }

        return inference;
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

module.exports = { BotLogic };
