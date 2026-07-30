import { useCallback, useSyncExternalStore } from 'react';

const levels = new Map();
const listenersByUser = new Map();

// These are every threshold currently used by the seat indicator and the local
// voice-control meter. Crossing one must always publish, even when the numeric
// change is otherwise too small to be visually meaningful.
const DISPLAY_THRESHOLDS = [0.05, 0.15, 0.2, 0.35, 0.4, 0.55, 0.6];
const MIN_LEVEL_CHANGE = 0.025;

const getDisplayBand = (level) => {
  let band = 0;
  while (band < DISPLAY_THRESHOLDS.length && level > DISPLAY_THRESHOLDS[band]) {
    band += 1;
  }
  return band;
};

const notifyUser = (userId) => {
  const listeners = listenersByUser.get(userId);
  if (!listeners) return;
  [...listeners].forEach(listener => listener());
};

export const getVoiceLevel = (userId) => {
  if (!userId) return 0;
  return levels.get(userId) ?? 0;
};

export const setVoiceLevel = (userId, rawLevel) => {
  if (!userId || !Number.isFinite(rawLevel)) return;

  const nextLevel = Math.max(0, Math.min(1, rawLevel));
  const previousLevel = getVoiceLevel(userId);
  const crossedDisplayThreshold =
    getDisplayBand(previousLevel) !== getDisplayBand(nextLevel);

  // Silence commonly produces the same zero-level sample indefinitely. Avoid
  // notifying React unless the meter would show a meaningful visual change.
  if (
    !crossedDisplayThreshold &&
    Math.abs(nextLevel - previousLevel) < MIN_LEVEL_CHANGE
  ) {
    return;
  }

  levels.set(userId, nextLevel);
  notifyUser(userId);
};

export const clearVoiceLevel = (userId) => {
  if (!userId || !levels.has(userId)) return;
  levels.delete(userId);
  notifyUser(userId);
};

export const clearAllVoiceLevels = () => {
  const userIds = [...levels.keys()];
  levels.clear();
  userIds.forEach(notifyUser);
};

export const subscribeToVoiceLevel = (userId, listener) => {
  if (!userId) return () => {};

  let listeners = listenersByUser.get(userId);
  if (!listeners) {
    listeners = new Set();
    listenersByUser.set(userId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByUser.delete(userId);
    }
  };
};

export const useVoiceLevel = (userId) => {
  const subscribe = useCallback(
    listener => subscribeToVoiceLevel(userId, listener),
    [userId]
  );
  const getSnapshot = useCallback(() => getVoiceLevel(userId), [userId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
};
