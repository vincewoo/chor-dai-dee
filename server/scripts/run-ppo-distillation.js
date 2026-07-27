#!/usr/bin/env node
// Parallel behavior cloning of an RL value teacher into the JS PPO actor.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { seedForWorker, compareBenchmarkReports } =
    require('./run-rl-generation');
const { mergeShards } = require('./run-ppo-generation');

const SERVER_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const args = {
        teacher: null,
        resume: path.join(
            SERVER_ROOT, 'ai/ppo-policy-heuristic-bootstrap.json'),
        output: path.join(
            SERVER_ROOT, 'ai/ppo-policy-value-bootstrap.json'),
        workDir: path.join(SERVER_ROOT, '.ppo-distillation'),
        workers: 8,
        rounds: 100000,
        epochs: 8,
        batchSize: 2048,
        learningRate: 0.0003,
        overrideWeight: 12,
        entropyCoefficient: 0.001,
        heuristicWeight: 0.20,
        overrideMargin: 0.02,
        benchmarkRounds: 24000,
        device: 'cuda'
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--teacher') args.teacher = path.resolve(argv[++i]);
        else if (flag === '--resume') args.resume = path.resolve(argv[++i]);
        else if (flag === '--output') args.output = path.resolve(argv[++i]);
        else if (flag === '--work-dir') args.workDir = path.resolve(argv[++i]);
        else if (flag === '--workers') args.workers = Number(argv[++i]);
        else if (flag === '--rounds') args.rounds = Number(argv[++i]);
        else if (flag === '--epochs') args.epochs = Number(argv[++i]);
        else if (flag === '--batch-size') args.batchSize = Number(argv[++i]);
        else if (flag === '--learning-rate') {
            args.learningRate = Number(argv[++i]);
        } else if (flag === '--override-weight') {
            args.overrideWeight = Number(argv[++i]);
        } else if (flag === '--entropy-coef') {
            args.entropyCoefficient = Number(argv[++i]);
        } else if (flag === '--heuristic-weight') {
            args.heuristicWeight = Number(argv[++i]);
        } else if (flag === '--override-margin') {
            args.overrideMargin = Number(argv[++i]);
        } else if (flag === '--benchmark-rounds') {
            args.benchmarkRounds = Number(argv[++i]);
        } else if (flag === '--device') args.device = argv[++i];
        else if (flag === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${flag}`);
    }
    return args;
}

function run(command, args, { stream = true, prefix = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: SERVER_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
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

async function collect(args) {
    const partsDir = path.join(args.workDir, 'parts');
    fs.mkdirSync(partsDir, { recursive: true });
    const workers = Math.min(args.workers, args.rounds);
    const baseRounds = Math.floor(args.rounds / workers);
    let extra = args.rounds % workers;
    let offset = 0;
    const shards = [];
    const jobs = [];
    for (let worker = 0; worker < workers; worker++) {
        const rounds = baseRounds + (extra-- > 0 ? 1 : 0);
        const seed = seedForWorker(8675309, worker);
        const prefix = path.join(
            partsDir, `part-${String(worker + 1).padStart(2, '0')}`);
        shards.push({ prefix, seed });
        jobs.push(run(process.execPath, [
            path.join(__dirname, 'generate-ppo-imitation-experience.js'),
            '--teacher', args.teacher,
            '--output', prefix,
            '--rounds', String(rounds),
            '--round-offset', String(offset),
            '--seed', String(seed),
            '--heuristic-weight', String(args.heuristicWeight),
            '--override-margin', String(args.overrideMargin),
            '--opponents', 'mixed',
            '--report-every', String(rounds)
        ], { prefix: `[collector ${worker + 1}] ` }));
        offset += rounds;
    }
    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const output = path.join(args.workDir, 'experience.ppo');
    const metadata = mergeShards(shards, output);
    fs.rmSync(partsDir, { recursive: true });
    return { prefix: output, metadata };
}

function benchmark(checkpoint, rounds, seed, reportPath) {
    return run(process.execPath, [
        path.join(__dirname, 'bench-rl-value-bot.js'),
        checkpoint,
        String(rounds),
        '0.2',
        '0.02',
        String(seed),
        reportPath
    ], { stream: false });
}

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(
            'Usage: npm run bot:ppo:distill -- --teacher FILE [options]');
        return 0;
    }
    if (!args.teacher) throw new Error('--teacher is required');
    for (const file of [args.teacher, args.resume]) {
        if (!fs.existsSync(file)) throw new Error(`Checkpoint not found: ${file}`);
    }
    if (fs.existsSync(args.workDir)) {
        throw new Error(
            `Work directory already exists; move or remove it: ${args.workDir}`);
    }
    fs.mkdirSync(args.workDir, { recursive: true });
    const started = Date.now();
    console.log(`\n=== collect ${args.rounds} teacher rounds ===`);
    const experience = await collect(args);
    console.log(
        `collection complete decisions=${experience.metadata.decisions} ` +
        `overrides=${experience.metadata.teacherOverrides} ` +
        `actions=${experience.metadata.actionRows}`
    );

    const python = path.resolve(SERVER_ROOT, '../.venv-rl/bin/python');
    const temporaryOutput = path.join(args.workDir, 'model.json');
    console.log(`\n=== behavior cloning on ${args.device} ===`);
    await run(python, [
        path.join(__dirname, 'train_ppo_imitation_gpu.py'),
        '--experience', experience.prefix,
        '--resume', args.resume,
        '--output', temporaryOutput,
        '--epochs', String(args.epochs),
        '--batch-size', String(args.batchSize),
        '--learning-rate', String(args.learningRate),
        '--override-weight', String(args.overrideWeight),
        '--entropy-coef', String(args.entropyCoefficient),
        '--device', args.device
    ]);

    console.log('\n=== teacher fidelity benchmark ===');
    const seed = 781231;
    const teacherReport = path.join(args.workDir, 'teacher-report.json');
    const cloneReport = path.join(args.workDir, 'clone-report.json');
    const [teacherRun, cloneRun] = await Promise.all([
        benchmark(args.teacher, args.benchmarkRounds, seed, teacherReport),
        benchmark(
            temporaryOutput, args.benchmarkRounds, seed, cloneReport)
    ]);
    process.stdout.write(`\n--- teacher ---\n${teacherRun.stdout}`);
    process.stdout.write(`\n--- clone ---\n${cloneRun.stdout}`);
    const teacher = JSON.parse(fs.readFileSync(teacherReport, 'utf8'));
    const clone = JSON.parse(fs.readFileSync(cloneReport, 'utf8'));
    const diagnostics = compareBenchmarkReports(teacher, clone);

    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.copyFileSync(temporaryOutput, args.output);
    const report = {
        schemaVersion: 1,
        teacher: args.teacher,
        output: args.output,
        settings: args,
        experience: experience.metadata,
        diagnostics: {
            roundDisagreementRate: diagnostics.roundDisagreementRate,
            firstActionDisagreementRate: diagnostics.firstActionDisagreementRate,
            utilityDelta:
                diagnostics.allPairedRounds.meanUtilityDelta,
            pointsDelta:
                diagnostics.allPairedRounds.meanPointsDelta,
            candidateBetter:
                diagnostics.disagreementRounds.candidateBetter,
            teacherBetter:
                diagnostics.disagreementRounds.parentBetter
        },
        elapsedSeconds: (Date.now() - started) / 1000,
        completedAt: new Date().toISOString()
    };
    fs.writeFileSync(
        path.join(args.workDir, 'distillation.json'),
        `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(`\ncheckpoint=${args.output}`);
    return 0;
}

if (require.main === module) {
    main().then(code => {
        process.exitCode = code;
    }).catch(error => {
        console.error(`\nPPO distillation failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs };
