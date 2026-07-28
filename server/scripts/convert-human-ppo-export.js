#!/usr/bin/env node
// Convert pseudonymized human game-log decisions into variable-action records
// for supervised fine-tuning of the deployable PPO actor.
//
// This is behavior-cloning data, not on-policy PPO experience: human behavior
// probabilities are unknown. The four float fields in each decision record
// are therefore deliberately zero and the imitation trainer consumes only the
// legal action group and chosen action.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BOT_LOGIC_VERSION } = require('../game/BotLogic');
const { RULES_VERSION } = require('../game/Big2Rules');
const { FEATURE_NAMES } = require('../game/RLValueModel');
const {
    DECISION_BYTES,
    NO_HEURISTIC_INDEX,
    encodeActions
} = require('./generate-ppo-experience');
const {
    readShards,
    reconstructActionSet
} = require('./convert-human-export');

const FLAG_HUMAN_OVERRIDE = 1;
const FLAG_VALIDATION = 2;

function parseArgs(argv) {
    const args = {
        input: null,
        output: path.resolve('ai/human.ppo'),
        subjects: [],
        allSubjects: false,
        includeGuests: false,
        validationFraction: 0.20,
        splitSeed: 90210
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--input') args.input = path.resolve(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--subject') args.subjects.push(argv[++i]);
        else if (flag === '--all-subjects') args.allSubjects = true;
        else if (flag === '--include-guests') args.includeGuests = true;
        else if (flag === '--validation-fraction') {
            args.validationFraction = Number(argv[++i]);
        } else if (flag === '--split-seed') {
            args.splitSeed = Number(argv[++i]);
        } else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

const USAGE = `
Usage: node scripts/convert-human-ppo-export.js --input DIR [subjects] [options]

  --input DIR               directory containing big2-*.jsonl.gz shards
  --subject HMAC            include one subject (repeatable)
  --all-subjects            include every pseudonymized human subject
  --include-guests          also include guest seats, as one anonymous pool
  --output PREFIX           writes PREFIX.actions.bin/.decisions.bin/.json
  --validation-fraction N   fraction of complete games held out (default 0.20)
  --split-seed N            deterministic game split seed

At least one of --subject, --all-subjects or --include-guests is required.
--include-guests composes with the other two, and on its own selects guest
decisions alone.
`;

/**
 * Guests have no account, so the export gives them occupant 'guest' and a null
 * subject: --include-guests takes the whole pool or none of it. The human
 * branch still demands a subject, so an account seat whose user_id lookup
 * failed at export time stays out of a named-subject run.
 */
function isEligible(record, subjects, includeGuests = false) {
    const selected = record.occupant === 'guest'
        ? Boolean(includeGuests)
        : record.occupant === 'human' &&
            Boolean(record.subject) &&
            subjects.has(record.subject);
    return selected &&
        !record.joined_mid_game &&
        !record.forced_pass &&
        !record.policy_fallback &&
        !record.turn_disconnected &&
        Number.isFinite(record.labels?.round_points) &&
        !(record.action.type === 'pass' &&
            record.legal?.plays?.length === 0);
}

function splitGames(gameIds, validationFraction, splitSeed) {
    if (!Number.isFinite(validationFraction) ||
        validationFraction <= 0 || validationFraction >= 1) {
        throw new Error('--validation-fraction must be between 0 and 1');
    }
    if (!Number.isInteger(splitSeed)) {
        throw new Error('--split-seed must be an integer');
    }
    const games = [...new Set(gameIds)].sort();
    if (games.length < 2) {
        throw new Error('At least two eligible games are required');
    }
    games.sort((left, right) => {
        const digest = value => crypto.createHash('sha256')
            .update(`${splitSeed}:${value}`)
            .digest('hex');
        return digest(left).localeCompare(digest(right));
    });
    const validationCount = Math.max(
        1, Math.min(games.length - 1,
            Math.round(games.length * validationFraction)));
    return {
        validation: new Set(games.slice(0, validationCount)),
        training: new Set(games.slice(validationCount))
    };
}

function encodeDecision(decision, validation) {
    const buffer = Buffer.allocUnsafe(DECISION_BYTES);
    const actionCount = decision.actionFeatures.length;
    if (actionCount > 0xFFFF) {
        throw new Error(`decision has too many actions: ${actionCount}`);
    }
    const humanOverride = decision.chosenIndex !== decision.heuristicIndex;
    let flags = humanOverride ? FLAG_HUMAN_OVERRIDE : 0;
    if (validation) flags |= FLAG_VALIDATION;
    buffer.writeUInt16LE(actionCount, 0);
    buffer.writeUInt16LE(decision.chosenIndex, 2);
    buffer.writeUInt16LE(
        decision.heuristicIndex < 0
            ? NO_HEURISTIC_INDEX
            : decision.heuristicIndex,
        4
    );
    buffer.writeUInt16LE(flags, 6);
    buffer.writeFloatLE(0, 8);
    buffer.writeFloatLE(0, 12);
    buffer.writeFloatLE(0, 16);
    buffer.writeFloatLE(0, 20);
    return buffer;
}

function convert(records, {
    subjects, validationFraction, splitSeed, includeGuests = false
}) {
    const selectedSubjects = new Set(subjects);
    const eligible = records.filter(record =>
        isEligible(record, selectedSubjects, includeGuests));
    const split = splitGames(
        eligible.map(record => record.game),
        validationFraction,
        splitSeed
    );
    const converted = [];
    let skipped = 0;
    let exactActionsAdded = 0;
    let humanOverrides = 0;

    for (const record of eligible) {
        try {
            const decision = reconstructActionSet(record);
            const validation = split.validation.has(record.game);
            converted.push({ record, decision, validation });
            exactActionsAdded += Number(decision.exactActionAdded);
            humanOverrides += Number(
                decision.chosenIndex !== decision.heuristicIndex);
        } catch (error) {
            skipped++;
            console.warn(error.message);
        }
    }
    return {
        converted,
        eligible: eligible.length,
        skipped,
        exactActionsAdded,
        humanOverrides,
        // Recorded so a fine-tuned actor can be traced back to how much of its
        // imitation data came from seats with no account behind them.
        guestDecisions: converted.filter(
            item => item.record.occupant === 'guest').length,
        split
    };
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return 0;
    }
    if (!args.input ||
        (!args.allSubjects && !args.subjects.length && !args.includeGuests)) {
        throw new Error(
            '--input and at least one of --subject, --all-subjects or ' +
            '--include-guests are required');
    }
    if (args.allSubjects && args.subjects.length) {
        throw new Error('Use either --all-subjects or --subject, not both');
    }

    const { files, records } = readShards(args.input);
    const available = [...new Set(records
        .filter(record => record.occupant === 'human' && record.subject)
        .map(record => record.subject))].sort();
    const subjects = args.allSubjects ? available : [...new Set(args.subjects)];
    const missing = subjects.filter(subject => !available.includes(subject));
    if (missing.length) {
        throw new Error(
            `Subjects not found: ${missing.join(', ')}. ` +
            `Available: ${available.join(', ')}`);
    }

    const result = convert(records, {
        ...args,
        subjects
    });
    if (!result.converted.length) {
        throw new Error('No eligible decisions were converted');
    }

    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    const actionFd = fs.openSync(`${args.output}.actions.bin`, 'w');
    const decisionFd = fs.openSync(`${args.output}.decisions.bin`, 'w');
    let actionRows = 0;
    let trainingDecisions = 0;
    let validationDecisions = 0;
    try {
        for (const item of result.converted) {
            const actions = encodeActions([item.decision]);
            fs.writeSync(actionFd, actions.buffer);
            fs.writeSync(
                decisionFd,
                encodeDecision(item.decision, item.validation)
            );
            actionRows += actions.actionCount;
            if (item.validation) validationDecisions++;
            else trainingDecisions++;
        }
    } finally {
        fs.closeSync(actionFd);
        fs.closeSync(decisionFd);
    }

    const metadata = {
        schemaVersion: 1,
        kind: 'chor-dai-dee-human-ppo-imitation-experience',
        featureNames: FEATURE_NAMES,
        actionDtype: 'float32-le',
        decisionRecordBytes: DECISION_BYTES,
        decisionColumns: [
            'action_count:uint16',
            'chosen_index:uint16',
            'heuristic_index:uint16',
            'flags:uint16',
            'unused:float32',
            'unused:float32',
            'unused:float32',
            'unused:float32'
        ],
        flagMasks: {
            humanOverride: FLAG_HUMAN_OVERRIDE,
            validation: FLAG_VALIDATION
        },
        actionRows,
        decisions: result.converted.length,
        trainingDecisions,
        validationDecisions,
        trainingGames: result.split.training.size,
        validationGames: result.split.validation.size,
        sourceGames:
            result.split.training.size + result.split.validation.size,
        subjects: subjects.length,
        includeGuests: args.includeGuests,
        guestDecisions: result.guestDecisions,
        accountDecisions: result.converted.length - result.guestDecisions,
        humanOverrides: result.humanOverrides,
        teacherOverrides: result.humanOverrides,
        exactActionsAdded: result.exactActionsAdded,
        skippedDecisions: result.skipped,
        eligibleDecisions: result.eligible,
        validationFraction: args.validationFraction,
        splitSeed: args.splitSeed,
        splitStrategy: 'sha256-whole-game',
        recommendedOverrideWeight: 1,
        teacher: 'pseudonymized-human-export',
        sourceShards: files.map(file => path.basename(file)),
        sourceRecords: records.length,
        rulesVersion: RULES_VERSION,
        heuristicBotVersion: BOT_LOGIC_VERSION,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        `${args.output}.json`,
        `${JSON.stringify(metadata, null, 2)}\n`
    );
    console.log(`records       ${records.length}`);
    console.log(`games         ${metadata.sourceGames} ` +
        `(${metadata.trainingGames} train, ` +
        `${metadata.validationGames} validation)`);
    console.log(`eligible      ${result.eligible}`);
    console.log(`converted     ${result.converted.length} ` +
        `(${trainingDecisions} train, ${validationDecisions} validation)`);
    console.log(`provenance    ${metadata.accountDecisions} account, ` +
        `${result.guestDecisions} guest`);
    console.log(`human choices ${result.humanOverrides} differed from heuristic`);
    console.log(`exact actions ${result.exactActionsAdded} added to abstraction`);
    console.log(`skipped       ${result.skipped}`);
    console.log(`experience    ${args.output}`);
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
    isEligible,
    splitGames,
    encodeDecision,
    convert,
    FLAG_HUMAN_OVERRIDE,
    FLAG_VALIDATION
};
