// Avatar catalogue. Mirrors PICKER_ANIMALS / TILE_GRADS in
// client/src/utils/avatars.js — an avatar is shown to every other player at the
// table, so the server only stores values it recognises. Keep the two lists in
// sync when the picker gains options.

const AVATAR_ANIMALS = ['🐯', '🐼', '🐰', '🦊', '🐸', '🦉', '🐱', '🐧', '🐢', '🐨', '🦁', '🐹'];
const AVATAR_TILE_COUNT = 5;

// Returns { animal, tile } when the pair is a valid avatar, otherwise null.
function normalizeAvatar(animal, tile) {
    if (!AVATAR_ANIMALS.includes(animal)) return null;
    const idx = Number(tile);
    const safeTile = Number.isInteger(idx) && idx >= 0 && idx < AVATAR_TILE_COUNT ? idx : 0;
    return { animal, tile: safeTile };
}

module.exports = { AVATAR_ANIMALS, AVATAR_TILE_COUNT, normalizeAvatar };
