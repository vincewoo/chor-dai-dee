import { memo } from 'react';

// Full-bleed themed background for the v2 mobile table:
// surface gradient + tint overlay + two accent glow ellipses + faded suit glyphs.
const TableBackground = memo(function TableBackground({ surface, soft }) {
    return (
        <>
            <div style={{ position: 'absolute', inset: 0, background: surface.base, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: 0, background: surface.tint, pointerEvents: 'none' }} />

            {/* Accent glow ellipses (top + bottom) */}
            <div style={{
                position: 'absolute', top: '-16%', left: '50%', transform: 'translateX(-50%)',
                width: '135%', height: '40%', borderRadius: '50%',
                background: `radial-gradient(ellipse,${soft},transparent 70%)`, pointerEvents: 'none',
            }} />
            <div style={{
                position: 'absolute', bottom: '-14%', left: '50%', transform: 'translateX(-50%)',
                width: '145%', height: '36%', borderRadius: '50%',
                background: `radial-gradient(ellipse,${soft},transparent 72%)`, pointerEvents: 'none',
            }} />

            {/* Decorative giant suit glyphs */}
            <div style={{ position: 'absolute', top: '14%', left: '-12%', fontSize: 190, lineHeight: 1, color: 'rgba(255,255,255,.035)', transform: 'rotate(-14deg)', pointerEvents: 'none', userSelect: 'none' }}>♠</div>
            <div style={{ position: 'absolute', top: '49%', right: '-13%', fontSize: 210, lineHeight: 1, color: 'rgba(255,255,255,.03)', transform: 'rotate(12deg)', pointerEvents: 'none', userSelect: 'none' }}>♥</div>
            <div style={{ position: 'absolute', top: '75%', left: '-8%', fontSize: 150, lineHeight: 1, color: 'rgba(255,255,255,.028)', transform: 'rotate(8deg)', pointerEvents: 'none', userSelect: 'none' }}>♦</div>
        </>
    );
});

export default TableBackground;
