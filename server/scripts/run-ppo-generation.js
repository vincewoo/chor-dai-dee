#!/usr/bin/env node
// Numbered PPO generation: parallel on-policy collection, CUDA update,
// conservative update-size selection, and paired promotion evaluation.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PPOModel } = require('../game/PPOModel');
const {
    seedForWorker,
    learnedResult,
    compareBenchmarkReports,
    selectConservativeCandidate,
    promotionDecision
} = require('./run-rl-generation');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(SERVER_ROOT, '.ppo-generations');
const DEFAULT_BOOTSTRAP = path.join(
    SERVER_ROOT, 'ai/ppo-policy-heuristic-bootstrap.json');

function parseArgs(argv) {
    const args = {
        input: null,
        baseline: null,
        outputDir: DEFAULT_OUTPUT_DIR,
        workers: 8,
        rounds: 50000,
        epochs: 4,
        batchSize: 2048,
        learningRate: 0.00003,
        clipRatio: 0.2,
        entropyCoefficient: 0.01,
        imitationCoefficient: 0.005,
        targetKl: 0.02,
        gamma: 0.995,
        gaeLambda: 0.95,
        temperature: 1,
        opponents: 'mixed',
        opponentPool: [],
        selectionRounds: 6000,
        benchmarkRounds: 12000,
        interpolationAlphas: [0.25, 0.5, 1],
        overrideMargin: 0.02,
        device: 'cuda'
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--input') args.input = path.resolve(argv[++i]);
        else if (flag === '--baseline') args.baseline = path.resolve(argv[++i]);
        else if (flag === '--output-dir') args.outputDir = path.resolve(argv[++i]);
        else if (flag === '--workers') args.workers = Number(argv[++i]);
        else if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--epochs') args.epochs = Number(argv[++i]);
        else if (flag === '--batch-size') args.batchSize = Number(argv[++i]);
        else if (flag === '--learning-rate') args.learningRate = Number(argv[++i]);
        else if (flag === '--clip-ratio') args.clipRatio = Number(argv[++i]);
        else if (flag === '--entropy-coef') {
            args.entropyCoefficient = Number(argv[++i]);
        } else if (flag === '--imitation-coef') {
            args.imitationCoefficient = Number(argv[++i]);
        } else if (flag === '--target-kl') args.targetKl = Number(argv[++i]);
        else if (flag === '--gamma') args.gamma = Number(argv[++i]);
        else if (flag === '--gae-lambda') args.gaeLambda = Number(argv[++i]);
        else if (flag === '--temperature') args.temperature = Number(argv[++i]);
        else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--opponent-pool') {
            args.opponentPool.push(...argv[++i].split(',')
                .filter(Boolean)
                .map(file => path.resolve(file)));
        }
        else if (flag === '--selection-rounds') {
            args.selectionRounds = Number(argv[++i]);
        } else if (flag === '--benchmark-rounds') {
            args.benchmarkRounds = Number(argv[++i]);
        } else if (flag === '--interpolation-alphas') {
            args.interpolationAlphas = argv[++i].split(',').map(Number);
        } else if (flag === '--override-margin') {
            args.overrideMargin = Number(argv[++i]);
        } else if (flag === '--device') args.device = argv[++i];
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

const USAGE = `
Usage: npm run bot:ppo:generation -- [options]

  --input FILE               PPO training parent (default newest generation)
  --baseline FILE            promotion opponent (default training parent)
  --workers N                collection processes (default 8)
  --rounds N                 on-policy rounds (default 50000)
  --epochs N                 PPO passes (default 4)
  --batch-size N             decision groups per batch (default 2048)
  --learning-rate N          AdamW rate (default 0.00003)
  --clip-ratio N             PPO ratio clip (default 0.2)
  --entropy-coef N           entropy bonus (default 0.01)
  --imitation-coef N         heuristic anchor (default 0.005)
  --opponents MODE           mixed, selfplay, heuristic, or league
  --opponent-pool FILES      comma-separated historical PPO checkpoints
  --target-kl N              early-stop KL (default 0.02)
  --selection-rounds N       update-size tournament rounds (default 6000)
  --benchmark-rounds N       promotion rounds (default 12000)
  --interpolation-alphas A   conservative steps (default .25,.5,1)
`;

function run(command, commandArgs, { stream = true, prefix = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: SERVER_ROOT,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (stream) process.stdout.write(
                prefix + chunk.toString().replace(/\n(?=.)/g, `\n${prefix}`));
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            process.stderr.write(
                prefix + chunk.toString().replace(/\n(?=.)/g, `\n${prefix}`));
        });
        child.on('error', reject);
        child.on('close', code => code === 0
            ? resolve({ stdout, stderr })
            : reject(new Error(`${path.basename(command)} exited with ${code}`)));
    });
}

function completedGenerations(outputDir) {
    if (!fs.existsSync(outputDir)) return [];
    return fs.readdirSync(outputDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^gen-\d{3}$/.test(entry.name))
        .map(entry => ({
            number: Number(entry.name.slice(4)),
            directory: path.join(outputDir, entry.name)
        }))
        .filter(item => fs.existsSync(path.join(item.directory, 'model.json')) &&
            fs.existsSync(path.join(item.directory, 'generation.json')))
        .sort((a, b) => a.number - b.number);
}

function copyFileInto(filePath, outputFd) {
    const inputFd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let count;
        while ((count = fs.readSync(inputFd, buffer, 0, buffer.length, null))) {
            let written = 0;
            while (written < count) {
                written += fs.writeSync(
                    outputFd, buffer, written, count - written);
            }
        }
    } finally {
        fs.closeSync(inputFd);
    }
}

function mergeShards(shards, output) {
    const items = shards.map(shard => ({
        ...shard,
        metadata: JSON.parse(fs.readFileSync(`${shard.prefix}.json`, 'utf8'))
    }));
    const first = items[0].metadata;
    for (const item of items) {
        for (const key of [
            'kind', 'featureNames', 'decisionColumns', 'gamma', 'gaeLambda',
            'temperature', 'opponents', 'policy', 'rulesVersion',
            'heuristicBotVersion', 'opponentPool', 'leagueSchedule'
        ]) {
            if (JSON.stringify(item.metadata[key]) !==
                JSON.stringify(first[key])) {
                throw new Error(`PPO shard ${key} mismatch: ${item.prefix}`);
            }
        }
        const actionBytes =
            item.metadata.actionRows * first.featureNames.length * 4;
        const decisionBytes =
            item.metadata.decisions * first.decisionRecordBytes;
        if (fs.statSync(`${item.prefix}.actions.bin`).size !== actionBytes ||
            fs.statSync(`${item.prefix}.decisions.bin`).size !== decisionBytes) {
            throw new Error(`PPO shard size mismatch: ${item.prefix}`);
        }
    }
    for (const suffix of ['actions.bin', 'decisions.bin']) {
        const target = `${output}.${suffix}`;
        const fd = fs.openSync(target, 'w');
        try {
            for (const item of items) {
                copyFileInto(`${item.prefix}.${suffix}`, fd);
            }
        } finally {
            fs.closeSync(fd);
        }
    }
    const metadata = {
        ...first,
        actionRows: items.reduce(
            (sum, item) => sum + item.metadata.actionRows, 0),
        decisions: items.reduce(
            (sum, item) => sum + item.metadata.decisions, 0),
        rounds: items.reduce(
            (sum, item) => sum + item.metadata.rounds, 0),
        learnerTrajectories: items.reduce(
            (sum, item) => sum + item.metadata.learnerTrajectories, 0),
        ...(first.leagueMatchups ? {
            leagueMatchups: Object.fromEntries(
                Object.keys(first.leagueMatchups).map(key => [
                    key,
                    items.reduce((sum, item) =>
                        sum + item.metadata.leagueMatchups[key], 0)
                ])
            )
        } : {}),
        ...(items.some(item =>
            Number.isFinite(item.metadata.teacherOverrides)) ? {
                teacherOverrides: items.reduce(
                    (sum, item) =>
                        sum + (item.metadata.teacherOverrides || 0),
                    0
                )
            } : {}),
        seed: null,
        workerCount: items.length,
        workerSeeds: items.map(item => item.seed),
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${output}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
}

async function collect(args, input, number, workDir) {
    const partsDir = path.join(workDir, 'experience-parts');
    fs.mkdirSync(partsDir);
    const workers = Math.min(args.workers, args.rounds);
    const baseRounds = Math.floor(args.rounds / workers);
    let extra = args.rounds % workers;
    let offset = 0;
    const baseSeed = 48119 + number * 100003;
    const shards = [];
    const jobs = [];
    for (let worker = 0; worker < workers; worker++) {
        const rounds = baseRounds + (extra-- > 0 ? 1 : 0);
        const seed = seedForWorker(baseSeed, worker);
        const prefix = path.join(
            partsDir, `part-${String(worker + 1).padStart(2, '0')}`);
        shards.push({ prefix, seed });
        jobs.push(run(process.execPath, [
            path.join(__dirname, 'generate-ppo-experience.js'),
            '--model', input,
            '--output', prefix,
            '--rounds', String(rounds),
            '--round-offset', String(offset),
            '--seed', String(seed),
            '--gamma', String(args.gamma),
            '--gae-lambda', String(args.gaeLambda),
            '--temperature', String(args.temperature),
            '--opponents', args.opponents,
            ...args.opponentPool.flatMap(file =>
                ['--opponent-pool', file]),
            '--report-every', String(Math.min(10000, rounds))
        ], { prefix: `[collector ${worker + 1}] ` }));
        offset += rounds;
    }
    const settled = await Promise.allSettled(jobs);
    const failure = settled.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const output = path.join(workDir, 'experience.ppo');
    const metadata = mergeShards(shards, output);
    fs.rmSync(partsDir, { recursive: true });
    return { output, metadata };
}

function interpolate(parent, trained, alpha) {
    const blend = (left, right) => {
        if (typeof left === 'number') return left + alpha * (right - left);
        return left.map((value, index) => blend(value, right[index]));
    };
    const parameters = {};
    for (const key of Object.keys(parent.parameters)) {
        parameters[key] = blend(parent.parameters[key], trained.parameters[key]);
    }
    return {
        ...trained,
        parameters,
        metadata: {
            ...trained.metadata,
            conservativeAlpha: alpha
        }
    };
}

function compact(diagnostics) {
    return {
        utilityDelta: diagnostics.allPairedRounds.meanUtilityDelta,
        pointsDelta: diagnostics.allPairedRounds.meanPointsDelta,
        cardsLeftDelta: diagnostics.allPairedRounds.meanCardsLeftDelta,
        disagreementRate: diagnostics.roundDisagreementRate,
        better: diagnostics.disagreementRounds.candidateBetter,
        worse: diagnostics.disagreementRounds.parentBetter,
        tied: diagnostics.disagreementRounds.tied
    };
}

function selectPPOCandidate(candidates) {
    const selected = selectConservativeCandidate(candidates);
    const selectedUtility =
        selected.diagnostics.allPairedRounds.meanUtilityDelta;
    const behaviorallyTied = candidates.filter(candidate =>
        Math.abs(
            candidate.diagnostics.allPairedRounds.meanUtilityDelta -
            selectedUtility
        ) <= 1e-15 &&
        Math.abs(
            candidate.result.averagePoints -
            selected.result.averagePoints
        ) <= 1e-15 &&
        Math.abs(
            candidate.result.winRatePercent -
            selected.result.winRatePercent
        ) <= 1e-15
    );
    return behaviorallyTied.reduce(
        (best, candidate) => candidate.alpha > best.alpha ? candidate : best,
        behaviorallyTied[0]
    );
}

async function benchmark(checkpoint, rounds, seed, reportPath, overrideMargin) {
    return run(process.execPath, [
        path.join(__dirname, 'bench-rl-value-bot.js'),
        checkpoint,
        String(rounds),
        '0.2',
        String(overrideMargin),
        String(seed),
        reportPath
    ], { stream: false });
}

async function benchmarkLeague(
    checkpoint,
    opponentPool,
    rounds,
    seed,
    reportPath,
    overrideMargin
) {
    return run(process.execPath, [
        path.join(__dirname, 'bench-ppo-league.js'),
        '--model', checkpoint,
        '--opponent-pool', opponentPool.join(','),
        '--rounds', String(rounds),
        '--seed', String(seed),
        '--override-margin', String(overrideMargin),
        '--output', reportPath
    ], { stream: false });
}

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return 0;
    }
    for (const [name, value] of [
        ['--workers', args.workers],
        ['--rounds', args.rounds],
        ['--epochs', args.epochs],
        ['--batch-size', args.batchSize],
        ['--selection-rounds', args.selectionRounds],
        ['--benchmark-rounds', args.benchmarkRounds]
    ]) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer`);
        }
    }
    if (!['mixed', 'selfplay', 'heuristic', 'league'].includes(args.opponents)) {
        throw new Error(
            '--opponents must be mixed, selfplay, heuristic, or league');
    }
    args.opponentPool = [...new Set(args.opponentPool)];
    if (args.opponents === 'league' && !args.opponentPool.length) {
        throw new Error('--opponents league requires --opponent-pool');
    }
    for (const file of args.opponentPool) {
        if (!fs.existsSync(file)) {
            throw new Error(`Opponent checkpoint not found: ${file}`);
        }
    }
    fs.mkdirSync(args.outputDir, { recursive: true });
    const interrupted = fs.readdirSync(args.outputDir)
        .filter(name => /^gen-\d{3}\.in-progress$/.test(name));
    if (interrupted.length) {
        throw new Error(`Interrupted PPO generation: ${interrupted.join(', ')}`);
    }
    if (!fs.existsSync(DEFAULT_BOOTSTRAP)) {
        fs.mkdirSync(path.dirname(DEFAULT_BOOTSTRAP), { recursive: true });
        fs.writeFileSync(
            DEFAULT_BOOTSTRAP,
            `${JSON.stringify(PPOModel.heuristicBootstrap())}\n`
        );
    }
    const complete = completedGenerations(args.outputDir);
    const previous = complete.at(-1);
    const number = previous ? previous.number + 1 : 1;
    const input = args.input ||
        (previous ? path.join(previous.directory, 'model.json') : DEFAULT_BOOTSTRAP);
    const baseline = args.baseline || input;
    for (const file of [input, baseline]) {
        if (!fs.existsSync(file)) throw new Error(`Checkpoint not found: ${file}`);
    }
    const label = `gen-${String(number).padStart(3, '0')}`;
    const finalDir = path.join(args.outputDir, label);
    const workDir = `${finalDir}.in-progress`;
    fs.mkdirSync(workDir);
    const started = Date.now();

    console.log(`\n=== ${label}: collect ${args.rounds} PPO rounds ===`);
    console.log(`training-parent=${input}`);
    console.log(`promotion-baseline=${baseline}`);
    const experience = await collect(args, input, number, workDir);
    console.log(
        `collection complete decisions=${experience.metadata.decisions} ` +
        `actions=${experience.metadata.actionRows}`
    );

    const python = path.resolve(SERVER_ROOT, '../.venv-rl/bin/python');
    const trainedPath = path.join(workDir, 'trained-model.json');
    console.log(`\n=== ${label}: PPO train on ${args.device} ===`);
    await run(python, [
        path.join(__dirname, 'train_ppo_gpu.py'),
        '--experience', experience.output,
        '--resume', input,
        '--output', trainedPath,
        '--epochs', String(args.epochs),
        '--batch-size', String(args.batchSize),
        '--learning-rate', String(args.learningRate),
        '--clip-ratio', String(args.clipRatio),
        '--entropy-coef', String(args.entropyCoefficient),
        '--imitation-coef', String(args.imitationCoefficient),
        '--target-kl', String(args.targetKl),
        '--seed', String(551 + number),
        '--device', args.device
    ]);

    const parentArtifact = JSON.parse(fs.readFileSync(input, 'utf8'));
    const trainedArtifact = JSON.parse(fs.readFileSync(trainedPath, 'utf8'));
    const candidateDir = path.join(workDir, 'candidates');
    fs.mkdirSync(candidateDir);
    const candidates = args.interpolationAlphas.map(alpha => {
        const candidatePath = path.join(
            candidateDir, `alpha-${String(alpha).replace('.', 'p')}.json`);
        fs.writeFileSync(
            candidatePath,
            `${JSON.stringify(interpolate(
                parentArtifact, trainedArtifact, alpha))}\n`
        );
        return { alpha, checkpoint: candidatePath };
    });

    const selectionSeed = (192811 + number * 1009) >>> 0;
    const selectionParentPath = path.join(workDir, 'selection-parent.json.tmp');
    console.log(`\n=== ${label}: conservative selection ===`);
    const runs = await Promise.all([
        benchmark(
            input, args.selectionRounds, selectionSeed,
            selectionParentPath, args.overrideMargin),
        ...candidates.map(candidate => benchmark(
            candidate.checkpoint,
            args.selectionRounds,
            selectionSeed,
            `${candidate.checkpoint}.report.tmp`,
            args.overrideMargin
        ))
    ]);
    const parentReport = JSON.parse(fs.readFileSync(selectionParentPath, 'utf8'));
    const evaluated = candidates.map((candidate, index) => {
        const reportPath = `${candidate.checkpoint}.report.tmp`;
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const diagnostics = compareBenchmarkReports(parentReport, report);
        fs.unlinkSync(reportPath);
        console.log(
            `alpha=${candidate.alpha} ` +
            `utility=${diagnostics.allPairedRounds.meanUtilityDelta.toFixed(6)} ` +
            `better=${diagnostics.disagreementRounds.candidateBetter} ` +
            `worse=${diagnostics.disagreementRounds.parentBetter}`
        );
        return {
            ...candidate,
            result: learnedResult(report),
            diagnostics
        };
    });
    fs.unlinkSync(selectionParentPath);
    const selected = selectPPOCandidate(evaluated);
    fs.writeFileSync(path.join(workDir, 'selection.json'), `${JSON.stringify({
        rounds: args.selectionRounds,
        seed: selectionSeed,
        selectedAlpha: selected.alpha,
        candidates: evaluated.map(item => ({
            alpha: item.alpha,
            result: item.result,
            diagnostics: compact(item.diagnostics)
        }))
    }, null, 2)}\n`);
    const modelPath = path.join(workDir, 'model.json');
    fs.copyFileSync(selected.checkpoint, modelPath);
    fs.writeFileSync(
        path.join(workDir, 'selection-parent.txt'), runs[0].stdout);

    const benchmarkSeed = (291731 + number * 2017) >>> 0;
    const baselineReportPath = path.join(workDir, 'benchmark-parent.json.tmp');
    const candidateReportPath = path.join(workDir, 'benchmark-candidate.json.tmp');
    console.log(
        `\n=== ${label}: promotion benchmark alpha=${selected.alpha} ===`);
    const [baselineRun, candidateRun] = await Promise.all([
        benchmark(
            baseline, args.benchmarkRounds, benchmarkSeed,
            baselineReportPath, args.overrideMargin),
        benchmark(
            modelPath, args.benchmarkRounds, benchmarkSeed,
            candidateReportPath, args.overrideMargin)
    ]);
    process.stdout.write(`\n--- baseline ---\n${baselineRun.stdout}`);
    process.stdout.write(`\n--- candidate ---\n${candidateRun.stdout}`);
    const baselineReport = JSON.parse(
        fs.readFileSync(baselineReportPath, 'utf8'));
    const candidateReport = JSON.parse(
        fs.readFileSync(candidateReportPath, 'utf8'));
    const baselineResult = learnedResult(baselineReport);
    const candidateResult = learnedResult(candidateReport);
    const diagnostics = compareBenchmarkReports(
        baselineReport, candidateReport);
    const heuristicPromotion = promotionDecision(
        baselineResult, candidateResult, diagnostics);
    fs.writeFileSync(
        path.join(workDir, 'policy-diagnostics.json'),
        `${JSON.stringify(diagnostics, null, 2)}\n`
    );
    fs.writeFileSync(
        path.join(workDir, 'benchmark-parent.txt'), baselineRun.stdout);
    fs.writeFileSync(
        path.join(workDir, 'benchmark-candidate.txt'), candidateRun.stdout);
    fs.unlinkSync(baselineReportPath);
    fs.unlinkSync(candidateReportPath);

    let leagueBenchmark = null;
    let promotion = heuristicPromotion;
    if (args.opponentPool.length) {
        const leagueSeed = (418273 + number * 3011) >>> 0;
        const leagueParentPath =
            path.join(workDir, 'league-parent.json.tmp');
        const leagueCandidatePath =
            path.join(workDir, 'league-candidate.json.tmp');
        console.log(
            `\n=== ${label}: historical league promotion benchmark ===`);
        const [leagueParentRun, leagueCandidateRun] = await Promise.all([
            benchmarkLeague(
                baseline,
                args.opponentPool,
                args.benchmarkRounds,
                leagueSeed,
                leagueParentPath,
                args.overrideMargin
            ),
            benchmarkLeague(
                modelPath,
                args.opponentPool,
                args.benchmarkRounds,
                leagueSeed,
                leagueCandidatePath,
                args.overrideMargin
            )
        ]);
        process.stdout.write(
            `\n--- league baseline ---\n${leagueParentRun.stdout}`);
        process.stdout.write(
            `\n--- league candidate ---\n${leagueCandidateRun.stdout}`);
        const leagueParentReport = JSON.parse(
            fs.readFileSync(leagueParentPath, 'utf8'));
        const leagueCandidateReport = JSON.parse(
            fs.readFileSync(leagueCandidatePath, 'utf8'));
        const leagueParentResult = learnedResult(leagueParentReport);
        const leagueCandidateResult = learnedResult(leagueCandidateReport);
        const leagueDiagnostics = compareBenchmarkReports(
            leagueParentReport, leagueCandidateReport);
        const leaguePromotion = promotionDecision(
            leagueParentResult,
            leagueCandidateResult,
            leagueDiagnostics
        );
        leagueBenchmark = {
            seed: leagueSeed,
            parent: leagueParentResult,
            candidate: leagueCandidateResult,
            diagnostics: compact(leagueDiagnostics),
            byOpponent: {
                parent: leagueParentReport.byOpponent,
                candidate: leagueCandidateReport.byOpponent
            },
            promotion: leaguePromotion
        };
        promotion = {
            ...heuristicPromotion,
            accepted:
                heuristicPromotion.accepted && leaguePromotion.accepted,
            checks: {
                ...heuristicPromotion.checks,
                leagueAccepted: leaguePromotion.accepted
            },
            heuristicAccepted: heuristicPromotion.accepted,
            league: leaguePromotion
        };
        fs.writeFileSync(
            path.join(workDir, 'league-diagnostics.json'),
            `${JSON.stringify(leagueDiagnostics, null, 2)}\n`);
        fs.writeFileSync(
            path.join(workDir, 'league-parent.txt'),
            leagueParentRun.stdout);
        fs.writeFileSync(
            path.join(workDir, 'league-candidate.txt'),
            leagueCandidateRun.stdout);
        fs.unlinkSync(leagueParentPath);
        fs.unlinkSync(leagueCandidatePath);
    }

    const generation = {
        schemaVersion: 1,
        generation: number,
        algorithm: 'PPO-GAE',
        trainingParent: path.resolve(input),
        promotionBaseline: path.resolve(baseline),
        settings: {
            ...args,
            input: path.resolve(input),
            baseline: path.resolve(baseline),
            outputDir: path.resolve(args.outputDir),
            selectedAlpha: selected.alpha,
            selectionSeed,
            benchmarkSeed
        },
        experience: experience.metadata,
        benchmark: {
            parent: baselineResult,
            candidate: candidateResult,
            winRateDeltaPoints:
                candidateResult.winRatePercent - baselineResult.winRatePercent,
            averagePointsDelta:
                candidateResult.averagePoints - baselineResult.averagePoints
        },
        diagnostics: compact(diagnostics),
        leagueBenchmark,
        promotion,
        elapsedSeconds: (Date.now() - started) / 1000,
        completedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        path.join(workDir, 'generation.json'),
        `${JSON.stringify(generation, null, 2)}\n`
    );
    fs.renameSync(workDir, finalDir);
    console.log(`\n=== ${label}: complete ===`);
    console.log(`candidate=${path.join(finalDir, 'model.json')}`);
    console.log(`selected-alpha=${selected.alpha}`);
    console.log(`promotion=${promotion.accepted ? 'ACCEPT' : 'REJECT'}`);
    return 0;
}

if (require.main === module) {
    main().then(code => {
        process.exitCode = code;
    }).catch(error => {
        console.error(`\nPPO generation failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    parseArgs,
    mergeShards,
    interpolate,
    selectPPOCandidate,
    benchmarkLeague
};
