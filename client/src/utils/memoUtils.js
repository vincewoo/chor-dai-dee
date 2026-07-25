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
        prevProps.isDesktop === nextProps.isDesktop &&
        // Must be compared: without it a card memoized as interactive would stay
        // clickable after flipping to read-only (spectator view).
        prevProps.readOnly === nextProps.readOnly
        // We intentionally ignore onClick to allow memoization even if the handler identity changes
        // This is safe because the action (toggle selection) depends only on the card's identity
    );
};

export const arePlayedCardsPropsEqual = (prevProps, nextProps) => {
    // Basic props comparison
    if (
        prevProps.position !== nextProps.position ||
        prevProps.isCurrentTurn !== nextProps.isCurrentTurn ||
        prevProps.playerName !== nextProps.playerName ||
        prevProps.isMe !== nextProps.isMe ||
        prevProps.trickWinPending !== nextProps.trickWinPending ||
        prevProps.isDesktop !== nextProps.isDesktop
    ) {
        return false;
    }

    // Deep comparison for lastPlayed
    // If both are null/undefined, they are equal
    if (!prevProps.lastPlayed && !nextProps.lastPlayed) {
        return true;
    }

    // If one is null/undefined but not the other, they are not equal
    if (!prevProps.lastPlayed || !nextProps.lastPlayed) {
        return false;
    }

    // Compare lastPlayed properties
    const prevPlayed = prevProps.lastPlayed;
    const nextPlayed = nextProps.lastPlayed;

    if (
        prevPlayed.type !== nextPlayed.type ||
        prevPlayed.playOrder !== nextPlayed.playOrder
    ) {
        return false;
    }

    // If playOrder is present and equal, we assume the cards are the same
    // (playOrder should be unique for each play)
    if (prevPlayed.playOrder !== undefined) {
        return true;
    }

    // Fallback: compare cards array length and content if playOrder is missing
    const prevCards = prevPlayed.cards || [];
    const nextCards = nextPlayed.cards || [];

    if (prevCards.length !== nextCards.length) {
        return false;
    }

    // Check every card
    for (let i = 0; i < prevCards.length; i++) {
        if (
            prevCards[i].rank !== nextCards[i].rank ||
            prevCards[i].suit !== nextCards[i].suit
        ) {
            return false;
        }
    }

    return true;
};
