import { memo } from 'react';
import SuitWatermark from './SuitWatermark';

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

            {/* Decorative giant suit shapes */}
            <SuitWatermark suit="S" size={150} rotate={-14} style={{ top: '14%', left: '-12%' }} />
            <SuitWatermark suit="H" size={165} rotate={12} opacity={0.03} style={{ top: '49%', right: '-13%' }} />
            <SuitWatermark suit="D" size={120} rotate={8} opacity={0.028} style={{ top: '75%', left: '-8%' }} />
        </>
    );
});

export default TableBackground;
