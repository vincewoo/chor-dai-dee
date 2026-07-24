import { memo } from 'react';
import { PILE_SUIT_COLORS, SUIT_SYMBOLS, FACE_EMOJI } from '../../theme/tableTheme';

// Presentational white card face used in the pile (60x90) and round log (32x46).
// Deliberately independent of Card.jsx (different visual language) so the
// desktop card renderer stays untouched.
const PileCardGlyph = memo(function PileCardGlyph({
    rank,
    suit,
    fourColor = false,
    size = 'pile', // 'pile' | 'log'
    className,
    style,
}) {
    const colors = fourColor ? PILE_SUIT_COLORS.fourColor : PILE_SUIT_COLORS.standard;
    const color = colors[suit] || '#1c2026';
    const sym = SUIT_SYMBOLS[suit] || '';
    const isLog = size === 'log';

    const dims = isLog
        ? { width: 32, height: 46, radius: 6, cornerTop: 3, cornerLeft: 4, rankSize: 12, symSize: 9 }
        : { width: 60, height: 90, radius: 12, cornerTop: 6, cornerLeft: 7, rankSize: 18, symSize: 12 };

    return (
        <div
            className={className}
            style={{
                boxSizing: 'border-box',
                width: dims.width,
                height: dims.height,
                background: '#ffffff',
                borderRadius: dims.radius,
                boxShadow: isLog ? '0 3px 7px rgba(0,0,0,.4)' : '0 8px 18px rgba(0,0,0,.45)',
                position: 'relative',
                overflow: 'hidden',
                ...style,
            }}
        >
            <div style={{ position: 'absolute', top: dims.cornerTop, left: dims.cornerLeft, lineHeight: 0.95, color }}>
                <div style={{ fontWeight: 800, fontSize: dims.rankSize }}>{rank}</div>
                <div style={{ fontSize: dims.symSize }}>{sym}</div>
            </div>
            {!isLog && (
                FACE_EMOJI[rank] ? (
                    <div style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 24 }}>{FACE_EMOJI[rank]}</div>
                ) : (
                    <div style={{ position: 'absolute', bottom: 6, right: 7, color, fontSize: 26 }}>{sym}</div>
                )
            )}
        </div>
    );
});

export default PileCardGlyph;
