import React, { useState, useMemo, useCallback } from 'react';
import { findEligibleHands, findAvailableHandTypes, HAND_TYPES } from '../utils/handFinder';

// Icons for each hand type
const HAND_ICONS = {
    [HAND_TYPES.PAIR]: '♦♦',
    [HAND_TYPES.TRIPLE]: '♣♣♣',
    [HAND_TYPES.STRAIGHT]: '⇢',
    [HAND_TYPES.FLUSH]: '♠',
    [HAND_TYPES.FULL_HOUSE]: '⌂',
    [HAND_TYPES.QUADS]: '■',
    [HAND_TYPES.STRAIGHT_FLUSH]: '★'
};

// Hand types to show (excluding singles)
const SHOWN_HAND_TYPES = [
    HAND_TYPES.PAIR,
    HAND_TYPES.TRIPLE,
    HAND_TYPES.STRAIGHT,
    HAND_TYPES.FLUSH,
    HAND_TYPES.FULL_HOUSE,
    HAND_TYPES.QUADS,
    HAND_TYPES.STRAIGHT_FLUSH
];

// Short names for buttons
const HAND_SHORT_NAMES = {
    [HAND_TYPES.PAIR]: 'Pair',
    [HAND_TYPES.TRIPLE]: 'Triple',
    [HAND_TYPES.STRAIGHT]: 'Straight',
    [HAND_TYPES.FLUSH]: 'Flush',
    [HAND_TYPES.FULL_HOUSE]: 'Full H.',
    [HAND_TYPES.QUADS]: 'Quads',
    [HAND_TYPES.STRAIGHT_FLUSH]: 'SF'
};

const HandHelper = ({ playerHand, lastPlayedHand, onSelectCards, isMyTurn }) => {
    // Track which hand type is currently active and which index within that type
    const [activeType, setActiveType] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);

    // Create a stable key for the hand state to detect changes
    const handKey = useMemo(() => {
        if (!playerHand) return '';
        return playerHand.map(c => `${c.rank}${c.suit}`).join(',');
    }, [playerHand]);

    const lastPlayedKey = useMemo(() => {
        if (!lastPlayedHand?.cards) return '';
        return lastPlayedHand.cards.map(c => `${c.rank}${c.suit}`).join(',');
    }, [lastPlayedHand]);

    // Find all available hand types (excluding singles)
    const availableHandTypes = useMemo(() => {
        const allTypes = findAvailableHandTypes(playerHand, lastPlayedHand);
        return allTypes.filter(h => SHOWN_HAND_TYPES.includes(h.type));
    }, [playerHand, lastPlayedHand]);

    // Check if current activeType is still valid
    const isActiveTypeValid = useMemo(() => {
        if (!activeType) return false;
        return availableHandTypes.some(h => h.type === activeType);
    }, [activeType, availableHandTypes]);

    // Handle clicking on a hand type button
    const handleTypeClick = useCallback((type) => {
        const hands = findEligibleHands(playerHand, lastPlayedHand, type);
        if (hands.length === 0) return;

        if (activeType === type && isActiveTypeValid) {
            // Cycling through hands of the same type
            const nextIndex = (activeIndex + 1) % hands.length;
            setActiveIndex(nextIndex);
            onSelectCards(hands[nextIndex].cards);
        } else {
            // Switching to a new type or activeType is no longer valid
            setActiveType(type);
            setActiveIndex(0);
            onSelectCards(hands[0].cards);
        }
    }, [activeType, activeIndex, playerHand, lastPlayedHand, onSelectCards, isActiveTypeValid]);

    // Clear selection
    const handleClear = useCallback(() => {
        setActiveType(null);
        setActiveIndex(0);
        onSelectCards([]);
    }, [onSelectCards]);

    if (!isMyTurn || availableHandTypes.length === 0) {
        return null;
    }

    return (
        <div
            key={`${handKey}-${lastPlayedKey}`}
            className="flex items-center gap-[0.5vmax] flex-wrap justify-center mb-[0.5vmax] animate-fadeIn"
        >
            <span className="text-white/60 text-[0.7vmax] mr-[0.25vmax]">Quick Select:</span>

            {availableHandTypes.map(({ type, count }) => {
                const isActive = activeType === type && isActiveTypeValid;
                const currentIndex = isActive ? activeIndex + 1 : 0;

                return (
                    <button
                        key={type}
                        onClick={() => handleTypeClick(type)}
                        className={`
                            px-[0.75vmax] py-[0.35vmax] rounded-lg font-bold text-[0.75vmax]
                            shadow-lg transition-all duration-150 flex items-center gap-[0.35vmax]
                            hover:scale-105 active:scale-95
                            ${isActive
                                ? 'bg-yellow-500 text-black ring-2 ring-yellow-300'
                                : 'bg-gray-700 text-white hover:bg-gray-600'
                            }
                        `}
                        title={`${HAND_SHORT_NAMES[type]} (${count} available)`}
                    >
                        <span className="text-[0.9vmax]">{HAND_ICONS[type]}</span>
                        <span>{HAND_SHORT_NAMES[type]}</span>
                        {count > 1 && (
                            <span className={`
                                text-[0.6vmax] px-[0.3vmax] rounded-full
                                ${isActive ? 'bg-black/30 text-yellow-100' : 'bg-white/20'}
                            `}>
                                {isActive ? `${currentIndex}/${count}` : count}
                            </span>
                        )}
                    </button>
                );
            })}

            {activeType && isActiveTypeValid && (
                <button
                    onClick={handleClear}
                    className="px-[0.6vmax] py-[0.35vmax] rounded-lg font-bold text-[0.7vmax]
                        bg-red-600/80 text-white hover:bg-red-500 shadow-lg
                        transition-all duration-150 hover:scale-105 active:scale-95"
                    title="Clear selection"
                >
                    ✕
                </button>
            )}
        </div>
    );
};

export default HandHelper;
