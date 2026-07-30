// client/src/constants/botDifficulty.js
//
// Player-facing subset of server/game/BotPolicy.js. The server retains the old
// fixed tier ids for historical logs and preferences; new rooms offer the
// simpler game-frozen Adaptive / full-strength Expert choice.
export const BOT_DIFFICULTIES = {
    ADAPTIVE: {
        id: 'adaptive',
        label: 'Adaptive',
        description: 'Calibrates between complete solo games'
    },
    EXPERT: {
        id: 'competitive',
        label: 'Expert',
        description: 'Always plays its strongest move'
    }
};

export const DEFAULT_BOT_DIFFICULTY = BOT_DIFFICULTIES.ADAPTIVE.id;

export const BOT_DIFFICULTY_ORDER = [
    BOT_DIFFICULTIES.ADAPTIVE,
    BOT_DIFFICULTIES.EXPERT
];

// Historical fixed tiers remain readable on old rooms and game payloads even
// though the new lobby offers the simpler Adaptive / Expert choice.
const LEGACY_LABELS = {
    casual: 'Casual',
    balanced: 'Balanced'
};

export const botDifficultyLabel = (id) =>
    BOT_DIFFICULTY_ORDER.find(tier => tier.id === id)?.label ||
    LEGACY_LABELS[id] ||
    null;
