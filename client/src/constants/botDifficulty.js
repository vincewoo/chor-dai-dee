// client/src/constants/botDifficulty.js
//
// How hard the bots at a table try. Mirrors BOT_DIFFICULTIES in
// server/game/BotPolicy.js, which is authoritative - the server validates the
// id it is sent and rebuilds its policy from its own table. These are labels.
//
// Duplicated across the boundary the same way GAME_MODES is.
export const BOT_DIFFICULTIES = {
    CASUAL: {
        id: 'casual',
        label: 'Casual',
        description: 'Makes plenty of mistakes'
    },
    BALANCED: {
        id: 'balanced',
        label: 'Balanced',
        description: 'Plays well, but not perfectly'
    },
    COMPETITIVE: {
        id: 'competitive',
        label: 'Competitive',
        description: 'Always plays its best move',
        isDefault: true
    }
};

export const DEFAULT_BOT_DIFFICULTY = BOT_DIFFICULTIES.COMPETITIVE.id;

// Easiest first, which is how the picker reads left to right.
export const BOT_DIFFICULTY_ORDER = [
    BOT_DIFFICULTIES.CASUAL,
    BOT_DIFFICULTIES.BALANCED,
    BOT_DIFFICULTIES.COMPETITIVE
];

export const botDifficultyLabel = (id) =>
    BOT_DIFFICULTY_ORDER.find(tier => tier.id === id)?.label || null;
