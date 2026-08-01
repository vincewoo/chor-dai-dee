import { memo } from 'react';
import { SUIT_SHAPES } from './suitShapes';

// Decorative oversized suit shapes for the v2 screen backgrounds.
//
// These used to be text glyphs (♠ ♥ ♦ ♣) tinted with `color`. iOS picks the
// Apple Color Emoji face for all four code points, and a colour font ignores
// `color` — so on iPhone the "faded watermarks" rendered as full-opacity black
// and red emoji sitting on top of the page. Drawing them as SVG paths keeps the
// fill under our control on every platform, and lets the shapes bleed off-canvas
// at an exact size instead of depending on a font's glyph metrics.

// `size` is the box the shape fills; the old glyphs were sized by font-size and
// only filled part of their em box, so equivalent watermarks want a slightly
// smaller `size` than the font-size they replaced.
const SuitWatermark = memo(function SuitWatermark({ suit, size, opacity = 0.035, rotate = 0, style }) {
    return (
        <svg
            viewBox="0 0 100 100"
            width={size}
            height={size}
            aria-hidden="true"
            focusable="false"
            className="absolute pointer-events-none select-none"
            style={{ fill: `rgba(255,255,255,${opacity})`, transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}
        >
            {SUIT_SHAPES[suit]}
        </svg>
    );
});

export default SuitWatermark;
