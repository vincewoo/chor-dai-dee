// Display-only suit permutation for the Filipino Pusoy Dos variant.
// Underlying order is D < C < H < S (server/game/Deck.js, utils/cardUtils.js).
// Pusoy Dos order is C < S < H < D. Aligning the two position-for-position
// gives this order-preserving bijection, which is why no rule, comparison or
// flush check needs to change — only what the player sees.
export const PUSOY_DISPLAY_SUIT = { D: 'C', C: 'S', H: 'H', S: 'D' };

// Underlying suit -> the suit to draw. Callers must key BOTH the symbol and the
// colour off the result, or a card shown as ♦ would be drawn black.
export const displaySuit = (suit, pusoyMode) =>
    (pusoyMode && PUSOY_DISPLAY_SUIT[suit]) || suit;

// The server writes its errors in underlying notation and cannot know the
// viewer's lens, so the one card-naming message is translated on arrival.
// Keyed on the exact string emitted by server/game/RoomManager.js:996.
const LENSED_MESSAGES = {
    'Must play 3 of Diamonds on first turn': 'Must play 3 of Clubs on first turn',
};
export const lensServerMessage = (msg, pusoyMode) =>
    (pusoyMode && LENSED_MESSAGES[msg]) || msg;
