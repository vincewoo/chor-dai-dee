// server/test/botHarness.js
//
// Dependency-free self-play harness for evaluating bot logic.
//
// Mirrors the rules RoomManager enforces (trick flow, 3D opening lead, the
// 2S auto-pass, round scoring) closely enough that a bot which plays well here
// plays well in a real room. Each seat can run a different implementation, so
// a candidate change can be measured head-to-head against the current bot
// instead of eyeballed.
//
//   node server/test/botBench.js        # run the standard benchmark

const { Big2Rules } = require('../game/Big2Rules');
const { SUITS, RANKS } = require('../game/Deck');
const { calculateRoundScores } = require('../game/Scoring');
const { buildGameContext } = require('../game/BotContext');
const { HAND_TYPE_ORDINALS } = require('../game/Big2Rules');
const { ACTION, encodeCards } = require('../game/TapeCodec');

/** Deterministic PRNG (mulberry32) so benchmark runs are reproducible. */
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildDeck() {
    const cards = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            cards.push({ suit, rank, value: RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit) });
        }
    }
    return cards;
}

function deal(rng) {
    const deck = buildDeck();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return [0, 1, 2, 3].map(i => deck.slice(i * 13, i * 13 + 13));
}

/**
 * Play a single round to completion.
 * @param {Array<Object>} seats - 4 entries of { name, logic } where logic exposes getBotMove
 * @param {Array<Array>} hands - starting hands
 * @param {number|null} startingSeat - seat to lead, or null to use the 3D rule
 * @param {Function|null} onPly - optional recorder called with each ply in the
 *        game-log format, plus the observation the bot actually saw. Lets tests
 *        produce real tapes from self-play and check that replay reconstructs
 *        the identical state. Purely observational - it must not affect play.
 * @returns {Object} { winnerSeat, cardsLeft: number[], tricks, plays }
 */
function playRound(seats, hands, startingSeat = null, onPly = null) {
    hands = hands.map(h => [...h]);
    let ply = 0;
    const record = (entry) => { if (onPly) onPly({ ply: ply++, ...entry }); };

    let turn = startingSeat;
    if (turn === null) {
        turn = hands.findIndex(h => h.some(c => c.rank === '3' && c.suit === 'D'));
    }
    const isOpeningRound = startingSeat === null;

    let lastPlayedHand = null;     // { type, value, cards, seat }
    let passedSeats = new Set();
    let consecutivePasses = 0;
    let playedCards = [];
    let trickHistory = [];         // ordered plays/passes, survives trick boundaries
    let tricks = 0;
    let plays = 0;
    let guard = 0;

    while (guard++ < 2000) {
        if (hands[turn].length === 0) break;

        const isFirstTurn = isOpeningRound && playedCards.length === 0;

        // Shared with RoomManager.checkBotTurn - see BotContext.js. This used to
        // be a hand-maintained copy under a comment promising it matched.
        const gameContext = buildGameContext({
            hands,
            seat: turn,
            passedSeats,
            passCount: consecutivePasses,
            playedCards,
            trickHistory,
            lastPlayedHand,
            profile: seats[turn].profile || null,
            rng: seats[turn].rng || undefined
        });

        const logic = seats[turn].logic;
        const move = logic.getBotMove(hands[turn], lastPlayedHand, isFirstTurn, gameContext, false);

        if (move && move.length) {
            const validated = Big2Rules.validateHand(move);
            if (!validated) throw new Error(`${seats[turn].name} produced an invalid hand: ${JSON.stringify(move)}`);
            if (lastPlayedHand && !Big2Rules.canBeat(validated, lastPlayedHand)) {
                throw new Error(`${seats[turn].name} produced a hand that cannot beat the pile`);
            }
            if (isFirstTurn && !move.some(c => c.rank === '3' && c.suit === 'D')) {
                throw new Error(`${seats[turn].name} opened without the 3 of Diamonds`);
            }
            for (const card of move) {
                const idx = hands[turn].findIndex(c => c.rank === card.rank && c.suit === card.suit);
                if (idx === -1) throw new Error(`${seats[turn].name} played a card it does not hold`);
                hands[turn].splice(idx, 1);
                playedCards.push({ rank: card.rank, suit: card.suit, value: card.value });
            }
            plays++;
            record({
                seat: turn,
                action: ACTION.PLAY,
                cards_mask: encodeCards(validated.cards),
                hand_type: HAND_TYPE_ORDINALS[validated.type],
                hand_value: validated.value,
                obs: gameContext
            });
            trickHistory.push({ seat: turn, action: 'play', hand: validated });
            lastPlayedHand = { ...validated, seat: turn };

            if (hands[turn].length === 0) break;

            // RoomManager auto-passes everyone against a lone 2S.
            const isSingleBig2 = validated.type === 'SINGLE' && validated.cards[0].rank === '2'
                && validated.cards[0].suit === 'S';
            if (isSingleBig2) {
                passedSeats = new Set([0, 1, 2, 3].filter(s => s !== turn));
                consecutivePasses = 3;
                // The server records these as explicit plies rather than
                // leaving replay to re-derive a house rule that may change.
                for (const seat of [1, 2, 3].map(i => (turn + i) % 4)) {
                    record({ seat, action: ACTION.AUTO_PASS, cards_mask: 0 });
                }
            } else {
                passedSeats = new Set();
                consecutivePasses = 0;
            }
        } else {
            record({ seat: turn, action: ACTION.PASS, cards_mask: 0, obs: gameContext });
            // Strip `seat` from the pile: identity lives on the entry, not on
            // the hand. Matches RoomManager and Replayer.
            const { seat: _pileSeat, ...pileHand } = lastPlayedHand;
            trickHistory.push({ seat: turn, action: 'pass', hand: pileHand });
            passedSeats.add(turn);
            consecutivePasses++;
        }

        // Trick resolution: everyone except the last player to act has passed.
        if (lastPlayedHand) {
            const others = [0, 1, 2, 3].filter(s => s !== lastPlayedHand.seat);
            if (others.every(s => passedSeats.has(s))) {
                turn = lastPlayedHand.seat;
                lastPlayedHand = null;
                passedSeats = new Set();
                consecutivePasses = 0;
                tricks++;
                continue;
            }
        }

        let attempts = 0;
        do {
            turn = (turn + 1) % 4;
            attempts++;
        } while (passedSeats.has(turn) && attempts < 4);
    }

    const winnerSeat = hands.findIndex(h => h.length === 0);
    return {
        winnerSeat: winnerSeat === -1 ? 0 : winnerSeat,
        cardsLeft: hands.map(h => h.length),
        tricks,
        plays
    };
}

/**
 * Run many rounds, rotating seat assignment so seat order cannot bias results.
 * @param {Array<Object>} contenders - 4 entries of { name, logic }
 * @param {Object} opts - { rounds, seed }
 * @returns {Object} per-contender aggregate stats
 */
function runBenchmark(contenders, { rounds = 400, seed = 12345 } = {}) {
    const rng = makeRng(seed);
    const stats = contenders.map(c => ({
        name: c.name, wins: 0, points: 0, cardsLeft: 0, rounds: 0
    }));

    for (let r = 0; r < rounds; r++) {
        // Rotate which contender sits in which seat.
        const rotation = r % 4;
        const seats = [0, 1, 2, 3].map(s => contenders[(s + rotation) % 4]);
        const seatToContender = s => (s + rotation) % 4;

        const hands = deal(rng);
        const result = playRound(seats, hands, null);

        const players = seats.map((s, i) => ({ id: i, name: s.name, isBot: true, hand: { length: result.cardsLeft[i] } }));
        const scores = calculateRoundScores({ id: result.winnerSeat }, players);

        for (let s = 0; s < 4; s++) {
            const st = stats[seatToContender(s)];
            st.rounds++;
            st.points += scores[s].roundPoints;
            st.cardsLeft += result.cardsLeft[s];
            if (s === result.winnerSeat) st.wins++;
        }
    }

    return stats.map(s => ({
        name: s.name,
        rounds: s.rounds,
        wins: s.wins,
        winRate: s.wins / s.rounds,
        avgPoints: s.points / s.rounds,
        avgCardsLeft: s.cardsLeft / s.rounds
    }));
}

/**
 * Measure a specific behaviour: how often a bot answers a low single (rank <= 9)
 * with a K/A/2 despite holding a cheaper legal beater.
 */
function measureHighCardLeakage(logic, { handSize = 9, samples = 400, seed = 7 } = {}) {
    const rng = makeRng(seed);
    const deck = buildDeck();
    let trials = 0, burned = 0;

    for (let t = 0; t < samples * 40 && trials < samples; t++) {
        const shuffled = [...deck];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const hand = shuffled.slice(0, handSize);
        const lead = shuffled[handSize];
        if (RANKS.indexOf(lead.rank) > 6) continue;             // lead must be <= 9
        const beaters = hand.filter(c => c.value > lead.value);
        if (beaters.length < 2) continue;
        if (!beaters.some(c => !['K', 'A', '2'].includes(c.rank))) continue;  // need a cheaper option

        trials++;
        const move = logic.getBotMove(hand, Big2Rules.validateHand([lead]), false, {
            playerCardCounts: [handSize, handSize, handSize],
            passedPlayers: [], passCount: 0, playedCards: []
        }, false);
        if (move && move.length === 1 && ['K', 'A', '2'].includes(move[0].rank)) burned++;
    }

    return { trials, burned, rate: trials ? burned / trials : 0 };
}

module.exports = { makeRng, buildDeck, deal, playRound, runBenchmark, measureHighCardLeakage };
