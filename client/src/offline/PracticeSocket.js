export class PracticeSocket {
    constructor() {
        this.connected = true;
        this.listeners = new Map();
        this.worker = new Worker(
            new URL('./practiceWorker.js', import.meta.url),
            { type: 'module' }
        );
        this.worker.onmessage = ({ data }) => {
            const callbacks = this.listeners.get(data?.event);
            if (!callbacks) return;
            for (const callback of [...callbacks]) callback(data.data);
        };
        this.worker.onerror = (event) => {
            const callbacks = this.listeners.get('error');
            if (!callbacks) return;
            for (const callback of [...callbacks]) {
                callback(event.message || 'Practice Mode failed to start');
            }
        };
    }

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return this;
    }

    off(event, callback) {
        if (callback) this.listeners.get(event)?.delete(callback);
        else this.listeners.delete(event);
        return this;
    }

    emit(event, payload) {
        this.worker.postMessage({ event, payload });
        return this;
    }

    close() {
        this.connected = false;
        this.worker.terminate();
        this.listeners.clear();
    }
}

export function createPracticeSocket() {
    return new PracticeSocket();
}
