// Manages the long-lived Python process that serves advanced (PPO) bot moves.
//
// The previous design spawned `python3 inference.py` per decision. That paid a
// TensorFlow import, a graph build and a 3.6 MB weight load every time -- several
// seconds of CPU for one forward pass, which routinely blew the 5s fallback
// timeout and meant the advanced bot rarely actually played. Here the process is
// started once, warmed up, and then answers newline-delimited JSON requests.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SCRIPT_PATH = path.join(__dirname, '../ai/inference.py');

// Warm-up covers importing TensorFlow and loading weights.
const STARTUP_TIMEOUT_MS = 60000;
// A single forward pass is milliseconds; this only catches a wedged process.
const REQUEST_TIMEOUT_MS = 10000;
// Stop trying to respawn after repeated immediate failures (e.g. python3 or
// tensorflow missing) so we degrade cleanly to the heuristic bot instead of
// spawn-looping.
const MAX_CONSECUTIVE_FAILURES = 3;

class AdvancedBotWorker {
    // scriptPath is injectable so the protocol can be exercised without a
    // TensorFlow install; production always uses the default.
    constructor(scriptPath = SCRIPT_PATH) {
        this.scriptPath = scriptPath;
        this.proc = null;
        this.ready = null;           // Promise resolved once the worker reports ready
        this.pending = new Map();    // request id -> { resolve, reject, timer }
        this.nextId = 1;
        this.consecutiveFailures = 0;
        this.disabled = false;
    }

    // True when the worker is permanently unavailable and callers should not
    // bother waiting on it.
    isDisabled() {
        return this.disabled;
    }

    start() {
        if (this.ready) return this.ready;

        this.ready = new Promise((resolve, reject) => {
            let proc;
            try {
                proc = spawn('python3', [this.scriptPath], {
                    cwd: path.dirname(this.scriptPath),
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch (err) {
                return reject(err);
            }

            this.proc = proc;

            const startupTimer = setTimeout(() => {
                reject(new Error('Advanced bot worker startup timed out'));
                this.kill();
            }, STARTUP_TIMEOUT_MS);

            const rl = readline.createInterface({ input: proc.stdout });

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                let msg;
                try {
                    msg = JSON.parse(trimmed);
                } catch {
                    // Anything the model prints that is not our protocol.
                    console.warn('[AdvancedBot] non-JSON output:', trimmed.slice(0, 200));
                    return;
                }

                if (msg.ready) {
                    clearTimeout(startupTimer);
                    this.consecutiveFailures = 0;
                    console.log('[AdvancedBot] worker ready');
                    resolve();
                    return;
                }

                this.settle(msg);
            });

            proc.stderr.on('data', (data) => {
                // TensorFlow is noisy on startup; keep it out of the main log unless
                // it looks like a real error.
                const text = data.toString();
                if (/error|traceback/i.test(text)) {
                    console.error('[AdvancedBot stderr]', text.trim().slice(0, 500));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(startupTimer);
                console.error('[AdvancedBot] failed to spawn:', err.message);
                this.handleExit();
                reject(err);
            });

            proc.on('exit', (code, signal) => {
                clearTimeout(startupTimer);
                console.warn(`[AdvancedBot] worker exited (code=${code}, signal=${signal})`);
                this.handleExit();
                reject(new Error('Advanced bot worker exited during startup'));
            });
        });

        // A rejected startup promise must not become an unhandled rejection; callers
        // attach their own handlers, but the stored promise may be inspected later.
        this.ready.catch(() => {});

        return this.ready;
    }

    // Resolve the pending request a response belongs to.
    settle(msg) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;

        this.pending.delete(msg.id);
        clearTimeout(entry.timer);

        if (msg.error) {
            entry.reject(new Error(msg.error));
        } else {
            entry.resolve(msg);
        }
    }

    // Fail everything in flight and tear down so the next call restarts cleanly.
    handleExit() {
        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error('Advanced bot worker exited'));
        }
        this.pending.clear();

        this.proc = null;
        this.ready = null;

        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.disabled = true;
            console.error(
                `[AdvancedBot] disabling advanced bot after ${this.consecutiveFailures} ` +
                `consecutive worker failures; falling back to the heuristic bot`
            );
        }
    }

    kill() {
        if (this.proc) {
            this.proc.kill();
        }
    }

    // Send one decision request. Rejects on timeout, worker crash, or model error;
    // the caller is expected to fall back to the heuristic bot.
    async request(payload) {
        if (this.disabled) {
            throw new Error('Advanced bot worker is disabled');
        }

        await this.start();

        if (!this.proc || !this.proc.stdin.writable) {
            throw new Error('Advanced bot worker is not writable');
        }

        const id = this.nextId++;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Advanced bot request timed out'));
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(id, { resolve, reject, timer });

            try {
                this.proc.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
            } catch (err) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(err);
            }
        });
    }
}

// One worker per server process.
const worker = new AdvancedBotWorker();

// Don't leave the Python process orphaned when the server stops (the autostop
// path calls process.exit directly).
const shutdown = () => worker.kill();
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

module.exports = { worker, AdvancedBotWorker };
