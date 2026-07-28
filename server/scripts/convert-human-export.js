#!/usr/bin/env node
// Convert pseudonymized game-log shards into candidate-value replay rows.
//
// Only the acting player's public observation is reconstructed. `hidden.hands`
// is deliberately never read. Full exports (rather than --humans-only exports)
// are needed because all four seats' round labels reconstruct the zero-sum
// utility assigned to a human decision.
//
// Guest seats are opt-in via --include-guests. A guest has no account, so the
// export carries occupant 'guest' with subject null: they are selectable only
// as one anonymous pool, never as an individual player. Nothing else about the
// conversion changes, because a trajectory is keyed on game:round:seat rather
// than on who was sitting there.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { CARD_BY_VALUE } = require('../game/TapeCodec');
const { Big2Rules, RULES_VERSION } = require('../game/Big2Rules');
const { BotLogic, BOT_LOGIC_VERSION } = require('../game/BotLogic');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const { decisionOptions, encodeCandidate } = require('../game/RLValueBot');
const { writeRows } = require('./generate-rl-experience');

function parseArgs(argv) {
    const args = {
        input: null,
        output: path.resolve('ai/human.rl-experience.bin'),
        subject: null,
        includeGuests: false,
        gamma: 0.995
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--input') args.input = path.resolve(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--subject') args.subject = argv[++i];
        else if (flag === '--include-guests') args.includeGuests = true;
        else if (flag === '--gamma') args.gamma = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

const USAGE = `
Usage: node scripts/convert-human-export.js --input DIR --subject HMAC [options]

  --input DIR       directory containing big2-*.jsonl.gz shards
  --subject HMAC    pseudonymized subject, for example h:0123abcd...
  --include-guests  also convert guest seats, as one anonymous pool
  --output FILE     float32 replay buffer
  --gamma N         discount between the player's decisions

Either --subject or --include-guests is required. Passing only
--include-guests converts guest decisions alone, which is what an A/B of
guest data against an account-only baseline needs.
`;

function readShards(input) {
    const files = fs.statSync(input).isDirectory()
        ? fs.readdirSync(input)
            .filter(name => name.endsWith('.jsonl.gz'))
            .sort()
            .map(name => path.join(input, name))
        : [input];
    if (!files.length) throw new Error(`No .jsonl.gz shards found in ${input}`);

    const records = [];
    for (const file of files) {
        const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
        for (const line of text.split('\n')) {
            if (line) records.push(JSON.parse(line));
        }
    }
    return { files, records };
}

function cards(values) {
    return values.map(value => {
        const card = CARD_BY_VALUE[value];
        if (!card) throw new Error(`Card value ${value} is outside 0-51`);
        return card;
    });
}

function actionKey(record) {
    if (record.action.type === 'pass') return 'pass';
    return cards(record.action.cards)
        .map(card => `${card.rank}${card.suit}`)
        .sort()
        .join(',');
}

function reconstructActionSet(record) {
    const hand = cards(record.obs.hand);
    const playedCards = cards(record.obs.played);
    const pileCards = record.obs.pile ? cards(record.obs.pile.cards) : null;
    const lastPlayedHand = pileCards ? Big2Rules.validateHand(pileCards) : null;
    if (pileCards && !lastPlayedHand) throw new Error('Exported pile is not a legal hand');

    // Only round one opens specifically on 3D. Later rounds are led by the
    // previous winner and may begin from a full hand with no pile as well.
    const isFirstTurn = record.round === 1 &&
        playedCards.length === 0 &&
        !lastPlayedHand &&
        hand.some(card => card.value === 0);
    const gameContext = {
        playerCardCounts: record.obs.counts_rel,
        lastPlayedByRelative: record.obs.pile_owner_rel,
        passedPlayers: record.obs.passed_rel,
        passCount: record.obs.pass_count,
        playedCards,
        // Export history intentionally omits exact cards. The learned features
        // do not consume it; leaving it empty avoids fabricating information.
        playHistory: [],
        profile: null
    };
    const options = decisionOptions({
        hand, lastPlayedHand, isFirstTurn, gameContext
    });
    const key = actionKey(record);
    let chosenIndex = options.findIndex(option => option.key === key);
    if (chosenIndex !== -1) {
        return {
            actionFeatures: options.map(option => [...option.features]),
            chosenIndex,
            heuristicIndex: options.findIndex(
                option => option.isHeuristicChoice),
            exactActionAdded: false
        };
    }

    // BotLogic deliberately abstracts large action sets to a few strategic
    // representatives. Humans can legally choose another suit allocation of
    // the same straight/flush. Preserve that useful example by scoring and
    // encoding the validated action directly; it remains a legal server move
    // even though the bot would not currently enumerate it.
    if (record.action.type === 'play') {
        const played = cards(record.action.cards);
        const move = Big2Rules.validateHand(played);
        const missesOpeningCard = isFirstTurn &&
            !played.some(card => card.value === 0);
        if (!move || missesOpeningCard ||
            (lastPlayedHand && !Big2Rules.canBeat(move, lastPlayedHand))) {
            throw new Error(
                `${record.game} round ${record.round} ply ${record.ply}: ` +
                `exported action ${key} is not legal`
            );
        }
        const ctx = BotLogic.buildDecisionContext(hand, gameContext);
        const gamePhase = BotLogic.getGamePhase(hand.length);
        const scored = lastPlayedHand
            ? BotLogic.scoreResponseMove(
                move, hand, ctx, gamePhase,
                BotLogic.evaluateTrickValue(hand, ctx, gamePhase), false)
            : BotLogic.scoreLeadMove(move, hand, ctx, gamePhase, false);
        const heuristic = options.find(option => option.isHeuristicChoice);
        const heuristicKey = heuristic ? heuristic.key : null;
        const expanded = [
            ...options.map(option => ({
                action: option.action,
                key: option.key,
                move: option.move,
                score: option.score
            })),
            {
                action: 'play',
                key,
                move,
                score: scored.score
            }
        ].sort((left, right) => {
            const leftScore = Number.isFinite(left.score)
                ? left.score : -Number.MAX_VALUE;
            const rightScore = Number.isFinite(right.score)
                ? right.score : -Number.MAX_VALUE;
            return rightScore - leftScore;
        });
        chosenIndex = expanded.findIndex(option => option.key === key);
        return {
            actionFeatures: expanded.map((option, optionIndex) =>
                encodeCandidate({
                    hand,
                    lastPlayedHand,
                    isFirstTurn,
                    gameContext,
                    option,
                    optionIndex,
                    optionCount: expanded.length,
                    heuristicKey
                })),
            chosenIndex,
            heuristicIndex: expanded.findIndex(
                option => option.key === heuristicKey),
            exactActionAdded: true
        };
    }

    throw new Error(
        `${record.game} round ${record.round} ply ${record.ply}: ` +
        `chosen action ${key} absent from reconstructed candidates`
    );
}

function reconstructDecision(record) {
    const decision = reconstructActionSet(record);
    return decision.actionFeatures[decision.chosenIndex];
}

function roundKey(record) {
    return `${record.game}:${record.round}`;
}

function utilitiesByRound(records) {
    const rounds = new Map();
    for (const record of records) {
        const key = roundKey(record);
        if (!rounds.has(key)) rounds.set(key, new Map());
        if (record.labels.round_points !== null) {
            rounds.get(key).set(record.seat, {
                penalty: record.labels.round_points,
                won: record.labels.won_round
            });
        }
    }

    const utilities = new Map();
    for (const [key, seats] of rounds) {
        const winner = [...seats].find(([, label]) => label.won);
        if (!winner || seats.size !== 4) continue;
        const totalPenalty = [...seats.values()]
            .reduce((sum, label) => sum + label.penalty, 0);
        const bySeat = new Map();
        for (const [seat, label] of seats) {
            bySeat.set(seat,
                (seat === winner[0] ? totalPenalty : -label.penalty) / 117);
        }
        utilities.set(key, bySeat);
    }
    return utilities;
}

/**
 * Whether this record is one the caller asked to learn from.
 *
 * Guests are pooled: they carry no subject, so --include-guests takes all of
 * them or none. The human branch guards `subject` explicitly rather than
 * comparing straight through, because a registered player whose user_id lookup
 * failed at export time also lands here with subject null -- and a null-vs-null
 * match would silently pull those unattributed seats into a run that named a
 * specific player.
 */
function isSelected(record, { subject, includeGuests }) {
    if (record.occupant === 'guest') return Boolean(includeGuests);
    return record.occupant === 'human' &&
        Boolean(subject) &&
        record.subject === subject;
}

function convert(records, { subject, gamma, includeGuests = false }) {
    const utilities = utilitiesByRound(records);
    const eligible = records.filter(record =>
        isSelected(record, { subject, includeGuests }) &&
        !record.joined_mid_game &&
        !record.forced_pass &&
        !record.policy_fallback &&
        !record.turn_disconnected &&
        !(record.action.type === 'pass' && record.legal?.plays?.length === 0) &&
        utilities.has(roundKey(record))
    );

    const byRoundSeat = new Map();
    for (const record of eligible) {
        const key = `${roundKey(record)}:${record.seat}`;
        if (!byRoundSeat.has(key)) byRoundSeat.set(key, []);
        byRoundSeat.get(key).push(record);
    }

    const rows = [];
    let skipped = 0;
    for (const trajectory of byRoundSeat.values()) {
        trajectory.sort((a, b) => a.ply - b.ply);
        for (let i = 0; i < trajectory.length; i++) {
            const record = trajectory[i];
            try {
                const utility = utilities.get(roundKey(record)).get(record.seat);
                rows.push({
                    features: reconstructDecision(record),
                    target: utility * Math.pow(gamma, trajectory.length - i - 1)
                });
            } catch (error) {
                skipped++;
                console.warn(error.message);
            }
        }
    }
    // The replay buffer itself is bare {features, target} rows with no
    // provenance, so a mixed run is indistinguishable once written. Count the
    // split here and record it in the sidecar, otherwise "how much of this
    // model came from guests" is unanswerable after the fact.
    const guestDecisions = eligible.filter(
        record => record.occupant === 'guest').length;

    return {
        rows,
        eligible: eligible.length,
        skipped,
        trajectories: byRoundSeat.size,
        guestDecisions,
        humanDecisions: eligible.length - guestDecisions
    };
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (!args.input || (!args.subject && !args.includeGuests)) {
        throw new Error(
            '--input and either --subject or --include-guests are required');
    }

    const { files, records } = readShards(args.input);
    if (args.subject) {
        const subjects = [...new Set(records
            .filter(record => record.occupant === 'human')
            .map(record => record.subject))].sort();
        if (!subjects.includes(args.subject)) {
            throw new Error(
                `Subject ${args.subject} not found. Available: ${subjects.join(', ')}`);
        }
    }
    const result = convert(records, args);
    if (!result.rows.length) throw new Error('No eligible decisions were converted');

    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    const fd = fs.openSync(args.output, 'w');
    try {
        writeRows(fd, result.rows);
    } finally {
        fs.closeSync(fd);
    }
    const sidecar = {
        schemaVersion: 1,
        kind: 'chor-dai-dee-human-rl-experience',
        dtype: 'float32-le',
        featureNames: FEATURE_NAMES,
        columns: [...FEATURE_NAMES, 'target'],
        rows: result.rows.length,
        subject: args.subject,
        includeGuests: args.includeGuests,
        guestDecisions: result.guestDecisions,
        humanDecisions: result.humanDecisions,
        gamma: args.gamma,
        sourceShards: files.map(file => path.basename(file)),
        sourceRecords: records.length,
        eligibleDecisions: result.eligible,
        skippedDecisions: result.skipped,
        trajectories: result.trajectories,
        rulesVersion: RULES_VERSION,
        heuristicBotVersion: BOT_LOGIC_VERSION,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${args.output}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`records      ${records.length}`);
    console.log(`eligible     ${result.eligible} ` +
        `(${result.humanDecisions} account, ${result.guestDecisions} guest)`);
    console.log(`converted    ${result.rows.length}`);
    console.log(`skipped      ${result.skipped}`);
    console.log(`experience   ${args.output}`);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    main,
    parseArgs,
    readShards,
    reconstructDecision,
    reconstructActionSet,
    utilitiesByRound,
    isSelected,
    convert
};
