export const PUBLIC_RANK_COLORS = {
    Iron: '#8f9aa6',
    Bronze: '#c78a5a',
    Silver: '#c3ccd6',
    Gold: '#ffc94d',
    Platinum: '#8fe3da',
    Diamond: '#78d7ff',
    Champ: '#d6a8ff',
    Unranked: 'rgba(244,245,247,.55)'
};

// The ladder, low to high. Mirrors PUBLIC_RANKS in server/game/PublicRank.js —
// the server sends labels, never indices, so this is the client's only way to
// say where on the ladder a rank sits (the promotion splash draws the whole
// ladder and has to mark one rung).
export const PUBLIC_RANK_ORDER = [
    'Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champ'
];

const DEFAULT_PUBLIC_RANK_LABEL = 'Unranked';

export const publicRankLabel = value => {
    if (typeof value === 'string') return value;
    if (value && typeof value.label === 'string') return value.label;
    return DEFAULT_PUBLIC_RANK_LABEL;
};

export const publicRankColor = value =>
    PUBLIC_RANK_COLORS[publicRankLabel(value)] ||
    PUBLIC_RANK_COLORS[DEFAULT_PUBLIC_RANK_LABEL];

// Position on the ladder, or -1 for Unranked and anything unrecognised. Callers
// must handle -1 rather than treat it as Iron: "has not placed yet" is not the
// bottom rung, it is off the ladder.
export const publicRankIndex = value =>
    PUBLIC_RANK_ORDER.indexOf(publicRankLabel(value));
