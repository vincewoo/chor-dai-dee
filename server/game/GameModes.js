// server/game/GameModes.js
const GAME_MODES = {
    SHORT: {
        id: 'short',
        name: 'Short Game',
        pointThreshold: 50,
        description: '~30 minutes'
    },
    STANDARD: {
        id: 'standard',
        name: 'Standard Game',
        pointThreshold: 100,
        description: '~60 minutes',
        isDefault: true
    }
};

const getGameModeConfig = (modeId) => {
    return Object.values(GAME_MODES).find(m => m.id === modeId) || GAME_MODES.STANDARD;
};

const getPointThreshold = (modeId) => {
    return getGameModeConfig(modeId).pointThreshold;
};

module.exports = { GAME_MODES, getGameModeConfig, getPointThreshold };
