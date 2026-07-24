import { useState, useMemo, useCallback } from 'react';
import { findEligibleHands, findAvailableHandTypes, HAND_TYPES } from '../../utils/handFinder';

const HAND_ICONS = {
    [HAND_TYPES.PAIR]: '♦♦',
    [HAND_TYPES.TRIPLE]: '♣♣♣',
    [HAND_TYPES.STRAIGHT]: '⇢',
    [HAND_TYPES.FLUSH]: '♠',
    [HAND_TYPES.FULL_HOUSE]: '⌂',
    [HAND_TYPES.QUADS]: '■',
    [HAND_TYPES.STRAIGHT_FLUSH]: '★',
};
const SHOWN_HAND_TYPES = [
    HAND_TYPES.PAIR, HAND_TYPES.TRIPLE, HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH,
    HAND_TYPES.FULL_HOUSE, HAND_TYPES.QUADS, HAND_TYPES.STRAIGHT_FLUSH,
];
const HAND_SHORT_NAMES = {
    [HAND_TYPES.PAIR]: 'Pair', [HAND_TYPES.TRIPLE]: 'Triple', [HAND_TYPES.STRAIGHT]: 'Straight',
    [HAND_TYPES.FLUSH]: 'Flush', [HAND_TYPES.FULL_HOUSE]: 'Full H.', [HAND_TYPES.QUADS]: 'Quads',
    [HAND_TYPES.STRAIGHT_FLUSH]: 'SF',
};

// Chip-style quick-select + Clear + Sort, plus the Pass / Play buttons.
function ControlsRow({
    playerHand, lastPlayedHand, isMyTurn, selectedCards, onSelectCards,
    sortMode, isCustomOrder, onSortClick,
    canPlay, canPass, playLabel, onPlay, onPass,
    acc, accGrad, rm,
}) {
    const [activeType, setActiveType] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);

    const availableHandTypes = useMemo(() => {
        const all = findAvailableHandTypes(playerHand, null);
        return all.filter(h => SHOWN_HAND_TYPES.includes(h.type));
    }, [playerHand]);

    const beatableHandTypes = useMemo(() => {
        if (!lastPlayedHand) return new Set();
        return new Set(findAvailableHandTypes(playerHand, lastPlayedHand).map(h => h.type));
    }, [playerHand, lastPlayedHand]);

    const isActiveTypeValid = useMemo(
        () => !!activeType && availableHandTypes.some(h => h.type === activeType),
        [activeType, availableHandTypes]
    );

    const handleTypeClick = useCallback((type) => {
        const allHands = findEligibleHands(playerHand, null, type);
        let hands = allHands;
        if (lastPlayedHand) {
            const beatable = findEligibleHands(playerHand, lastPlayedHand, type);
            const beatableSet = new Set(beatable.map(h => h.cards.map(c => `${c.rank}-${c.suit}`).join(',')));
            hands = [
                ...allHands.filter(h => beatableSet.has(h.cards.map(c => `${c.rank}-${c.suit}`).join(','))),
                ...allHands.filter(h => !beatableSet.has(h.cards.map(c => `${c.rank}-${c.suit}`).join(','))),
            ];
        }
        if (hands.length === 0) return;
        if (activeType === type && isActiveTypeValid) {
            const next = (activeIndex + 1) % hands.length;
            setActiveIndex(next);
            onSelectCards(hands[next].cards);
        } else {
            setActiveType(type);
            setActiveIndex(0);
            onSelectCards(hands[0].cards);
        }
    }, [activeType, activeIndex, playerHand, lastPlayedHand, onSelectCards, isActiveTypeValid]);

    const handleClear = useCallback(() => {
        setActiveType(null);
        setActiveIndex(0);
        onSelectCards([]);
    }, [onSelectCards]);

    const sortLabel = isCustomOrder ? '🔀 Custom' : (sortMode === 'rank' ? 'Sort: Rank' : 'Sort: Suit');
    const showChips = isMyTurn && availableHandTypes.length > 0;

    const chipBase = {
        flexShrink: 0, padding: '7px 12px', borderRadius: 10, fontFamily: "'Outfit',sans-serif",
        fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
        whiteSpace: 'nowrap',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, width: '100%' }}>
            {/* Quick-select chips + Clear + Sort */}
            <div
                className="scrollbar-thin"
                style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: '100%', overflowX: 'auto', padding: '2px 12px' }}
            >
                {showChips && availableHandTypes.map(({ type, count }) => {
                    const isActive = activeType === type && isActiveTypeValid;
                    const canBeat = beatableHandTypes.has(type);
                    const currentIndex = isActive ? activeIndex + 1 : 0;
                    return (
                        <button
                            key={type}
                            onClick={() => handleTypeClick(type)}
                            style={{
                                ...chipBase,
                                border: `1px solid ${isActive ? acc : (canBeat ? `${acc}66` : 'rgba(255,255,255,.18)')}`,
                                background: isActive ? acc : 'rgba(0,0,0,.38)',
                                color: isActive ? '#0b0d10' : (canBeat ? acc : 'rgba(244,245,247,.55)'),
                            }}
                        >
                            <span>{HAND_ICONS[type]}</span>
                            <span>{HAND_SHORT_NAMES[type]}</span>
                            {count > 1 && (
                                <span style={{
                                    fontSize: 9, padding: '1px 5px', borderRadius: 999,
                                    background: isActive ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.15)',
                                }}>
                                    {isActive ? `${currentIndex}/${count}` : count}
                                </span>
                            )}
                        </button>
                    );
                })}
                {((activeType && isActiveTypeValid) || (selectedCards && selectedCards.length > 0)) && (
                    <button
                        onClick={handleClear}
                        style={{ ...chipBase, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7' }}
                    >
                        ↺ Clear
                    </button>
                )}
                <button
                    onClick={onSortClick}
                    style={{ ...chipBase, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7' }}
                >
                    {sortLabel}
                </button>
            </div>

            {/* Pass / Play */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                    onClick={onPass}
                    disabled={!canPass}
                    style={{
                        minWidth: 104, padding: '13px 0', borderRadius: 14,
                        border: `1px solid ${canPass ? `${acc}66` : 'rgba(255,255,255,.1)'}`,
                        background: canPass ? 'rgba(0,0,0,.45)' : 'rgba(0,0,0,.25)',
                        color: canPass ? '#f4f5f7' : 'rgba(244,245,247,.4)',
                        fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 16,
                        cursor: canPass ? 'pointer' : 'not-allowed',
                    }}
                >
                    Pass
                </button>
                <button
                    onClick={onPlay}
                    disabled={!canPlay}
                    style={{
                        minWidth: 150, padding: '14px 0', borderRadius: 14, border: 'none',
                        background: canPlay ? accGrad : 'rgba(0,0,0,.35)',
                        color: canPlay ? '#0b0d10' : 'rgba(244,245,247,.45)',
                        fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 17,
                        cursor: canPlay ? 'pointer' : 'not-allowed',
                        boxShadow: '0 10px 22px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.3)',
                        animation: canPlay && !rm ? 'cddPulse 1.6s ease-in-out infinite' : 'none',
                    }}
                >
                    {playLabel}
                </button>
            </div>
        </div>
    );
}

export default ControlsRow;
