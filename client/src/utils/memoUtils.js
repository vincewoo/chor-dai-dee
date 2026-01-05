import React from 'react';

export const areCardPropsEqual = (prevProps, nextProps) => {
    return (
        prevProps.rank === nextProps.rank &&
        prevProps.suit === nextProps.suit &&
        prevProps.selected === nextProps.selected &&
        prevProps.isBack === nextProps.isBack &&
        prevProps.size === nextProps.size &&
        prevProps.index === nextProps.index &&
        prevProps.forceTraditionalColors === nextProps.forceTraditionalColors &&
        prevProps.dynamicWidth === nextProps.dynamicWidth &&
        prevProps.dynamicHeight === nextProps.dynamicHeight &&
        prevProps.isDesktop === nextProps.isDesktop
        // We intentionally ignore onClick to allow memoization even if the handler identity changes
        // This is safe because the action (toggle selection) depends only on the card's identity
    );
};
