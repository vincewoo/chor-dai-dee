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
        // Check if we should use the advanced ML bot
        // For now, let's use it if available.
        // In the future, this could be a setting.
        // We'll return a Promise if we use the async advanced bot, but this function is sync.
        // To handle this in the current codebase structure (likely synchronous loops),
        // we might need to rely on the current sync implementation OR refactor the caller to handle async.
        //
        // However, BotLogic.getBotMove seems to be designed as synchronous.
        // Using spawnSync would block the event loop which is bad for Node.
        // BUT for a turn-based game, 100-200ms blocking might be acceptable for a prototype.
        // Let's try to check if we can make it async. The user asked to "incorporate it".
        // Assuming I should add a NEW async method `getAdvancedBotMove` and the caller needs to update.
        //
        // But the prompt implies replacing/incorporating into "our bot system".
        // I will add a separate async function and keep getBotMove for backward compatibility / fallback.

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
                } : null
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
     * Determine if we should pass even though we can play
     */
    shouldStrategicPass: (candidates, hand, lastPlayedHand, ctx, captureReasoning = false) => {
        const { playerCardCounts, passCount, lastPlayedByRelative, cardAnalysis } = ctx;
        const prevPlayerCards = playerCardCounts[2]; // Player before us
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

        // Never pass if we're close to winning
        if (hand.length <= 3) {
            if (factors) factors.push('Close to winning (≤3 cards) - must play aggressively');
            return result(false);
        }

        // Never pass if 2 others have already passed (we'd get control)
        if (passCount >= 2) {
            if (factors) factors.push('2 players already passed - will gain control if we play');
            return result(false);
        }

        // Check if any opponent is close to winning - NEVER pass if so
        const minOpponentCards = Math.min(...playerCardCounts);
        if (minOpponentCards <= 2) {
            if (factors) factors.push(`Opponent has only ${minOpponentCards} cards - danger mode, must play`);
            return result(false);
        }

        // If next player has few cards, be more aggressive
        const nextPlayerCards = playerCardCounts[0];
        if (nextPlayerCards <= 3) {
            if (factors) factors.push(`Next player has ${nextPlayerCards} cards - must block them`);
            return result(false);
        }

        // POSITION AWARENESS: If player before us played, consider letting them have it
        // This is a key Big 2 strategy - help the player before you
        if (lastPlayedByRelative === 3 && prevPlayerCards <= 5 && hand.length > 6) {
            // Previous player played and is getting low - consider passing to let them keep control
            // unless we can beat them with a low card
            const lowestBeater = candidates.reduce((best, curr) =>
                curr.value < best.value ? curr : best
            );
            if (lowestBeater.value > 35) { // We'd need a high card
                if (factors) factors.push(`Previous player (${prevPlayerCards} cards) played - considering letting them keep control`);
                const shouldPass = Math.random() < 0.5;
                if (shouldPass) {
                    return result(true, 'Letting previous player keep control (positional play)');
                }
            }
        }

        // Evaluate our best candidate
        const bestCandidate = candidates.reduce((best, curr) =>
            curr.value < best.value ? curr : best
        );

        // If we have to use a very high card to beat a low card, consider passing
        const valueGap = bestCandidate.value - lastPlayedHand.value;

        // For singles: if we'd need to use a high card (A or 2) to beat a low card, maybe pass
        if (lastPlayedHand.type === HAND_TYPES.SINGLE) {
            const lowestBeater = bestCandidate.cards[0];

            // If opponent played something low (below 10) and we'd need an A or 2
            if (lastPlayedHand.value < 28 && lowestBeater.rank === '2') {
                const twosInHand = hand.filter(c => c.rank === '2').length;
                if (twosInHand <= 1) {
                    if (factors) factors.push(`Would need to use a 2 (only have ${twosInHand}) to beat a low card`);
                    const shouldPass = passCount === 0 && Math.random() < 0.6;
                    if (shouldPass) {
                        return result(true, 'Conserving 2s - too valuable to waste on low cards');
                    }
                }
            }

            // If we'd use an A to beat something below 8
            if (lastPlayedHand.value < 20 && lowestBeater.rank === 'A') {
                const acesInHand = hand.filter(c => c.rank === 'A').length;
                if (acesInHand <= 1 && passCount === 0) {
                    if (factors) factors.push(`Would need to use an Ace (only have ${acesInHand}) to beat a very low card`);
                    const shouldPass = Math.random() < 0.4;
                    if (shouldPass) {
                        return result(true, 'Conserving Ace - saving for better opportunity');
                    }
                }
            }
        }

        // For 5-card hands: if we'd use our only strong combo to beat a weak one, consider passing
        if (FIVE_CARD_PRIORITY[lastPlayedHand.type]) {
            const fiveCardCandidates = candidates.filter(c => c.cards.length === 5);
            if (fiveCardCandidates.length === 1 && valueGap > 15 && passCount === 0) {
                if (factors) factors.push('Only have one 5-card hand and would need it to beat a weak combo');
                const shouldPass = Math.random() < 0.5;
                if (shouldPass) {
                    return result(true, 'Conserving only 5-card combo for better opportunity');
                }
            }
        }

        return result(false);
    },

    /**
     * Analyze hand composition to determine strategic strengths
     * Returns an object describing what hand types we're strong/weak in
     */
    analyzeHandComposition: (hand) => {
        const allMoves = BotLogic.getAllValidMoves(hand);

        // Count moves by type
        const movesByType = {
            [HAND_TYPES.SINGLE]: [],
            [HAND_TYPES.PAIR]: [],
            [HAND_TYPES.TRIPLE]: [],
            [HAND_TYPES.STRAIGHT]: [],
            [HAND_TYPES.FLUSH]: [],
            [HAND_TYPES.FULL_HOUSE]: [],
            [HAND_TYPES.QUADS]: [],
            [HAND_TYPES.STRAIGHT_FLUSH]: []
        };

        allMoves.forEach(m => {
            if (movesByType[m.type]) {
                movesByType[m.type].push(m);
            }
        });

        // Calculate strength scores for each type
        // Strength = count of moves * average value of moves
        const strength = {};
        const dominated = {}; // Which types dominate (many high-value options)

        for (const type in movesByType) {
            const moves = movesByType[type];
            strength[type] = moves.length;

            if (moves.length > 0) {
                const avgValue = moves.reduce((sum, m) => sum + m.value, 0) / moves.length;
                const maxValue = Math.max(...moves.map(m => m.value));

                // A type is "dominated" if we have many options AND high values
                dominated[type] = moves.length >= 3 && maxValue > 30;
            } else {
                dominated[type] = false;
            }
        }

        // Determine primary strategy based on hand composition
        let primaryStrategy = 'balanced';

        // Count unique pairs (not just pair combinations)
        const rankCounts = {};
        hand.forEach(c => {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        });
        const uniquePairs = Object.values(rankCounts).filter(count => count >= 2).length;

        // Strong in pairs - prefer pairs strategy if we have 4+ unique pairs
        // This takes priority because pairs give us control in pair battles
        if (uniquePairs >= 4) {
            primaryStrategy = 'pairs';
        }
        // Strong in 5-card hands and NOT strong in pairs - try to use 5-card hands
        else if (uniquePairs <= 2 &&
                 (strength[HAND_TYPES.STRAIGHT] >= 1 || strength[HAND_TYPES.FLUSH] >= 1 ||
                  strength[HAND_TYPES.FULL_HOUSE] >= 1)) {
            primaryStrategy = 'five_card';
        }
        // Mostly singles with few pairs - aggressive single play
        else if (uniquePairs <= 1 && strength[HAND_TYPES.SINGLE] >= 8) {
            primaryStrategy = 'singles';
        }

        return {
            movesByType,
            strength,
            dominated,
            primaryStrategy,
            totalMoves: allMoves.length
        };
    },

    /**
     * Select the best move using strategic considerations
     * Incorporates advanced Big 2 strategies:
     * - Card counting (tracking what's been played)
     * - Position awareness (help player before, oppose player after)
     * - Endgame tactics (3-card holdings, highest card logic)
     * - Milking strategy (slow play with strong hands)
     */
    selectBestMove: (candidates, hand, lastPlayedHand, isFirstTurn, ctx = {}, captureReasoning = false) => {
        const cardsRemaining = hand.length;

        // Extract game context
        const playerCardCounts = ctx.playerCardCounts || [13, 13, 13];
        const nextPlayerCards = playerCardCounts[0];
        const acrossPlayerCards = playerCardCounts[1];
        const prevPlayerCards = playerCardCounts[2];
        const minOpponentCards = Math.min(...playerCardCounts);
        const cardAnalysis = ctx.cardAnalysis || {};
        const lastPlayedByRelative = ctx.lastPlayedByRelative; // 1=next, 2=across, 3=previous
        const passedPlayers = ctx.passedPlayers || [];

        // Analyze our hand composition for strategic decisions
        const composition = BotLogic.analyzeHandComposition(hand);

        // Determine if we're in "danger mode" - opponent close to winning
        const dangerMode = minOpponentCards <= 2;
        const nextPlayerDanger = nextPlayerCards <= 2;

        // Check if we have the highest outstanding card (card counting benefit)
        const weHaveHighest = cardAnalysis.weHaveHighest || false;
        const twosOutstanding = cardAnalysis.twosOutstanding || 4;
        const twosInHand = cardAnalysis.twosInHand || 0;

        // Determine if we should use "milking" strategy (slow play with strong hand)
        // Milk when we have high cards and opponents have many cards
        const shouldMilk = weHaveHighest && minOpponentCards >= 8 && cardsRemaining >= 8;

        // Position awareness: Previous player (position 3) is "before" us, next player (position 1) is "after"
        // Strategy: Help the player before you (don't block them), oppose player after you
        const previousPlayerIsLow = prevPlayerCards <= 4;
        const nextPlayerIsLow = nextPlayerCards <= 4;

        // Track the primary reason for the winning move
        let primaryReason = null;

        // Evaluate each candidate move
        const scoredMoves = candidates.map(move => {
            let score = 0;
            const moveType = move.type;
            const moveCards = move.cards;
            const factors = captureReasoning ? [] : null;

            // Calculate remaining hand after this move
            const remainingHand = hand.filter(c =>
                !moveCards.some(mc => mc.rank === c.rank && mc.suit === c.suit)
            );

            // 1. Prioritize moves that get us closer to winning
            if (moveCards.length === cardsRemaining) {
                // This move wins the round - highest priority!
                score += 10000;
                if (factors) factors.push({ factor: 'Winning move!', points: 10000 });
            }

            // 2. CRITICAL: If opponent has 1-2 cards, avoid giving them easy wins
            if (dangerMode) {
                // Strongly prefer multi-card hands - opponent likely can't match
                if (moveCards.length >= 2) {
                    const pts = 200 * moveCards.length;
                    score += pts;
                    if (factors) factors.push({ factor: `Danger mode: multi-card hand (${moveCards.length} cards)`, points: pts });
                }
                // Penalize low singles that next player could easily beat
                if (moveType === HAND_TYPES.SINGLE && nextPlayerDanger) {
                    // Don't play low singles when next player has 1-2 cards
                    if (move.value < 40) { // Below King
                        score -= 500;
                        if (factors) factors.push({ factor: 'Danger: low single vs near-winning opponent', points: -500 });
                    }
                    // Even high singles are risky - they might have a 2
                    score -= 100;
                    if (factors) factors.push({ factor: 'Danger: singles risky vs low opponent', points: -100 });
                }
                // Strongly prefer pairs/triples/5-card hands
                if (moveType === HAND_TYPES.PAIR) {
                    score += 150;
                    if (factors) factors.push({ factor: 'Danger mode: prefer pairs', points: 150 });
                }
                if (moveType === HAND_TYPES.TRIPLE) {
                    score += 200;
                    if (factors) factors.push({ factor: 'Danger mode: prefer triples', points: 200 });
                }
                if (FIVE_CARD_PRIORITY[moveType]) {
                    score += 250;
                    if (factors) factors.push({ factor: 'Danger mode: prefer 5-card hands', points: 250 });
                }
            }

            // 3. If next player specifically is in danger, be extra careful
            if (nextPlayerDanger && !dangerMode) {
                // Don't play low singles into a player with 1-2 cards
                if (moveType === HAND_TYPES.SINGLE) {
                    if (move.value < 44) { // Below Ace
                        score -= 300;
                        if (factors) factors.push({ factor: 'Next player low: avoid low singles', points: -300 });
                    }
                }
                // Prefer hands the next player is less likely to beat
                if (moveCards.length >= 2) {
                    score += 100;
                    if (factors) factors.push({ factor: 'Next player low: prefer multi-card', points: 100 });
                }
            }

            // 4. Prefer using lower value cards (save high cards for control)
            // But reduce this preference in danger mode AND on free play
            const maxCardValue = 12 * 4 + 3; // 2 of Spades
            const avgCardValue = moveCards.reduce((sum, c) => sum + c.value, 0) / moveCards.length;
            // Reduce save-high-cards bonus on free play to encourage aggressive multi-card plays
            const valueSaveBonus = dangerMode ? 2 : (!lastPlayedHand ? 5 : 10);
            const savePts = Math.round((maxCardValue - avgCardValue) * valueSaveBonus);
            score += savePts;
            if (factors && Math.abs(savePts) > 20) factors.push({ factor: 'Save high cards bonus', points: savePts });

            // 5. Prefer keeping 2s unless necessary (less important in danger mode)
            const twosInMove = moveCards.filter(c => c.rank === '2').length;
            const twosInHandLocal = hand.filter(c => c.rank === '2').length;
            if (twosInMove > 0 && twosInHandLocal > twosInMove && !dangerMode) {
                const pts = -twosInMove * 50;
                score += pts;
                if (factors) factors.push({ factor: 'Preserve 2s', points: pts });
            }

            // 6. Strategy based on hand composition
            if (composition.primaryStrategy === 'pairs') {
                if (moveType === HAND_TYPES.PAIR) {
                    score += 60;
                    if (factors) factors.push({ factor: 'Pairs strategy: playing pair', points: 60 });
                }
                if (moveType === HAND_TYPES.SINGLE) {
                    const cardRank = moveCards[0].rank;
                    const sameRankInHand = hand.filter(c => c.rank === cardRank).length;
                    if (sameRankInHand >= 2) {
                        score -= 20;
                        if (factors) factors.push({ factor: 'Pairs strategy: avoid breaking pair', points: -20 });
                    }
                }
                if (moveCards.length === 5) {
                    const pairsUsed = BotLogic.countPairsUsedInMove(moveCards, hand);
                    const pts = -pairsUsed * 30;
                    if (pts !== 0) {
                        score += pts;
                        if (factors) factors.push({ factor: `5-card uses ${pairsUsed} pairs`, points: pts });
                    }
                }
            } else if (composition.primaryStrategy === 'five_card') {
                if (FIVE_CARD_PRIORITY[moveType]) {
                    score += 80;
                    if (factors) factors.push({ factor: '5-card strategy: playing combo', points: 80 });
                }
            } else if (composition.primaryStrategy === 'singles') {
                if (moveType === HAND_TYPES.SINGLE) {
                    score += 30;
                    if (factors) factors.push({ factor: 'Singles strategy: playing single', points: 30 });
                }
            }

            // 7. Prefer keeping pairs/triples intact when playing singles
            // Reduce penalties on free play since we want to play aggressively
            if (moveType === HAND_TYPES.SINGLE && composition.primaryStrategy !== 'pairs') {
                const cardRank = moveCards[0].rank;
                const sameRankInHand = hand.filter(c => c.rank === cardRank).length;
                // Only apply penalties if not free play, or apply reduced penalties
                if (!lastPlayedHand) {
                    // On free play, slight penalty but not much - we prefer multi-card hands anyway
                    if (sameRankInHand >= 3) {
                        score -= 30;
                        if (factors) factors.push({ factor: 'Breaking triple on free play', points: -30 });
                    } else if (sameRankInHand >= 2) {
                        score -= 15;
                        if (factors) factors.push({ factor: 'Breaking pair on free play', points: -15 });
                    }
                } else {
                    // When beating a hand, full penalties apply
                    if (sameRankInHand >= 3) {
                        score -= 100;
                        if (factors) factors.push({ factor: 'Avoid breaking triple', points: -100 });
                    } else if (sameRankInHand >= 2) {
                        score -= 40;
                        if (factors) factors.push({ factor: 'Avoid breaking pair', points: -40 });
                    }
                }
            }

            // 8. When playing pairs, consider if we're breaking triples
            // Reduce penalty on free play
            if (moveType === HAND_TYPES.PAIR) {
                const cardRank = moveCards[0].rank;
                const sameRankInHand = hand.filter(c => c.rank === cardRank).length;
                if (sameRankInHand >= 3) {
                    // On free play, breaking a triple to play a pair is fine - we're being aggressive
                    const penaltyMultiplier = !lastPlayedHand ? 0.3 : 1.0;
                    if (composition.strength[HAND_TYPES.PAIR] >= 4) {
                        const pts = Math.round(-20 * penaltyMultiplier);
                        score += pts;
                        if (factors && pts !== 0) factors.push({ factor: 'Breaking triple (but have many pairs)', points: pts });
                    } else {
                        const pts = Math.round(-60 * penaltyMultiplier);
                        score += pts;
                        if (factors && pts !== 0) factors.push({ factor: 'Breaking triple', points: pts });
                    }
                }
            }

            // 9. Bonus for playing 5-card hands
            if (FIVE_CARD_PRIORITY[moveType]) {
                let fiveCardBonus = 30 + FIVE_CARD_PRIORITY[moveType] * 5;

                const fiveCardMoves = candidates.filter(c => c.cards.length === 5);
                if (fiveCardMoves.length > 1) {
                    const thisPriority = FIVE_CARD_PRIORITY[moveType] || 0;
                    fiveCardBonus += (5 - thisPriority) * 20;
                }

                if (composition.primaryStrategy === 'pairs') {
                    const pairsUsed = BotLogic.countPairsUsedInMove(moveCards, hand);
                    if (pairsUsed >= 2) {
                        fiveCardBonus -= 40;
                    }
                }

                score += fiveCardBonus;
                if (factors) factors.push({ factor: '5-card hand bonus', points: fiveCardBonus });
            }

            // 10. If free play, prefer hand types we're strongest in
            // UPDATED: More aggressive free play - prioritize clearing cards fast
            if (!lastPlayedHand) {
                const typeStrength = composition.strength[moveType] || 0;
                if (typeStrength >= 3) {
                    score += 40;
                    if (factors) factors.push({ factor: 'Free play: strong in this type', points: 40 });
                } else if (typeStrength >= 2) {
                    score += 20;
                    if (factors) factors.push({ factor: 'Free play: moderate in type', points: 20 });
                }

                // AGGRESSIVE FREE PLAY: Strongly prefer multi-card hands to reduce hand size faster
                // This makes bots play more aggressively when they have the lead
                if (dangerMode) {
                    // In danger mode, be even more aggressive
                    if (moveType === HAND_TYPES.PAIR) {
                        score += 120;
                        if (factors) factors.push({ factor: 'Danger free play: pair', points: 120 });
                    }
                    else if (moveType === HAND_TYPES.TRIPLE) {
                        score += 150;
                        if (factors) factors.push({ factor: 'Danger free play: triple', points: 150 });
                    }
                    else if (FIVE_CARD_PRIORITY[moveType]) {
                        score += 200;
                        if (factors) factors.push({ factor: 'Danger free play: 5-card', points: 200 });
                    }
                } else {
                    // Normal free play - still be aggressive about reducing hand size
                    if (moveType === HAND_TYPES.PAIR) {
                        score += 100;
                        if (factors) factors.push({ factor: 'Free play: pair (aggressive)', points: 100 });
                    }
                    else if (moveType === HAND_TYPES.TRIPLE) {
                        score += 120;
                        if (factors) factors.push({ factor: 'Free play: triple (aggressive)', points: 120 });
                    }
                    else if (FIVE_CARD_PRIORITY[moveType]) {
                        // Strongly favor 5-card hands - they clear 5 cards at once!
                        const fiveCardBonus = 150 + FIVE_CARD_PRIORITY[moveType] * 10;
                        score += fiveCardBonus;
                        if (factors) factors.push({ factor: 'Free play: 5-card hand (aggressive)', points: fiveCardBonus });
                    }
                    // Singles are acceptable but much less preferred
                    else if (moveType === HAND_TYPES.SINGLE) {
                        score += 5;
                    }

                    // Additional strategy-specific bonuses
                    if (composition.primaryStrategy === 'pairs') {
                        if (moveType === HAND_TYPES.PAIR) {
                            score += 30;
                            if (factors) factors.push({ factor: 'Pairs strategy bonus', points: 30 });
                        }
                    } else if (composition.primaryStrategy === 'five_card') {
                        if (FIVE_CARD_PRIORITY[moveType]) {
                            score += 40;
                            if (factors) factors.push({ factor: '5-card strategy bonus', points: 40 });
                        }
                    }
                }
            }

            // 11. Consider the value needed to beat - don't waste high cards
            if (lastPlayedHand && !dangerMode) {
                const valueGap = move.value - lastPlayedHand.value;
                if (valueGap > 0 && valueGap <= 8) {
                    score += 25;
                    if (factors) factors.push({ factor: 'Efficient beat (small gap)', points: 25 });
                } else if (valueGap > 20) {
                    score -= 15;
                    if (factors) factors.push({ factor: 'Overkill (large gap)', points: -15 });
                }
            }

            // 12. End-game strategy: when few cards left, prioritize clearing
            if (cardsRemaining <= 5) {
                const pts = moveCards.length * 30;
                score += pts;
                if (factors) factors.push({ factor: 'Endgame: clear cards fast', points: pts });
            }

            // 13. Evaluate remaining hand quality after this move
            const remainingQuality = BotLogic.evaluateHandQuality(remainingHand);
            const qualityPts = Math.round(remainingQuality * 5);
            score += qualityPts;
            if (factors && Math.abs(qualityPts) > 20) factors.push({ factor: 'Remaining hand quality', points: qualityPts });

            // 14. Consider remaining hand composition
            if (remainingHand.length > 0 && !dangerMode) {
                const remainingComposition = BotLogic.analyzeHandComposition(remainingHand);
                if (remainingComposition.totalMoves > cardsRemaining) {
                    score += 15;
                }
                if (remainingComposition.strength[HAND_TYPES.PAIR] === 0 &&
                    remainingHand.length > 3) {
                    score -= 20;
                    if (factors) factors.push({ factor: 'Would leave no pairs', points: -20 });
                }
            }

            // 15. POSITION AWARENESS: Consider who played last and who will play next
            // If previous player (before us) played last, they likely have control
            // Don't waste high cards beating them if they're close to winning
            if (lastPlayedByRelative === 3 && previousPlayerIsLow) {
                // Previous player is low on cards and played - let them try to win
                // unless we're also low or it's dangerous
                if (!dangerMode && cardsRemaining > 5) {
                    // Penalize using high cards against player before us
                    const avgValue = moveCards.reduce((sum, c) => sum + c.value, 0) / moveCards.length;
                    if (avgValue > 35) { // High cards
                        score -= 40;
                        if (factors) factors.push({ factor: 'Position: help prev player', points: -40 });
                    }
                }
            }

            // If next player is low on cards, be aggressive - block them!
            if (nextPlayerIsLow && !passedPlayers.includes(0)) {
                // Next player hasn't passed yet and is low - play something hard to beat
                if (move.value > 40) { // High value hand
                    score += 50;
                    if (factors) factors.push({ factor: 'Block next player (high value)', points: 50 });
                }
                if (twosInMove > 0 && nextPlayerCards <= 2) {
                    // Use 2s to block if next player is about to win
                    score += 80;
                    if (factors) factors.push({ factor: 'Use 2 to block winning player', points: 80 });
                }
            }

            // 16. MILKING STRATEGY: When we have control and high cards, play low to draw out opponent's high cards
            if (shouldMilk && !lastPlayedHand) {
                // Free play and we should milk - prefer low singles to draw out opponent cards
                if (moveType === HAND_TYPES.SINGLE && move.value < 30) {
                    score += 60; // Play low singles to bait out higher cards
                    if (factors) factors.push({ factor: 'Milking: play low to bait', points: 60 });
                }
                // Don't waste our high cards yet
                if (twosInMove > 0) {
                    score -= 80;
                    if (factors) factors.push({ factor: 'Milking: save 2s', points: -80 });
                }
                const avgValue = moveCards.reduce((sum, c) => sum + c.value, 0) / moveCards.length;
                if (avgValue > 40) {
                    score -= 50;
                    if (factors) factors.push({ factor: 'Milking: save high cards', points: -50 });
                }
            }

            // 17. CARD COUNTING BENEFIT: Use knowledge of played cards
            // If all 2s are accounted for (played or in our hand), our Aces are essentially 2s
            if (twosOutstanding === 0 && twosInHand === 0) {
                // All 2s are gone - Aces are now the highest singles
                if (moveType === HAND_TYPES.SINGLE && moveCards[0].rank === 'A') {
                    score += 30; // Our Ace is guaranteed to win singles
                    if (factors) factors.push({ factor: 'Card count: Ace is now highest', points: 30 });
                }
            }

            // If we have the only remaining 2(s), we have guaranteed control
            if (weHaveHighest && twosInHand > 0 && twosOutstanding === 0) {
                // We have all remaining 2s - don't waste them unless necessary
                if (twosInMove > 0 && !dangerMode && cardsRemaining > 4) {
                    score -= 60; // Save 2s for when we really need them
                    if (factors) factors.push({ factor: 'Save guaranteed control (2s)', points: -60 });
                }
            }

            // 18. ENDGAME TACTICS: Special handling for 3-card holdings
            if (cardsRemaining === 3) {
                // Classic endgame: with highest card + 2 others, play second-highest first
                const sortedHand = [...hand].sort((a, b) => a.value - b.value);
                const highestInHand = sortedHand[2];
                const secondHighest = sortedHand[1];

                if (weHaveHighest) {
                    // We have the highest card - play mid card first, then low, save high for last
                    if (moveType === HAND_TYPES.SINGLE) {
                        if (moveCards[0].value === secondHighest.value) {
                            score += 100; // Play second highest
                            if (factors) factors.push({ factor: '3-card endgame: play middle', points: 100 });
                        } else if (moveCards[0].value === highestInHand.value) {
                            score -= 50; // Don't lead with highest
                            if (factors) factors.push({ factor: '3-card endgame: save highest', points: -50 });
                        }
                    }
                }
            }

            // 19. ADD UNPREDICTABILITY: Small random factor to avoid being too predictable
            // This makes bot behavior less exploitable
            const randomPts = Math.round((Math.random() - 0.5) * 10);
            score += randomPts;

            return { move, score, factors };
        });

        // Sort by score (highest first) and return the best
        scoredMoves.sort((a, b) => b.score - a.score);

        // Determine primary reason based on top factors
        if (captureReasoning && scoredMoves[0].factors && scoredMoves[0].factors.length > 0) {
            const topFactors = scoredMoves[0].factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
            primaryReason = topFactors[0]?.factor || 'Best overall score';
        }

        if (captureReasoning) {
            return {
                move: scoredMoves[0].move,
                scoredMoves,
                primaryReason
            };
        }

        return scoredMoves[0].move;
    },

    /**
     * Analyze played cards to determine what's still outstanding
     * This enables card counting strategy
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
            // How many 2s are still unaccounted for (not in hand, not played)
            twosOutstanding: 0,
            twosInHand: 0,
            // Highest outstanding cards (not in hand, not played)
            highestOutstanding: null,
            // Do we have the highest outstanding card?
            weHaveHighest: false,
            // Outstanding cards by rank
            outstandingByRank: {},
            // Total cards outstanding (in opponents' hands)
            totalOutstanding: 0
        };

        // Find outstanding cards
        let highestOutstandingValue = -1;
        let highestInHandValue = -1;

        for (const key in allCards) {
            const rank = key.slice(0, -1);
            const suit = key.slice(-1);
            const value = RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit);

            if (allCards[key] === 'unknown') {
                analysis.totalOutstanding++;
                if (!analysis.outstandingByRank[rank]) {
                    analysis.outstandingByRank[rank] = 0;
                }
                analysis.outstandingByRank[rank]++;

                if (rank === '2') {
                    analysis.twosOutstanding++;
                }
                if (value > highestOutstandingValue) {
                    highestOutstandingValue = value;
                    analysis.highestOutstanding = { rank, suit, value };
                }
            } else if (allCards[key] === 'in_hand') {
                if (rank === '2') {
                    analysis.twosInHand++;
                }
                if (value > highestInHandValue) {
                    highestInHandValue = value;
                }
            }
        }

        // Do we have the highest card still in play?
        analysis.weHaveHighest = highestInHandValue >= highestOutstandingValue;

        return analysis;
    },

    /**
     * Count how many pairs are used/broken by a move
     */
    countPairsUsedInMove: (moveCards, hand) => {
        let pairsUsed = 0;
        const ranksInMove = moveCards.map(c => c.rank);
        const uniqueRanks = [...new Set(ranksInMove)];

        for (const rank of uniqueRanks) {
            const inMove = moveCards.filter(c => c.rank === rank).length;
            const inHand = hand.filter(c => c.rank === rank).length;

            // If we had a pair or better and we're using at least one
            if (inHand >= 2 && inMove >= 1) {
                pairsUsed++;
            }
        }

        return pairsUsed;
    },

    /**
     * Evaluate the quality of a hand (higher = better)
     */
    evaluateHandQuality: (hand) => {
        if (hand.length === 0) return 100; // Empty hand is best!

        let quality = 0;

        // Count high cards (As and 2s)
        const twos = hand.filter(c => c.rank === '2').length;
        const aces = hand.filter(c => c.rank === 'A').length;
        quality += twos * 15 + aces * 8;

        // Count pairs/triples/quads
        const rankCounts = {};
        hand.forEach(c => {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        });

        for (const rank in rankCounts) {
            const count = rankCounts[rank];
            if (count === 4) quality += 30;
            else if (count === 3) quality += 20;
            else if (count === 2) quality += 10;
        }

        // Check for potential straights
        const rankIndices = [...new Set(hand.map(c => RANKS.indexOf(c.rank)))].sort((a, b) => a - b);
        let consecutiveCount = 1;
        for (let i = 1; i < rankIndices.length; i++) {
            if (rankIndices[i] === rankIndices[i-1] + 1) {
                consecutiveCount++;
            } else {
                consecutiveCount = 1;
            }
            if (consecutiveCount >= 4) quality += 15; // Close to a straight
            if (consecutiveCount >= 5) quality += 25; // Have a straight
        }

        // Check for potential flushes
        const suitCounts = {};
        hand.forEach(c => {
            suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
        });
        for (const suit in suitCounts) {
            if (suitCounts[suit] >= 5) quality += 25;
            else if (suitCounts[suit] === 4) quality += 10;
        }

        return quality;
    },

    /**
     * Generate all valid moves from a hand
     */
    getAllValidMoves: (hand) => {
        const moves = [];

        // Group cards by rank and suit for easier lookup
        const byRank = {};
        const bySuit = {};
        hand.forEach(c => {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        });

        // Singles
        for (const card of hand) {
            moves.push(Big2Rules.validateHand([card]));
        }

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
                // All combinations of 3 from available cards of this rank
                const tripleCombos = BotLogic.getCombinations(cards, 3);
                for (const combo of tripleCombos) {
                    moves.push(Big2Rules.validateHand(combo));
                }
            }
        }

        // 5-card hands
        if (hand.length >= 5) {
            // Straights
            const straights = BotLogic.findAllStraights(hand, byRank);
            for (const straight of straights) {
                const validated = Big2Rules.validateHand(straight);
                if (validated) moves.push(validated);
            }

            // Flushes
            for (const suit in bySuit) {
                if (bySuit[suit].length >= 5) {
                    const flushes = BotLogic.getCombinations(bySuit[suit], 5);
                    for (const flush of flushes) {
                        const validated = Big2Rules.validateHand(flush);
                        if (validated && validated.type === HAND_TYPES.FLUSH) {
                            moves.push(validated);
                        }
                        // Note: Straight flushes will be caught by straight detection
                    }
                }
            }

            // Full Houses
            const fullHouses = BotLogic.findAllFullHouses(hand, byRank);
            for (const fh of fullHouses) {
                const validated = Big2Rules.validateHand(fh);
                if (validated) moves.push(validated);
            }

            // Four of a Kind (Quads)
            const quads = BotLogic.findAllQuads(hand, byRank);
            for (const quad of quads) {
                const validated = Big2Rules.validateHand(quad);
                if (validated) moves.push(validated);
            }
        }

        return moves.filter(m => m !== null);
    },

    /**
     * Find all possible straights in hand
     * Valid straights:
     * - A-2-3-4-5 (lowest, "wheel")
     * - 2-3-4-5-6 (second lowest)
     * - 3-4-5-6-7 through 10-J-Q-K-A
     * Invalid: J-Q-K-A-2 (2 cannot be high end)
     */
    findAllStraights: (hand, byRank) => {
        const straights = [];

        // Special straight: A-2-3-4-5 (lowest straight - "wheel")
        const wheelRanks = ['A', '2', '3', '4', '5'];
        if (wheelRanks.every(r => byRank[r] && byRank[r].length > 0)) {
            const straightCombos = BotLogic.getStraightCombinations(wheelRanks, byRank);
            straights.push(...straightCombos);
        }

        // Special straight: 2-3-4-5-6 (second lowest)
        const lowStraightRanks = ['2', '3', '4', '5', '6'];
        if (lowStraightRanks.every(r => byRank[r] && byRank[r].length > 0)) {
            const straightCombos = BotLogic.getStraightCombinations(lowStraightRanks, byRank);
            straights.push(...straightCombos);
        }

        // Standard straights (5 consecutive ranks, excluding 2)
        // RANKS: ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
        // Valid straights: indices 0-4 through 7-11 (3-4-5-6-7 through 10-J-Q-K-A)
        for (let startIdx = 0; startIdx <= 7; startIdx++) { // 3-4-5-6-7 through 10-J-Q-K-A
            const neededRanks = RANKS.slice(startIdx, startIdx + 5);
            // Make sure we don't include '2' (index 12)
            if (neededRanks.includes('2')) continue;

            if (neededRanks.length === 5 && neededRanks.every(r => byRank[r] && byRank[r].length > 0)) {
                // We have all ranks for this straight
                const straightCombos = BotLogic.getStraightCombinations(neededRanks, byRank);
                straights.push(...straightCombos);
            }
        }

        return straights;
    },

    /**
     * Get all combinations of cards that form a straight with given ranks
     */
    getStraightCombinations: (ranks, byRank) => {
        const combinations = [];

        // Get all possible cards for each rank position
        const cardOptions = ranks.map(r => byRank[r] || []);

        // Generate all combinations (one card from each rank)
        const generateCombos = (index, current) => {
            if (index === ranks.length) {
                combinations.push([...current]);
                return;
            }
            for (const card of cardOptions[index]) {
                current.push(card);
                generateCombos(index + 1, current);
                current.pop();
            }
        };

        generateCombos(0, []);
        return combinations;
    },

    /**
     * Find all possible full houses
     */
    findAllFullHouses: (hand, byRank) => {
        const fullHouses = [];

        // Find all triples
        const tripleRanks = Object.keys(byRank).filter(r => byRank[r].length >= 3);
        // Find all pairs (including from triples/quads)
        const pairRanks = Object.keys(byRank).filter(r => byRank[r].length >= 2);

        for (const tripleRank of tripleRanks) {
            const tripleCombos = BotLogic.getCombinations(byRank[tripleRank], 3);

            for (const pairRank of pairRanks) {
                if (pairRank === tripleRank) continue; // Can't use same rank for both

                const pairCombos = BotLogic.getCombinations(byRank[pairRank], 2);

                for (const triple of tripleCombos) {
                    for (const pair of pairCombos) {
                        fullHouses.push([...triple, ...pair]);
                    }
                }
            }
        }

        return fullHouses;
    },

    /**
     * Find all possible quads (four of a kind + kicker)
     */
    findAllQuads: (hand, byRank) => {
        const quads = [];

        const quadRanks = Object.keys(byRank).filter(r => byRank[r].length === 4);

        for (const quadRank of quadRanks) {
            const quadCards = byRank[quadRank];

            // Add any other card as kicker
            for (const card of hand) {
                if (card.rank !== quadRank) {
                    quads.push([...quadCards, card]);
                }
            }
        }

        return quads;
    },

    /**
     * Get all combinations of k elements from array
     */
    getCombinations: (arr, k) => {
        if (k > arr.length) return [];
        if (k === arr.length) return [arr];
        if (k === 1) return arr.map(x => [x]);

        const result = [];

        const combine = (start, combo) => {
            if (combo.length === k) {
                result.push([...combo]);
                return;
            }
            for (let i = start; i < arr.length; i++) {
                combo.push(arr[i]);
                combine(i + 1, combo);
                combo.pop();
            }
        };

        combine(0, []);
        return result;
    }
};

module.exports = { BotLogic };
