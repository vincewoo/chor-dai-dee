export const PUBLIC_RANK_COLORS = {
    Bronze: '#c78a5a',
    Silver: '#c3ccd6',
    Gold: '#ffc94d',
    Platinum: '#8fe3da',
    Unranked: 'rgba(244,245,247,.55)'
};

export const publicRankLabel = value => {
    if (typeof value === 'string') return value;
    if (value && typeof value.label === 'string') return value.label;
    return 'Bronze';
};

export const publicRankColor = value =>
    PUBLIC_RANK_COLORS[publicRankLabel(value)] || PUBLIC_RANK_COLORS.Bronze;
