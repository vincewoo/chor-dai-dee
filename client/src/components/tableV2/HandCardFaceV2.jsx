import { memo } from 'react';
import { PILE_SUIT_COLORS, SUIT_SYMBOLS, FACE_EMOJI } from '../../theme/tableTheme';
import { displaySuit } from '../../utils/suitLens';

// The visual face of a v2 hand card, with no interaction or dnd concerns.
// Shared by SortableHandCardV2 (player, interactive) and SpectatorHandV2
// (read-only) so there is exactly one card-face implementation.
//
// One of the two seams where the Pusoy Dos suit lens applies. `card.suit` stays
// the underlying suit everywhere else — only the drawn glyph is remapped.
const HandCardFaceV2 = ({ card, isSelected, width, height, acc, fourColor, pusoyMode = false, onClick, readOnly = false, typeScale = 1 }) => {
    // Symbol and colour both key off the displayed suit, so a card shown as ♦
    // is red rather than keeping the underlying suit's colour.
    const shown = displaySuit(card.suit, pusoyMode);
    const colors = fourColor ? PILE_SUIT_COLORS.fourColor : PILE_SUIT_COLORS.standard;
    const color = colors[shown] || '#1c2026';
    const sym = SUIT_SYMBOLS[shown] || '';
    const t = (px) => Math.round(px * typeScale);

    return (
        <div
            onClick={readOnly ? undefined : onClick}
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
                position: 'relative', overflow: 'hidden',
                cursor: readOnly ? 'default' : 'pointer',
                userSelect: 'none',
            }}
        >
            <div style={{ position: 'absolute', top: t(7), left: t(8), lineHeight: 0.92, color }}>
                <div style={{ fontWeight: 800, fontSize: t(23) }}>{card.rank}</div>
                <div style={{ fontSize: t(15) }}>{sym}</div>
            </div>
            {FACE_EMOJI[card.rank] ? (
                <div style={{ position: 'absolute', left: '50%', top: '60%', transform: 'translate(-50%,-50%)', fontSize: t(38) }}>{FACE_EMOJI[card.rank]}</div>
            ) : (
                <div style={{ position: 'absolute', left: '50%', top: '60%', transform: 'translate(-50%,-50%)', fontSize: t(40), color }}>{sym}</div>
            )}
        </div>
    );
};

export default memo(HandCardFaceV2);
