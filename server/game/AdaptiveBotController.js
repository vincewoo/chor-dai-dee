// A persistent, game-boundary-only estimate of how hard one human should face
// the bots. This module is deliberately pure: RoomManager owns live game state,
// db.js owns persistence, and this file only turns completed-game evidence into
// the configuration for the next game.

const CONTROLLER_VERSION = 1;

const MIN_TEMPERATURE = 3;
const MAX_TEMPERATURE = 20;
const COLD_START_TEMPERATURE = 10;
const TEMPERATURE_DEADBAND = 0.5;
const PLACEMENT_MAX_STEP = 2;
const CALIBRATED_MAX_STEP = 0.75;

const MIN_PLACEMENT_GAMES = 5;
const MAX_PLACEMENT_GAMES = 10;
const TARGET_DECISIONS = 80;
const TARGET_ROUNDS = 15;
const DECISIONS_PER_ROUND_CAP = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundQuarter = value => Math.round(value * 4) / 4;

// T=10 is the deliberately forgiving cold start. Skill is an internal
// dimensionless value; it is neither the shadow OpenSkill estimate nor the
// coarse public rank.
const COLD_START_SKILL =
    (MAX_TEMPERATURE - COLD_START_TEMPERATURE) /
    (MAX_TEMPERATURE - MIN_TEMPERATURE);

function defaultCalibration() {
    return {
        skillMu: COLD_START_SKILL,
        skillSigma: 0.35,
        completedGames: 0,
        meaningfulDecisions: 0,
        completedRounds: 0,
        lastTemperature: COLD_START_TEMPERATURE,
        calibrationComplete: false,
        controllerVersion: CONTROLLER_VERSION
    };
}

function normalizeCalibration(value = {}) {
    const defaults = defaultCalibration();
    const number = (camel, snake, fallback) => {
        const raw = value[camel] ?? value[snake];
        return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
    };

    return {
        skillMu: clamp(
            number('skillMu', 'skill_mu', defaults.skillMu), 0, 1),
        skillSigma: clamp(
            number('skillSigma', 'skill_sigma', defaults.skillSigma), 0.05, 0.5),
        completedGames: Math.max(0, Math.trunc(number(
            'completedGames', 'completed_games', 0))),
        meaningfulDecisions: Math.max(0, Math.trunc(number(
            'meaningfulDecisions', 'meaningful_decisions', 0))),
        completedRounds: Math.max(0, Math.trunc(number(
            'completedRounds', 'completed_rounds', 0))),
        lastTemperature: clamp(number(
            'lastTemperature', 'last_temperature',
            defaults.lastTemperature), MIN_TEMPERATURE, MAX_TEMPERATURE),
        calibrationComplete: Boolean(
            value.calibrationComplete ?? value.calibration_complete),
        controllerVersion: Math.max(1, Math.trunc(number(
            'controllerVersion', 'controller_version', CONTROLLER_VERSION)))
    };
}

function temperatureForSkill(skillMu) {
    return roundQuarter(clamp(
        MAX_TEMPERATURE -
            clamp(skillMu, 0, 1) *
            (MAX_TEMPERATURE - MIN_TEMPERATURE),
        MIN_TEMPERATURE,
        MAX_TEMPERATURE
    ));
}

function trimmedMean(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
    const kept = trim ? sorted.slice(trim, sorted.length - trim) : sorted;
    return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function summarizeEvidence({
    decisions = [],
    rounds = [],
    finalPlacement = null
} = {}) {
    const byRound = new Map();
    for (const decision of decisions) {
        if (!decision || !decision.scored || !decision.confident ||
            !Number.isFinite(decision.lossFraction)) {
            continue;
        }
        const round = Number.isInteger(decision.round) ? decision.round : 0;
        if (!byRound.has(round)) byRound.set(round, []);
        byRound.get(round).push(clamp(decision.lossFraction, 0, 1));
    }

    // Decisions in one hand share a deal and a board trajectory, so they are
    // not independent samples. Let every choice affect that round's estimate,
    // but cap how much statistical weight the whole round can contribute.
    const losses = [];
    for (const roundLosses of byRound.values()) {
        const roundMean = roundLosses.reduce(
            (sum, loss) => sum + loss, 0) / roundLosses.length;
        const weight = Math.min(
            roundLosses.length, DECISIONS_PER_ROUND_CAP);
        losses.push(...Array(weight).fill(roundMean));
    }

    const meanLoss = trimmedMean(losses);
    // The existing quality bands call <= .15 "good" and > .40 a mistake.
    // Map the useful middle of that scale onto 0..1; this is versioned and is
    // expected to be re-fitted from live calibration data.
    const decisionSkill = meanLoss === null
        ? null
        : clamp((0.32 - meanLoss) / 0.28, 0, 1);

    const validRounds = rounds.filter(round =>
        Number.isInteger(round?.dealRank) &&
        Number.isInteger(round?.placement) &&
        round.dealRank >= 1 && round.dealRank <= 4 &&
        round.placement >= 1 && round.placement <= 4);
    const outcomeSkill = validRounds.length
        ? validRounds.reduce((sum, round) => {
            // Beating the placement implied by the deal is positive evidence.
            const residual = (round.dealRank - round.placement) / 3;
            return sum + clamp(0.5 + residual / 2, 0, 1);
        }, 0) / validRounds.length
        : Number.isInteger(finalPlacement)
            ? clamp(1 - (finalPlacement - 1) / 3, 0, 1)
            : null;

    return {
        effectiveDecisions: losses.length,
        completedRounds: validRounds.length,
        meanLoss,
        decisionSkill,
        outcomeSkill
    };
}

function evidenceProgress(calibration) {
    const value = normalizeCalibration(calibration);
    return clamp(
        0.34 * Math.min(value.completedGames / MIN_PLACEMENT_GAMES, 1) +
        0.33 * Math.min(value.meaningfulDecisions / TARGET_DECISIONS, 1) +
        0.33 * Math.min(value.completedRounds / TARGET_ROUNDS, 1),
        0,
        1
    );
}

function calibrationProgress(calibration) {
    const value = normalizeCalibration(calibration);
    return value.calibrationComplete ? 1 : evidenceProgress(value);
}

/**
 * Build one room-level estimate from every human at the table. Temperature is
 * averaged directly because it is the only calibration value consumed by the
 * live bot policy; the remaining fields keep the aggregate well-formed for
 * diagnostics without ever being persisted over an individual player.
 */
function averageCalibrations(calibrations = []) {
    const values = (calibrations.length
        ? calibrations
        : [defaultCalibration()]
    ).map(normalizeCalibration);
    const mean = key => values.reduce(
        (sum, value) => sum + value[key], 0) / values.length;

    return {
        skillMu: mean('skillMu'),
        skillSigma: mean('skillSigma'),
        completedGames: Math.floor(mean('completedGames')),
        meaningfulDecisions: Math.floor(mean('meaningfulDecisions')),
        completedRounds: Math.floor(mean('completedRounds')),
        lastTemperature: mean('lastTemperature'),
        calibrationComplete: values.every(
            value => value.calibrationComplete),
        controllerVersion: CONTROLLER_VERSION
    };
}

function updateCalibration(previous, rawEvidence) {
    const current = normalizeCalibration(previous);
    const evidence = rawEvidence?.effectiveDecisions === undefined
        ? summarizeEvidence(rawEvidence)
        : rawEvidence;

    const decisionWeight = evidence.decisionSkill === null
        ? 0
        : 0.7 * Math.min(evidence.effectiveDecisions / 40, 1);
    const outcomeWeight = evidence.outcomeSkill === null
        ? 0
        : 0.3 * Math.min(evidence.completedRounds / 8, 1);
    const totalWeight = decisionWeight + outcomeWeight;
    const observedSkill = totalWeight > 0
        ? (
            (evidence.decisionSkill || 0) * decisionWeight +
            (evidence.outcomeSkill || 0) * outcomeWeight
        ) / totalWeight
        : current.skillMu;

    const baseK = current.calibrationComplete ? 0.08 : 0.30;
    const nextSkill = clamp(
        current.skillMu +
            baseK * totalWeight * (observedSkill - current.skillMu),
        0,
        1
    );

    const next = {
        ...current,
        skillMu: nextSkill,
        completedGames: current.completedGames + 1,
        meaningfulDecisions:
            current.meaningfulDecisions + evidence.effectiveDecisions,
        completedRounds:
            current.completedRounds + evidence.completedRounds,
        controllerVersion: CONTROLLER_VERSION
    };

    next.calibrationComplete = current.calibrationComplete ||
        (
            next.completedGames >= MIN_PLACEMENT_GAMES &&
            next.meaningfulDecisions >= TARGET_DECISIONS &&
            next.completedRounds >= TARGET_ROUNDS
        ) ||
        next.completedGames >= MAX_PLACEMENT_GAMES;

    const progress = evidenceProgress(next);
    next.skillSigma = clamp(0.35 - 0.27 * progress, 0.08, 0.35);

    const desiredTemperature = temperatureForSkill(nextSkill);
    const difference = desiredTemperature - current.lastTemperature;
    if (Math.abs(difference) < TEMPERATURE_DEADBAND) {
        next.lastTemperature = current.lastTemperature;
    } else {
        const maxStep = current.calibrationComplete
            ? CALIBRATED_MAX_STEP
            : PLACEMENT_MAX_STEP;
        next.lastTemperature = roundQuarter(clamp(
            current.lastTemperature + clamp(difference, -maxStep, maxStep),
            MIN_TEMPERATURE,
            MAX_TEMPERATURE
        ));
    }

    return {
        calibration: next,
        evidence,
        observedSkill,
        desiredTemperature
    };
}

function publicCalibration(value) {
    const calibration = normalizeCalibration(value);
    const progress = calibrationProgress(calibration);
    return {
        complete: calibration.calibrationComplete,
        completedGames: calibration.completedGames,
        minimumGames: MIN_PLACEMENT_GAMES,
        maximumGames: MAX_PLACEMENT_GAMES,
        progress: Math.round(progress * 100),
        meaningfulDecisions: calibration.meaningfulDecisions,
        completedRounds: calibration.completedRounds
    };
}

module.exports = {
    CONTROLLER_VERSION,
    MIN_TEMPERATURE,
    MAX_TEMPERATURE,
    COLD_START_TEMPERATURE,
    MIN_PLACEMENT_GAMES,
    MAX_PLACEMENT_GAMES,
    defaultCalibration,
    normalizeCalibration,
    averageCalibrations,
    temperatureForSkill,
    summarizeEvidence,
    updateCalibration,
    calibrationProgress,
    publicCalibration
};
