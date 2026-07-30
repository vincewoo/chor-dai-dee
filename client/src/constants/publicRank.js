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

const DEFAULT_PUBLIC_RANK_LABEL = 'Unranked';

export const publicRankLabel = value => {
    if (typeof value === 'string') return value;
    if (value && typeof value.label === 'string') return value.label;
    return DEFAULT_PUBLIC_RANK_LABEL;
};

export const publicRankColor = value =>
    PUBLIC_RANK_COLORS[publicRankLabel(value)] ||
    PUBLIC_RANK_COLORS[DEFAULT_PUBLIC_RANK_LABEL];
