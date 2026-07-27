#!/usr/bin/env node
// Run one reproducible approximate-policy-iteration generation:
// collect experience with the current policy, fit a resumed checkpoint, then
// benchmark parent and candidate on identical held-out deals.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASE = path.join(SERVER_ROOT, 'ai/rl-value-model-gpu-v1.json');
const DEFAULT_OUTPUT_DIR = path.join(SERVER_ROOT, '.rl-generations');

function parseArgs(argv) {
    const args = {
        input: null,
        outputDir: DEFAULT_OUTPUT_DIR,
        workers: 8,
        rounds: 50000,
        epochs: 15,
        batchSize: 8192,
        learningRate: 0.0001,
        benchmarkRounds: 12000,
        epsilon: 0.05,
        heuristicWeight: 0.20,
        overrideMargin: 0.02,
        opponents: 'mixed',
        device: 'cuda',
        collectionSeed: null,
        trainingSeed: null,
        benchmarkSeed: null
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--input') args.input = path.resolve(argv[++i]);
        else if (flag === '--output-dir') args.outputDir = path.resolve(argv[++i]);
        else if (flag === '--workers') args.workers = Number(argv[++i]);
        else if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--epochs') args.epochs = Number(argv[++i]);
        else if (flag === '--batch-size') args.batchSize = Number(argv[++i]);
        else if (flag === '--learning-rate') args.learningRate = Number(argv[++i]);
        else if (flag === '--benchmark-rounds') args.benchmarkRounds = Number(argv[++i]);
        else if (flag === '--epsilon') args.epsilon = Number(argv[++i]);
        else if (flag === '--heuristic-weight') args.heuristicWeight = Number(argv[++i]);
        else if (flag === '--override-margin') args.overrideMargin = Number(argv[++i]);
        else if (flag === '--opponents') args.opponents = argv[++i];
        else if (flag === '--device') args.device = argv[++i];
        else if (flag === '--collection-seed') args.collectionSeed = Number(argv[++i]);
        else if (flag === '--training-seed') args.trainingSeed = Number(argv[++i]);
        else if (flag === '--benchmark-seed') args.benchmarkSeed = Number(argv[++i]);
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}${value ? '' : ' (missing value)'}`);
    }
    return args;
}

const USAGE = `
Usage: npm run bot:rl:generation -- [options]

With no options, generation 1 starts from ai/rl-value-model-gpu-v1.json.
Later calls automatically resume from the newest completed generation.

  --input FILE             override the parent checkpoint
  --output-dir DIR         generation artifacts (default .rl-generations)
  --workers N              parallel collection processes (default 8)
  --rounds N               collection rounds (default 50000)
  --epochs N               optimizer passes (default 15)
  --batch-size N           GPU batch size (default 8192)
  --learning-rate N        AdamW rate (default 0.0001)
  --benchmark-rounds N     held-out rounds per checkpoint (default 12000)
  --opponents MODE         mixed, selfplay, or heuristic (default mixed)
  --epsilon N              collection exploration (default 0.05)
  --device DEVICE          cuda, cpu, or auto (default cuda)
  --collection-seed N      override the generation-derived seed
  --training-seed N        override the generation-derived seed
  --benchmark-seed N       override the generation-derived seed
`;

function validatePositiveInteger(name, value) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function completedGenerations(outputDir) {
    if (!fs.existsSync(outputDir)) return [];
    return fs.readdirSync(outputDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^gen-\d{3}$/.test(entry.name))
        .map(entry => ({
            number: Number(entry.name.slice(4)),
            directory: path.join(outputDir, entry.name)
        }))
        .filter(item =>
            fs.existsSync(path.join(item.directory, 'generation.json')) &&
            fs.existsSync(path.join(item.directory, 'model.json')))
        .sort((a, b) => a.number - b.number);
}

function resolveGeneration(args) {
    fs.mkdirSync(args.outputDir, { recursive: true });
    const interrupted = fs.readdirSync(args.outputDir)
        .filter(name => /^gen-\d{3}\.in-progress$/.test(name));
    if (interrupted.length) {
        throw new Error(
            `Interrupted generation found: ${interrupted.join(', ')}. ` +
            'Inspect or remove it before retrying.'
        );
    }
    const complete = completedGenerations(args.outputDir);
    const previous = complete.at(-1);
    const number = previous ? previous.number + 1 : 1;
    const input = args.input ||
        (previous ? path.join(previous.directory, 'model.json') : DEFAULT_BASE);
    return { number, input };
}

function writePrefixed(stream, prefix, state, chunk) {
    state.pending += chunk.toString();
    let newline;
    while ((newline = state.pending.indexOf('\n')) !== -1) {
        stream.write(`${prefix}${state.pending.slice(0, newline + 1)}`);
        state.pending = state.pending.slice(newline + 1);
    }
}

function run(command, commandArgs, { stream = true, prefix = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: SERVER_ROOT,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const stdoutDisplay = { pending: '' };
        const stderrDisplay = { pending: '' };
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (stream) writePrefixed(process.stdout, prefix, stdoutDisplay, chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            writePrefixed(process.stderr, prefix, stderrDisplay, chunk);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (stream && stdoutDisplay.pending) {
                process.stdout.write(`${prefix}${stdoutDisplay.pending}\n`);
            }
            if (stderrDisplay.pending) {
                process.stderr.write(`${prefix}${stderrDisplay.pending}\n`);
            }
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`${path.basename(command)} exited with code ${code}`));
        });
    });
}

function parseBenchmark(output) {
    const match = output.match(
        /^\s*value-1\s+([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*$/m
    );
    if (!match) throw new Error('Could not parse learned-seat benchmark result');
    return {
        winRatePercent: Number(match[1]),
        averagePoints: Number(match[2]),
        averageCardsLeft: Number(match[3])
    };
}

function seedForWorker(baseSeed, workerIndex) {
    return (baseSeed + Math.imul(workerIndex, 0x9E3779B9)) >>> 0;
}

function copyFileInto(filePath, outputFd) {
    const inputFd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead;
        while ((bytesRead = fs.readSync(
            inputFd, buffer, 0, buffer.length, null)) > 0) {
            let written = 0;
            while (written < bytesRead) {
                written += fs.writeSync(
                    outputFd, buffer, written, bytesRead - written);
            }
        }
    } finally {
        fs.closeSync(inputFd);
    }
}

function mergeExperienceShards(shards, output) {
    const metadata = shards.map(shard => ({
        ...shard,
        metadata: JSON.parse(fs.readFileSync(`${shard.path}.json`, 'utf8'))
    }));
    const first = metadata[0].metadata;
    const schema = JSON.stringify(first.columns);
    for (const shard of metadata) {
        if (JSON.stringify(shard.metadata.columns) !== schema) {
            throw new Error(`Experience schema mismatch in ${shard.path}`);
        }
        const expectedBytes = shard.metadata.rows * first.columns.length * 4;
        if (fs.statSync(shard.path).size !== expectedBytes) {
            throw new Error(`Experience size mismatch in ${shard.path}`);
        }
        for (const key of [
            'kind', 'dtype', 'policy', 'rulesVersion',
            'heuristicBotVersion', 'gamma', 'opponents'
        ]) {
            if (shard.metadata[key] !== first[key]) {
                throw new Error(`Experience ${key} mismatch in ${shard.path}`);
            }
        }
    }

    const temporary = `${output}.tmp`;
    const outputFd = fs.openSync(temporary, 'w');
    try {
        for (const shard of metadata) copyFileInto(shard.path, outputFd);
    } finally {
        fs.closeSync(outputFd);
    }
    fs.renameSync(temporary, output);

    const merged = {
        schemaVersion: first.schemaVersion,
        kind: first.kind,
        dtype: first.dtype,
        featureNames: first.featureNames,
        columns: first.columns,
        rows: metadata.reduce((sum, shard) => sum + shard.metadata.rows, 0),
        rounds: metadata.reduce((sum, shard) => sum + shard.metadata.rounds, 0),
        seed: null,
        workerCount: metadata.length,
        workerSeeds: metadata.map(shard => shard.seed),
        workers: metadata.map((shard, index) => ({
            worker: index,
            seed: shard.seed,
            rounds: shard.metadata.rounds,
            rows: shard.metadata.rows,
            roundOffset: shard.metadata.roundOffset
        })),
        gamma: first.gamma,
        opponents: first.opponents,
        policy: first.policy,
        rulesVersion: first.rulesVersion,
        heuristicBotVersion: first.heuristicBotVersion,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${output}.json`, `${JSON.stringify(merged, null, 2)}\n`);
    return merged;
}

async function collectExperience({
    args,
    generation,
    collectionSeed,
    experience,
    workDir
}) {
    const workerCount = Math.min(args.workers, args.rounds);
    const partsDir = path.join(workDir, 'experience-parts');
    fs.mkdirSync(partsDir);
    const baseRounds = Math.floor(args.rounds / workerCount);
    const extraRounds = args.rounds % workerCount;
    let roundOffset = 0;
    const shards = [];
    const jobs = [];
    const generator = path.join(__dirname, 'generate-rl-experience.js');
    const started = Date.now();

    for (let worker = 0; worker < workerCount; worker++) {
        const rounds = baseRounds + (worker < extraRounds ? 1 : 0);
        const seed = seedForWorker(collectionSeed, worker);
        const shard = {
            path: path.join(
                partsDir,
                `part-${String(worker + 1).padStart(2, '0')}.rl-experience.bin`
            ),
            rounds,
            seed,
            roundOffset
        };
        shards.push(shard);
        jobs.push(run(process.execPath, [
            generator,
            '--rounds', String(rounds),
            '--round-offset', String(roundOffset),
            '--model', generation.input,
            '--output', shard.path,
            '--seed', String(seed),
            '--epsilon', String(args.epsilon),
            '--heuristic-weight', String(args.heuristicWeight),
            '--override-margin', String(args.overrideMargin),
            '--opponents', args.opponents,
            '--report-every', String(Math.min(10000, rounds))
        ], {
            prefix: `[collector ${String(worker + 1).padStart(2, '0')}] `
        }));
        roundOffset += rounds;
    }

    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;

    const merged = mergeExperienceShards(shards, experience);
    fs.rmSync(partsDir, { recursive: true });
    const seconds = (Date.now() - started) / 1000;
    console.log(
        `collection complete rounds=${merged.rounds} rows=${merged.rows} ` +
        `workers=${workerCount} rounds/s=${(merged.rounds / seconds).toFixed(1)}`
    );
    return merged;
}

function learnedResult(report) {
    const result = report.results.find(item => item.name === 'value-1');
    if (!result) throw new Error('Benchmark JSON has no value-1 result');
    return {
        rounds: result.rounds,
        wins: result.wins,
        winRatePercent: result.winRate * 100,
        averagePoints: result.avgPoints,
        averageCardsLeft: result.avgCardsLeft
    };
}

function summarizeOutcomeDeltas(deltas) {
    if (!deltas.length) {
        return {
            rounds: 0,
            meanUtilityDelta: null,
            meanPointsDelta: null,
            meanCardsLeftDelta: null,
            candidateBetter: 0,
            parentBetter: 0,
            tied: 0
        };
    }
    const sum = key => deltas.reduce((total, delta) => total + delta[key], 0);
    let candidateBetter = 0;
    let parentBetter = 0;
    let tied = 0;
    for (const delta of deltas) {
        if (delta.utility > 1e-12) candidateBetter++;
        else if (delta.utility < -1e-12) parentBetter++;
        else tied++;
    }
    return {
        rounds: deltas.length,
        meanUtilityDelta: sum('utility') / deltas.length,
        meanPointsDelta: sum('points') / deltas.length,
        meanCardsLeftDelta: sum('cardsLeft') / deltas.length,
        candidateBetter,
        parentBetter,
        tied
    };
}

function compareBenchmarkReports(parent, candidate) {
    if (parent.seed !== candidate.seed || parent.rounds !== candidate.rounds) {
        throw new Error('Parent and candidate benchmark reports are not paired');
    }
    if (parent.heuristicWeight !== candidate.heuristicWeight ||
        parent.overrideMargin !== candidate.overrideMargin) {
        throw new Error('Parent and candidate policy settings differ');
    }
    if (parent.traces.length !== candidate.traces.length) {
        throw new Error('Parent and candidate trace counts differ');
    }

    let roundsWithDecisions = 0;
    let roundsWithDisagreement = 0;
    let sharedDecisionPositions = 0;
    let firstActionDisagreements = 0;
    const allDeltas = [];
    const disagreementDeltas = [];
    const examples = [];

    for (let round = 0; round < parent.traces.length; round++) {
        const parentTrace = parent.traces[round];
        const candidateTrace = candidate.traces[round];
        if (parentTrace.round !== candidateTrace.round) {
            throw new Error(`Trace round mismatch at index ${round}`);
        }
        const parentActions = parentTrace.actions;
        const candidateActions = candidateTrace.actions;
        if (parentActions.length || candidateActions.length) roundsWithDecisions++;

        const comparable = Math.min(parentActions.length, candidateActions.length);
        let disagreementIndex = -1;
        for (let index = 0; index < comparable; index++) {
            sharedDecisionPositions++;
            if (parentActions[index] !== candidateActions[index]) {
                disagreementIndex = index;
                firstActionDisagreements++;
                break;
            }
        }
        if (disagreementIndex === -1 &&
            parentActions.length !== candidateActions.length) {
            disagreementIndex = comparable;
        }

        const delta = {
            utility:
                candidateTrace.outcome.utility - parentTrace.outcome.utility,
            points:
                candidateTrace.outcome.points - parentTrace.outcome.points,
            cardsLeft:
                candidateTrace.outcome.cardsLeft - parentTrace.outcome.cardsLeft
        };
        allDeltas.push(delta);
        if (disagreementIndex !== -1) {
            roundsWithDisagreement++;
            disagreementDeltas.push(delta);
            if (examples.length < 20) {
                examples.push({
                    round: parentTrace.round,
                    decision: disagreementIndex,
                    parentAction: parentActions[disagreementIndex] ?? null,
                    candidateAction: candidateActions[disagreementIndex] ?? null,
                    outcomeDelta: delta
                });
            }
        }
    }

    return {
        schemaVersion: 1,
        rounds: parent.rounds,
        seed: parent.seed,
        heuristicWeight: parent.heuristicWeight,
        overrideMargin: parent.overrideMargin,
        roundsWithDecisions,
        roundsWithDisagreement,
        roundDisagreementRate: roundsWithDecisions
            ? roundsWithDisagreement / roundsWithDecisions
            : 0,
        sharedDecisionPositions,
        firstActionDisagreements,
        firstActionDisagreementRate: sharedDecisionPositions
            ? firstActionDisagreements / sharedDecisionPositions
            : 0,
        allPairedRounds: summarizeOutcomeDeltas(allDeltas),
        disagreementRounds: summarizeOutcomeDeltas(disagreementDeltas),
        parentTelemetry: parent.telemetry,
        candidateTelemetry: candidate.telemetry,
        examples
    };
}

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return 0;
    }
    validatePositiveInteger('--rounds', args.rounds);
    validatePositiveInteger('--workers', args.workers);
    validatePositiveInteger('--epochs', args.epochs);
    validatePositiveInteger('--batch-size', args.batchSize);
    validatePositiveInteger('--benchmark-rounds', args.benchmarkRounds);
    if (!['mixed', 'selfplay', 'heuristic'].includes(args.opponents)) {
        throw new Error('--opponents must be mixed, selfplay, or heuristic');
    }
    if (!['cuda', 'cpu', 'auto'].includes(args.device)) {
        throw new Error('--device must be cuda, cpu, or auto');
    }

    const generation = resolveGeneration(args);
    if (!fs.existsSync(generation.input)) {
        throw new Error(`Parent checkpoint not found: ${generation.input}`);
    }
    const parentArtifact = JSON.parse(fs.readFileSync(generation.input, 'utf8'));
    const hidden = parentArtifact.hiddenSize;
    validatePositiveInteger('parent hiddenSize', hidden);
    const python = path.resolve(SERVER_ROOT, '../.venv-rl/bin/python');
    if (!fs.existsSync(python)) {
        throw new Error(`RL Python environment not found: ${python}`);
    }

    const label = `gen-${String(generation.number).padStart(3, '0')}`;
    const finalDir = path.join(args.outputDir, label);
    const workDir = `${finalDir}.in-progress`;
    fs.mkdirSync(workDir);

    const collectionSeed = args.collectionSeed ??
        9128 + generation.number * 100003;
    const trainingSeed = args.trainingSeed ?? 228 + generation.number;
    const benchmarkSeed = args.benchmarkSeed ??
        83471 + generation.number * 1009;
    const experience = path.join(workDir, 'experience.rl-experience.bin');
    const candidate = path.join(workDir, 'model.json');

    const started = Date.now();
    console.log(
        `\n=== ${label}: collect ${args.rounds} rounds ` +
        `with ${Math.min(args.workers, args.rounds)} workers ===`
    );
    console.log(`parent=${generation.input}`);
    const experienceMetadata = await collectExperience({
        args,
        generation,
        collectionSeed,
        experience,
        workDir
    });

    console.log(`\n=== ${label}: train on ${args.device} ===`);
    await run(python, [
        path.join(__dirname, 'train_rl_value_gpu.py'),
        '--experience', experience,
        '--resume', generation.input,
        '--output', candidate,
        '--hidden', String(hidden),
        '--epochs', String(args.epochs),
        '--batch-size', String(args.batchSize),
        '--learning-rate', String(args.learningRate),
        '--seed', String(trainingSeed),
        '--device', args.device
    ]);

    const benchmarkScript = path.join(__dirname, 'bench-rl-value-bot.js');
    const parentReportPath = path.join(workDir, 'benchmark-parent.json.tmp');
    const candidateReportPath = path.join(workDir, 'benchmark-candidate.json.tmp');
    const benchmarkArgs = (checkpoint, reportPath) => [
        benchmarkScript,
        checkpoint,
        String(args.benchmarkRounds),
        String(args.heuristicWeight),
        String(args.overrideMargin),
        String(benchmarkSeed),
        reportPath
    ];
    console.log(`\n=== ${label}: benchmark parent and candidate concurrently ===`);
    const [parentRun, candidateRun] = await Promise.all([
        run(process.execPath, benchmarkArgs(generation.input, parentReportPath), {
            stream: false
        }),
        run(process.execPath, benchmarkArgs(candidate, candidateReportPath), {
            stream: false
        })
    ]);
    console.log('\n--- parent ---');
    process.stdout.write(parentRun.stdout);
    console.log('\n--- candidate ---');
    process.stdout.write(candidateRun.stdout);
    const parentReport = JSON.parse(fs.readFileSync(parentReportPath, 'utf8'));
    const candidateReport = JSON.parse(fs.readFileSync(candidateReportPath, 'utf8'));
    const parentResult = learnedResult(parentReport);
    const candidateResult = learnedResult(candidateReport);
    const diagnostics = compareBenchmarkReports(parentReport, candidateReport);
    fs.writeFileSync(path.join(workDir, 'benchmark-parent.txt'), parentRun.stdout);
    fs.writeFileSync(path.join(workDir, 'benchmark-candidate.txt'), candidateRun.stdout);
    fs.writeFileSync(
        path.join(workDir, 'policy-diagnostics.json'),
        `${JSON.stringify(diagnostics, null, 2)}\n`
    );
    fs.unlinkSync(parentReportPath);
    fs.unlinkSync(candidateReportPath);

    const metadata = {
        schemaVersion: 1,
        generation: generation.number,
        parentCheckpoint: path.resolve(generation.input),
        settings: {
            rounds: args.rounds,
            epochs: args.epochs,
            batchSize: args.batchSize,
            learningRate: args.learningRate,
            benchmarkRounds: args.benchmarkRounds,
            workers: experienceMetadata.workerCount,
            epsilon: args.epsilon,
            heuristicWeight: args.heuristicWeight,
            overrideMargin: args.overrideMargin,
            opponents: args.opponents,
            device: args.device,
            collectionSeed,
            collectionWorkerSeeds: experienceMetadata.workerSeeds,
            trainingSeed,
            benchmarkSeed
        },
        benchmark: {
            parent: parentResult,
            candidate: candidateResult,
            winRateDeltaPoints:
                candidateResult.winRatePercent - parentResult.winRatePercent,
            averagePointsDelta:
                candidateResult.averagePoints - parentResult.averagePoints
        },
        diagnostics: {
            roundsWithDisagreement: diagnostics.roundsWithDisagreement,
            roundDisagreementRate: diagnostics.roundDisagreementRate,
            firstActionDisagreementRate:
                diagnostics.firstActionDisagreementRate,
            candidateOverrideRate:
                diagnostics.candidateTelemetry.overrideRate,
            candidateGuardFallbackRate:
                diagnostics.candidateTelemetry.guardFallbackRate,
            disagreementRoundMeanUtilityDelta:
                diagnostics.disagreementRounds.meanUtilityDelta,
            disagreementRoundMeanPointsDelta:
                diagnostics.disagreementRounds.meanPointsDelta
        },
        elapsedSeconds: (Date.now() - started) / 1000,
        completedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        path.join(workDir, 'generation.json'),
        `${JSON.stringify(metadata, null, 2)}\n`
    );
    fs.renameSync(workDir, finalDir);

    console.log(`\n=== ${label}: complete ===`);
    console.log(`trained-from=${generation.input}`);
    console.log(`candidate=${path.join(finalDir, 'model.json')}`);
    console.log(
        `win-rate delta=${metadata.benchmark.winRateDeltaPoints >= 0 ? '+' : ''}` +
        `${metadata.benchmark.winRateDeltaPoints.toFixed(3)} percentage points`
    );
    console.log(
        `average-points delta=${metadata.benchmark.averagePointsDelta >= 0 ? '+' : ''}` +
        `${metadata.benchmark.averagePointsDelta.toFixed(4)} (lower is better)`
    );
    console.log(
        `policy disagreement=${(diagnostics.roundDisagreementRate * 100).toFixed(2)}% ` +
        `of paired rounds; candidate heuristic override=` +
        `${(diagnostics.candidateTelemetry.overrideRate * 100).toFixed(2)}%`
    );
    return 0;
}

if (require.main === module) {
    main().then(code => {
        process.exitCode = code;
    }).catch(error => {
        console.error(`\nGeneration failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    parseArgs,
    completedGenerations,
    resolveGeneration,
    parseBenchmark,
    seedForWorker,
    mergeExperienceShards,
    compareBenchmarkReports
};
