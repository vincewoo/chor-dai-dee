// client/src/constants/gameModes.js
export const GAME_MODES = {
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
