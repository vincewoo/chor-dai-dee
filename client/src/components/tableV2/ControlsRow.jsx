import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { findQuickSelectHands, findAvailableHandTypes, HAND_TYPES } from '../../utils/handFinder';
import { CoachButton } from './CoachBubble';

// The suit icons carry U+FE0E for the same reason as theme/tableTheme's
// SUIT_SYMBOLS: without it iOS renders them as colour emoji.
const HAND_ICONS = {
    [HAND_TYPES.PAIR]: '♦︎♦︎',
    [HAND_TYPES.TRIPLE]: '♣︎♣︎♣︎',
    [HAND_TYPES.STRAIGHT]: '⇢',
    [HAND_TYPES.FLUSH]: '♠︎',
    [HAND_TYPES.FULL_HOUSE]: '⌂',
    [HAND_TYPES.QUADS]: '■',
    [HAND_TYPES.STRAIGHT_FLUSH]: '★',
};
const SHOWN_HAND_TYPES = [
    HAND_TYPES.PAIR, HAND_TYPES.TRIPLE, HAND_TYPES.STRAIGHT, HAND_TYPES.FLUSH,
    HAND_TYPES.FULL_HOUSE, HAND_TYPES.QUADS, HAND_TYPES.STRAIGHT_FLUSH,
];
const HELPER_ROW_INSET = 12;
// Width of the scroll-edge fade on the chip strip. Deliberately its own
// constant: HELPER_ROW_INSET also drives wrapper padding and the
// scroll-into-view offset, and a padding tweak shouldn't change the fade.
const EDGE_FADE_WIDTH = 12;
const THREE_OF_DIAMONDS = { rank: '3', suit: 'D' };
const HAND_SHORT_NAMES = {
    [HAND_TYPES.PAIR]: 'Pair', [HAND_TYPES.TRIPLE]: 'Triple', [HAND_TYPES.STRAIGHT]: 'Straight',
    [HAND_TYPES.FLUSH]: 'Flush', [HAND_TYPES.FULL_HOUSE]: 'Full H.', [HAND_TYPES.QUADS]: 'Quads',
    [HAND_TYPES.STRAIGHT_FLUSH]: 'SF',
};

// Chip-style quick-select + right-aligned Reset / Sort actions, plus Pass / Play.
function ControlsRow({
    playerHand, lastPlayedHand, isMyTurn, isFirstLead, selectedCards, onSelectCards,
    sortMode, isCustomOrder, onSortClick,
    canPlay, canPass, playLabel, onPlay, onPass,
    coach,
    acc, accGrad, rm,
    // Caps how wide the row may spread. Unset on the phone, where the row is
    // already only a thumb wide. On desktop the row would otherwise stretch the
    // full table: the quick-select chips ended up under the left seat and Sort
    // under the right, a ~1200px round trip for two buttons used constantly.
    maxWidth,
}) {
    const [activeType, setActiveType] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [activeCanPlay, setActiveCanPlay] = useState(false);
    const [chipsOverflow, setChipsOverflow] = useState(false);
    const helperRowRef = useRef(null);
    const chipRefs = useRef({});

    const availableHandTypes = useMemo(() => {
        const all = findAvailableHandTypes(playerHand, null);
        return all.filter(h => SHOWN_HAND_TYPES.includes(h.type));
    }, [playerHand]);

    // The edge fade only earns its keep when there is actually something to
    // scroll to — a permanent fade on a row whose chips all fit reads as the
    // very layout bug it exists to prevent. Re-checked when the chip set
    // changes (dep) and when the row's box resizes (observer).
    useEffect(() => {
        const row = helperRowRef.current;
        if (!row) return;
        const check = () => setChipsOverflow(row.scrollWidth > row.clientWidth + 1);
        check();
        const ro = new ResizeObserver(check);
        ro.observe(row);
        return () => ro.disconnect();
    }, [availableHandTypes]);

    const playableHandTypes = useMemo(() => {
        if (!isMyTurn) return new Set();
        if (!lastPlayedHand && !isFirstLead) {
            return new Set(availableHandTypes.map(hand => hand.type));
        }
        const requiredCard = isFirstLead ? THREE_OF_DIAMONDS : null;
        return new Set(findAvailableHandTypes(playerHand, lastPlayedHand, requiredCard).map(h => h.type));
    }, [availableHandTypes, playerHand, lastPlayedHand, isMyTurn, isFirstLead]);
    const firstPlayableType = SHOWN_HAND_TYPES.find(type => playableHandTypes.has(type));

    useEffect(() => {
        if (!isMyTurn || !firstPlayableType || !helperRowRef.current) return;

        const chip = chipRefs.current[firstPlayableType];
        const row = helperRowRef.current;
        if (!chip) return;

        const rowRect = row.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const targetLeft = row.scrollLeft + chipRect.left - rowRect.left - HELPER_ROW_INSET;
        const boundedLeft = Math.max(0, Math.min(targetLeft, row.scrollWidth - row.clientWidth));

        if (Math.abs(row.scrollLeft - boundedLeft) > 1) {
            row.scrollTo({
                left: boundedLeft,
                behavior: rm ? 'auto' : 'smooth',
            });
        }
    }, [isMyTurn, firstPlayableType, rm]);

    const isActiveTypeValid = useMemo(
        // The parent clears selectedCards between plays and tricks. Treat that
        // as the source of truth so a stale local activeType cannot make a chip
        // look selected when no cards are actually selected.
        () => !!activeType && selectedCards?.length > 0
            && availableHandTypes.some(h => h.type === activeType),
        [activeType, availableHandTypes, selectedCards]
    );

    const handleTypeClick = useCallback((type) => {
        const requiredCard = isFirstLead ? THREE_OF_DIAMONDS : null;
        const options = findQuickSelectHands(playerHand, lastPlayedHand, type, requiredCard);
        if (options.length === 0) return;

        if (activeType === type && isActiveTypeValid) {
            const next = (activeIndex + 1) % options.length;
            setActiveIndex(next);
            setActiveCanPlay(options[next].canPlay);
            onSelectCards(options[next].hand.cards);
        } else {
            setActiveType(type);
            setActiveIndex(0);
            setActiveCanPlay(options[0].canPlay);
            onSelectCards(options[0].hand.cards);
        }
    }, [activeType, activeIndex, playerHand, lastPlayedHand, isFirstLead, onSelectCards, isActiveTypeValid]);

    const handleClear = useCallback(() => {
        setActiveType(null);
        setActiveIndex(0);
        setActiveCanPlay(false);
        onSelectCards([]);
    }, [onSelectCards]);

    const sortLabel = isCustomOrder ? '🔀 Custom' : (sortMode === 'rank' ? 'Sort: Rank' : 'Sort: Suit');
    const showChips = availableHandTypes.length > 0;

    const chipBase = {
        flexShrink: 0, padding: '7px 12px', borderRadius: 10, fontFamily: "'Outfit',sans-serif",
        fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
        whiteSpace: 'nowrap',
    };

    // Fades the clipped edges of the scrollable chip strip so a half-visible
    // chip reads as "more to scroll" rather than a layout bug.
    const edgeFade = `linear-gradient(90deg, transparent 0, #000 ${EDGE_FADE_WIDTH}px, #000 calc(100% - ${EDGE_FADE_WIDTH}px), transparent 100%)`;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, width: '100%', maxWidth }}>
            {/* One row: the chips scroll in the space that remains after the
                pinned Reset / Sort actions. A single row (rather than chips
                above a utility row) keeps the stack short enough to clear the
                pile on viewports with mobile-browser chrome. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: `0 ${HELPER_ROW_INSET}px`, boxSizing: 'border-box' }}>
                <div
                    ref={helperRowRef}
                    className="scrollbar-thin"
                    style={{
                        display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, overflowX: 'auto', padding: '2px 0',
                        ...(chipsOverflow ? { WebkitMaskImage: edgeFade, maskImage: edgeFade } : null),
                    }}
                >
                    {showChips && availableHandTypes.map(({ type, count }) => {
                        const isActive = activeType === type && isActiveTypeValid;
                        const canPlayType = playableHandTypes.has(type);
                        const activeIsPlayable = isMyTurn && isActive && activeCanPlay;
                        const currentIndex = isActive ? activeIndex + 1 : 0;
                        const title = !isMyTurn
                            ? `${HAND_SHORT_NAMES[type]} preview. Click to review and cycle while you wait for your turn.`
                            : (canPlayType
                                ? `${HAND_SHORT_NAMES[type]} can be played. Click to select the lowest option; click again to cycle.`
                                : (isFirstLead
                                    ? `${HAND_SHORT_NAMES[type]} cannot open because none include the 3 of Diamonds. Click to preview and cycle anyway.`
                                    : `${HAND_SHORT_NAMES[type]} cannot beat the current hand. Click to preview and cycle anyway.`));
                        return (
                            <button
                                ref={(element) => {
                                    if (element) chipRefs.current[type] = element;
                                    else delete chipRefs.current[type];
                                }}
                                key={type}
                                onClick={() => handleTypeClick(type)}
                                title={title}
                                aria-label={title}
                                style={{
                                    ...chipBase,
                                    border: `1px solid ${activeIsPlayable ? acc : (isActive ? 'rgba(255,255,255,.48)' : (canPlayType ? `${acc}88` : 'rgba(255,255,255,.18)'))}`,
                                    background: activeIsPlayable
                                        ? acc
                                        : (isActive ? 'rgba(255,255,255,.1)' : (canPlayType ? `${acc}18` : 'rgba(0,0,0,.38)')),
                                    color: activeIsPlayable ? '#0b0d10' : (canPlayType ? acc : 'rgba(244,245,247,.42)'),
                                    opacity: canPlayType || isActive ? 1 : .72,
                                    boxShadow: canPlayType && !isActive ? `inset 0 0 0 1px ${acc}18` : 'none',
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: 6, height: 6, borderRadius: 999,
                                        background: canPlayType ? acc : 'rgba(244,245,247,.28)',
                                        boxShadow: canPlayType ? `0 0 7px ${acc}` : 'none',
                                    }}
                                />
                                <span>{HAND_ICONS[type]}</span>
                                <span>{HAND_SHORT_NAMES[type]}</span>
                                {count > 1 && (
                                    <span style={{
                                        fontSize: 9, padding: '1px 5px', borderRadius: 999,
                                        background: activeIsPlayable ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.15)',
                                    }}>
                                        {isActive ? `${currentIndex}/${count}` : count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Utility actions pinned to the right of the same row, outside
                    the scroll area, so they are always visible and reachable. */}
                {((activeType && isActiveTypeValid) || (selectedCards && selectedCards.length > 0)) && (
                    <button
                        onClick={handleClear}
                        style={{ ...chipBase, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7' }}
                    >
                        ↺ Reset
                    </button>
                )}
                <button
                    onClick={onSortClick}
                    style={{ ...chipBase, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7' }}
                >
                    {sortLabel}
                </button>
            </div>

            {/* Coach / Pass / Play. The owl is positioned rather than laid out
                so that adding it does not shift Pass and Play off centre — the
                two buttons players aim at with a thumb must not move because a
                setting was turned on. */}
            <div style={{ position: 'relative', width: '100%', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                {coach?.enabled && (
                    <CoachButton
                        onAsk={coach.onAsk}
                        canAsk={coach.canAsk}
                        busy={coach.busy}
                        acc={acc}
                    />
                )}
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
