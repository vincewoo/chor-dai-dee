/**
 * Procedural sound effects for the game table.
 *
 * Everything here is synthesized with the Web Audio API at call time — no
 * audio assets to ship, license, or cache for offline/PWA use. Each effect is
 * a short arrangement of oscillators and filtered noise bursts.
 *
 * Browsers block audio until the user interacts with the page, so the
 * AudioContext is created lazily on the first play attempt and `unlock()` is
 * wired to the first pointer/key event (see useGameSounds).
 */

let ctx = null;
let masterGain = null;
let currentVolume = 0.6;
let enabled = true;

// Noise buffers are relatively expensive to fill, so cache by duration.
const noiseCache = new Map();

const getContext = () => {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
        ctx = new AudioCtx();
        masterGain = ctx.createGain();
        masterGain.gain.value = currentVolume;
        masterGain.connect(ctx.destination);
    } catch (err) {
        console.warn('Web Audio unavailable:', err);
        ctx = null;
    }
    return ctx;
};

/**
 * Resume a suspended AudioContext. Safe to call repeatedly; browsers only
 * honour it inside a user-gesture handler.
 */
export const unlockAudio = () => {
    const c = getContext();
    if (c && c.state === 'suspended') {
        c.resume().catch(() => { /* still locked; next gesture will retry */ });
    }
};

export const setSoundEnabled = (value) => {
    enabled = !!value;
};

export const setSoundVolume = (value) => {
    currentVolume = Math.max(0, Math.min(1, value));
    if (masterGain && ctx) {
        masterGain.gain.setTargetAtTime(currentVolume, ctx.currentTime, 0.01);
    }
};

/** Guard shared by every effect: bail unless we have a running, enabled context. */
const ready = () => {
    if (!enabled) return null;
    const c = getContext();
    if (!c) return null;
    if (c.state === 'suspended') {
        // Try to wake it, but don't schedule into a context that isn't running —
        // the notes would all fire at once when it eventually resumes.
        c.resume().catch(() => {});
        if (c.state === 'suspended') return null;
    }
    return c;
};

const whiteNoiseBuffer = (c, duration) => {
    const key = duration.toFixed(3);
    const cached = noiseCache.get(key);
    if (cached) return cached;

    const length = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    noiseCache.set(key, buffer);
    return buffer;
};

/**
 * Filtered noise burst with a percussive envelope — the basis of card
 * handling sounds (snaps, riffles, thuds).
 */
const noiseBurst = (c, {
    at = 0,
    duration = 0.08,
    type = 'bandpass',
    frequency = 2000,
    q = 1,
    gain = 0.3,
    attack = 0.002,
}) => {
    const start = c.currentTime + at;
    const source = c.createBufferSource();
    source.buffer = whiteNoiseBuffer(c, duration);

    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const env = c.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(env);
    env.connect(masterGain);
    source.start(start);
    source.stop(start + duration);
};

/** Pitched tone with a soft envelope — used for chimes, cues and fanfares. */
const tone = (c, {
    at = 0,
    duration = 0.2,
    frequency = 440,
    type = 'sine',
    gain = 0.2,
    attack = 0.01,
    detune = 0,
}) => {
    const start = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;

    const env = c.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.02);
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Riffle shuffle: a rapid stochastic series of card-edge ticks. */
const playShuffle = (c) => {
    const riffles = 26;
    for (let i = 0; i < riffles; i++) {
        // Ease the gaps so the riffle accelerates then settles, like a real bridge.
        const progress = i / riffles;
        const at = progress * 0.42 + Math.random() * 0.012;
        noiseBurst(c, {
            at,
            duration: 0.035,
            type: 'bandpass',
            frequency: 1800 + Math.random() * 2600,
            q: 1.4,
            gain: 0.055 + Math.random() * 0.03,
        });
    }
    // Squared-up deck tapped on the table to finish.
    noiseBurst(c, { at: 0.5, duration: 0.11, type: 'lowpass', frequency: 700, gain: 0.16 });
};

/** Card snapping down onto the pile. */
const playPlay = (c) => {
    noiseBurst(c, { at: 0, duration: 0.07, type: 'bandpass', frequency: 2600, q: 0.9, gain: 0.3 });
    noiseBurst(c, { at: 0.012, duration: 0.11, type: 'lowpass', frequency: 900, gain: 0.14 });
};

/** Muted thud — a hand laid face-down on a pass. */
const playPass = (c) => {
    noiseBurst(c, { at: 0, duration: 0.13, type: 'lowpass', frequency: 420, q: 0.7, gain: 0.2 });
    tone(c, { at: 0, duration: 0.09, frequency: 128, type: 'sine', gain: 0.07 });
};

/** Short rising chime for winning a round. */
const playRoundWin = (c) => {
    [659.25, 830.61, 987.77].forEach((frequency, i) => {
        tone(c, { at: i * 0.085, duration: 0.32, frequency, type: 'triangle', gain: 0.16 });
    });
};

/** Fuller ascending fanfare for taking the whole game. */
const playGameWin = (c) => {
    // C-E-G-C major arpeggio, each note doubled an octave up for sparkle.
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
        const at = i * 0.11;
        tone(c, { at, duration: 0.45, frequency, type: 'triangle', gain: 0.18 });
        tone(c, { at, duration: 0.35, frequency: frequency * 2, type: 'sine', gain: 0.05 });
    });
    // Sustained final chord.
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency) => {
        tone(c, { at: 0.46, duration: 0.9, frequency, type: 'triangle', gain: 0.09, attack: 0.03 });
    });
};

/** Losing the game — the same arpeggio inverted into a minor fall. */
const playGameLose = (c) => {
    [493.88, 415.30, 349.23].forEach((frequency, i) => {
        tone(c, { at: i * 0.13, duration: 0.5, frequency, type: 'triangle', gain: 0.13 });
    });
};

/** Two-note ping when it becomes your turn. */
const playYourTurn = (c) => {
    tone(c, { at: 0, duration: 0.16, frequency: 880, type: 'sine', gain: 0.13 });
    tone(c, { at: 0.11, duration: 0.22, frequency: 1174.66, type: 'sine', gain: 0.13 });
};

/** Tiny tick for selecting a card. */
const playSelect = (c) => {
    noiseBurst(c, { at: 0, duration: 0.028, type: 'highpass', frequency: 3200, gain: 0.12 });
};

/** Slightly duller tick for deselecting. */
const playDeselect = (c) => {
    noiseBurst(c, { at: 0, duration: 0.028, type: 'bandpass', frequency: 1500, q: 1.2, gain: 0.1 });
};

/** Low buzz for an invalid play. */
const playError = (c) => {
    tone(c, { at: 0, duration: 0.14, frequency: 196, type: 'sawtooth', gain: 0.1 });
    tone(c, { at: 0.11, duration: 0.18, frequency: 155.56, type: 'sawtooth', gain: 0.1 });
};

const EFFECTS = {
    shuffle: playShuffle,
    play: playPlay,
    pass: playPass,
    roundWin: playRoundWin,
    gameWin: playGameWin,
    gameLose: playGameLose,
    yourTurn: playYourTurn,
    select: playSelect,
    deselect: playDeselect,
    error: playError,
};

export const SOUND_NAMES = Object.keys(EFFECTS);

/**
 * Play a named effect. No-ops when sound is disabled, the context is still
 * locked, or Web Audio is unsupported — callers never need to guard.
 */
export const playSound = (name) => {
    const effect = EFFECTS[name];
    if (!effect) {
        console.warn(`Unknown sound: ${name}`);
        return;
    }
    const c = ready();
    if (!c) return;
    try {
        effect(c);
    } catch (err) {
        console.warn(`Error playing sound "${name}":`, err);
    }
};
