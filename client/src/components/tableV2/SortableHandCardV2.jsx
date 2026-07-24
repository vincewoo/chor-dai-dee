import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo } from 'react';
import { PILE_SUIT_COLORS, SUIT_SYMBOLS, FACE_EMOJI } from '../../theme/tableTheme';

// v2 hand card: overlapping white face with accent selection raise + deuce dot.
// Keeps the useSortable id scheme (`rank-suit`) and the data-card-id attribute
// so GameRoom's swipe-select and dnd reorder handlers continue to work.
const SortableHandCardV2 = ({
    card, isSelected, onToggle, index, marginLeft, width, height, acc, fourColor,
}) => {
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({
        id: `${card.rank}-${card.suit}`,
        transition: { duration: 150, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    });

    const colors = fourColor ? PILE_SUIT_COLORS.fourColor : PILE_SUIT_COLORS.standard;
    const color = colors[card.suit] || '#1c2026';
    const sym = SUIT_SYMBOLS[card.suit] || '';

    const wrapperStyle = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : (transition || 'margin-left .2s cubic-bezier(.4,0,.2,1)'),
        zIndex: isDragging ? 50 : 'auto',
        marginLeft: index === 0 ? 0 : marginLeft,
        touchAction: 'none',
        opacity: isDragging ? 0.5 : 1,
        flexShrink: 0,
    };

    return (
        <div
            ref={setNodeRef}
            style={wrapperStyle}
            data-card-id={`${card.rank}-${card.suit}`}
            {...attributes}
            {...listeners}
        >
            <div
                onClick={() => onToggle(card)}
                style={{
                    boxSizing: 'border-box', width, height,
                    background: 'linear-gradient(168deg,#ffffff 55%,#eef0ee)',
                    borderRadius: 12,
                    border: `2px solid ${isSelected ? acc : 'rgba(28,32,38,.08)'}`,
                    boxShadow: isSelected
                        ? `0 0 0 3px ${acc}59, 0 14px 20px rgba(0,0,0,.5)`
                        : '0 5px 10px rgba(0,0,0,.35)',
                    transform: `translateY(${isSelected ? -16 : 0}px)`,
                    transition: 'transform .18s cubic-bezier(.2,.8,.3,1.3),box-shadow .18s',
                    position: 'relative', overflow: 'hidden', cursor: 'pointer', userSelect: 'none',
                }}
            >
                <div style={{ position: 'absolute', top: 7, left: 8, lineHeight: 0.92, color }}>
                    <div style={{ fontWeight: 800, fontSize: 23 }}>{card.rank}</div>
                    <div style={{ fontSize: 15 }}>{sym}</div>
                </div>
                {FACE_EMOJI[card.rank] ? (
                    <div style={{ position: 'absolute', left: '50%', top: '60%', transform: 'translate(-50%,-50%)', fontSize: 38 }}>{FACE_EMOJI[card.rank]}</div>
                ) : (
                    <div style={{ position: 'absolute', left: '50%', top: '60%', transform: 'translate(-50%,-50%)', fontSize: 40, color }}>{sym}</div>
                )}
            </div>
        </div>
    );
};

export default memo(SortableHandCardV2);
