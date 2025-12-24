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

        // Organize hand according to "Poker First" heuristic
        ctx.handOrganization = BotLogic.organizeHand(hand);

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
            const typeScoreA = FIVE_CARD_PRIORITY[a.type] || 0;
            const typeScoreB = FIVE_CARD_PRIORITY[b.type] || 0;
            if (typeScoreA !== typeScoreB) return typeScoreB - typeScoreA;
            return b.value - a.value; // Higher value preferred? Or lower to save high?
            // Heuristic says "Shed 5 cards". Usually best to play what you have.
            // Let's prioritize stronger structures to "lock" them in.
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
     * Determine if we should pass even though we can play
     * Implements "Don't Waste the 2s" and "Price" rules
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
     */
    selectBestMove: (candidates, hand, lastPlayedHand, isFirstTurn, ctx = {}, captureReasoning = false) => {
        const { playerCardCounts, handOrganization } = ctx;
        const nextPlayerCards = playerCardCounts[0];

        // "Freeze the Winner" Check
        const nextPlayerLow = nextPlayerCards < 5;

        // Priority Scoring
        const scoredMoves = candidates.map(move => {
            let score = 0;
            const factors = captureReasoning ? [] : null;

            // Base score: prefer lower value (standard shedding)
            // Invert value so lower = higher score
            // Max value is around 60 (Straight Flush A-2-3-4-5).
            score += (100 - move.value);

            // --- Leading Strategy (Free Play) ---
            if (!lastPlayedHand) {
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

            // Save 2 of Spades (Nuclear Option) - unless winning
            const isWin = hand.length === move.cards.length;
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
                for (let i = 0; i < cards.length; i++) {
                    for (let j = i + 1; j < cards.length; j++) {
                        moves.push(Big2Rules.validateHand([cards[i], cards[j]]));
                    }
                }
            }
        }

        // Triples
        for (const rank in byRank) {
            const cards = byRank[rank];
            if (cards.length >= 3) {
                const tripleCombos = BotLogic.getCombinations(cards, 3);
                for (const combo of tripleCombos) moves.push(Big2Rules.validateHand(combo));
            }
        }

        // 5-card hands
        if (hand.length >= 5) {
            const straights = BotLogic.findAllStraights(hand, byRank);
            straights.forEach(s => { const v = Big2Rules.validateHand(s); if(v) moves.push(v); });

            for (const suit in bySuit) {
                if (bySuit[suit].length >= 5) {
                    const flushes = BotLogic.getCombinations(bySuit[suit], 5);
                    flushes.forEach(f => {
                        const v = Big2Rules.validateHand(f);
                        if(v && v.type === HAND_TYPES.FLUSH) moves.push(v);
                    });
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
        const generate = (idx, current) => {
            if (idx === ranks.length) { combinations.push([...current]); return; }
            for (const card of cardOptions[idx]) {
                current.push(card);
                generate(idx + 1, current);
                current.pop();
            }
        };
        generate(0, []);
        return combinations;
    },

    findAllFullHouses: (hand, byRank) => {
        const fullHouses = [];
        const triples = Object.keys(byRank).filter(r => byRank[r].length >= 3);
        const pairs = Object.keys(byRank).filter(r => byRank[r].length >= 2);

        triples.forEach(tRank => {
            BotLogic.getCombinations(byRank[tRank], 3).forEach(triple => {
                pairs.forEach(pRank => {
                    if (pRank !== tRank) {
                         BotLogic.getCombinations(byRank[pRank], 2).forEach(pair => {
                             fullHouses.push([...triple, ...pair]);
                         });
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
