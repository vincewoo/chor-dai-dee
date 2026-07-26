import { memo } from 'react';
import { PILE_SUIT_COLORS, SUIT_SYMBOLS, FACE_EMOJI } from '../../theme/tableTheme';
import { displaySuit } from '../../utils/suitLens';

// Presentational white card face used in the pile (60x90) and round log (32x46).
// `scale` multiplies every dimension so the desktop pile can show a larger card
// without a second set of metrics.
//
// The second seam where the Pusoy Dos suit lens applies; `suit` is always the
// underlying suit, and only the drawn glyph is remapped.
const PileCardGlyph = memo(function PileCardGlyph({
    rank,
    suit,
    fourColor = false,
    pusoyMode = false,
    size = 'pile', // 'pile' | 'log'
    scale = 1,
    className,
    style,
}) {
    // Symbol and colour both key off the displayed suit, so a card shown as ♦
    // is red rather than keeping the underlying suit's colour.
    const shown = displaySuit(suit, pusoyMode);
    const colors = fourColor ? PILE_SUIT_COLORS.fourColor : PILE_SUIT_COLORS.standard;
    const color = colors[shown] || '#1c2026';
    const sym = SUIT_SYMBOLS[shown] || '';
    const isLog = size === 'log';

    const base = isLog
        ? { width: 32, height: 46, radius: 6, cornerTop: 3, cornerLeft: 4, rankSize: 12, symSize: 9, faceSize: 0, pipSize: 0, faceBottom: 0, faceRight: 0, pipBottom: 0, pipRight: 0 }
        : { width: 60, height: 90, radius: 12, cornerTop: 6, cornerLeft: 7, rankSize: 18, symSize: 12, faceSize: 24, pipSize: 26, faceBottom: 4, faceRight: 6, pipBottom: 6, pipRight: 7 };

    const dims = scale === 1
        ? base
        : Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * scale]));

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
                    <div style={{ position: 'absolute', bottom: dims.faceBottom, right: dims.faceRight, fontSize: dims.faceSize }}>{FACE_EMOJI[rank]}</div>
                ) : (
                    <div style={{ position: 'absolute', bottom: dims.pipBottom, right: dims.pipRight, color, fontSize: dims.pipSize }}>{sym}</div>
                )
            )}
        </div>
    );
});

export default PileCardGlyph;
