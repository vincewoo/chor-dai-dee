// Each glyph carries U+FE0E, the text-presentation variation selector. Without
// it iOS resolves ♦ ♥ ♠ ♣ to Apple Color Emoji — colour faces that ignore
// `color`/`text-red-600` — so every suit these render (How to Play's rank refs
// and suit table) showed as glossy red/black emoji on iPhone. The selector pins
// them to the monochrome text face, letting SUIT_COLORS decide the colour, and
// keeps this copy consistent with the canonical SUIT_SYMBOLS in theme/tableTheme.js.
export const SUIT_SYMBOLS = {
    D: '♦︎',
    C: '♣︎',
    H: '♥︎',
    S: '♠︎'
};

export const SUIT_COLORS = {
    D: 'text-red-600',
    C: 'text-black',
    H: 'text-red-600',
    S: 'text-black'
};

// 4-color mode: blue diamonds, green clubs for better visibility
export const SUIT_COLORS_4 = {
    D: 'text-blue-500',
    C: 'text-green-600',
    H: 'text-red-600',
    S: 'text-black'
};
