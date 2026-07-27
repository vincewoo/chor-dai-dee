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

function run(command, commandArgs) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: SERVER_ROOT,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on('error', reject);
        child.on('close', code => {
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

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return 0;
    }
    validatePositiveInteger('--rounds', args.rounds);
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
    console.log(`\n=== ${label}: collect ${args.rounds} rounds ===`);
    console.log(`parent=${generation.input}`);
    await run(process.execPath, [
        path.join(__dirname, 'generate-rl-experience.js'),
        '--rounds', String(args.rounds),
        '--model', generation.input,
        '--output', experience,
        '--seed', String(collectionSeed),
        '--epsilon', String(args.epsilon),
        '--heuristic-weight', String(args.heuristicWeight),
        '--override-margin', String(args.overrideMargin),
        '--opponents', args.opponents,
        '--report-every', String(Math.min(10000, args.rounds))
    ]);

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
    const benchmarkArgs = checkpoint => [
        benchmarkScript,
        checkpoint,
        String(args.benchmarkRounds),
        String(args.heuristicWeight),
        String(args.overrideMargin),
        String(benchmarkSeed)
    ];
    console.log(`\n=== ${label}: benchmark parent ===`);
    const parentRun = await run(process.execPath, benchmarkArgs(generation.input));
    console.log(`\n=== ${label}: benchmark candidate ===`);
    const candidateRun = await run(process.execPath, benchmarkArgs(candidate));
    const parentResult = parseBenchmark(parentRun.stdout);
    const candidateResult = parseBenchmark(candidateRun.stdout);
    fs.writeFileSync(path.join(workDir, 'benchmark-parent.txt'), parentRun.stdout);
    fs.writeFileSync(path.join(workDir, 'benchmark-candidate.txt'), candidateRun.stdout);

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
            epsilon: args.epsilon,
            heuristicWeight: args.heuristicWeight,
            overrideMargin: args.overrideMargin,
            opponents: args.opponents,
            device: args.device,
            collectionSeed,
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
        elapsedSeconds: (Date.now() - started) / 1000,
        completedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        path.join(workDir, 'generation.json'),
        `${JSON.stringify(metadata, null, 2)}\n`
    );
    fs.renameSync(workDir, finalDir);

    console.log(`\n=== ${label}: complete ===`);
    console.log(`candidate=${path.join(finalDir, 'model.json')}`);
    console.log(
        `win-rate delta=${metadata.benchmark.winRateDeltaPoints >= 0 ? '+' : ''}` +
        `${metadata.benchmark.winRateDeltaPoints.toFixed(1)} percentage points`
    );
    console.log(
        `average-points delta=${metadata.benchmark.averagePointsDelta >= 0 ? '+' : ''}` +
        `${metadata.benchmark.averagePointsDelta.toFixed(2)} (lower is better)`
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
    parseBenchmark
};
