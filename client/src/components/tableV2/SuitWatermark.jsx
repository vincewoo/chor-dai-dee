import { memo } from 'react';

// Decorative oversized suit shapes for the v2 screen backgrounds.
//
// These used to be text glyphs (♠ ♥ ♦ ♣) tinted with `color`. iOS picks the
// Apple Color Emoji face for all four code points, and a colour font ignores
// `color` — so on iPhone the "faded watermarks" rendered as full-opacity black
// and red emoji sitting on top of the page. Drawing them as SVG paths keeps the
// fill under our control on every platform, and lets the shapes bleed off-canvas
// at an exact size instead of depending on a font's glyph metrics.
const SUIT_SHAPES = {
    S: <path d="M50 6C50 6 12 34 12 56c0 13 10 21 21 21 6 0 12-3 15-7-1 12-4 19-9 24h22c-5-5-8-12-9-24 3 4 9 7 15 7 11 0 21-8 21-21C88 34 50 6 50 6Z" />,
    H: <path d="M50 92S8 63 8 35C8 19 20 8 33 8c8 0 14 4 17 10 3-6 9-10 17-10 13 0 25 11 25 27 0 28-42 57-42 57Z" />,
    D: <path d="M50 4 90 50 50 96 10 50Z" />,
    C: (
        <>
            <circle cx="50" cy="28" r="19" />
            <circle cx="26" cy="59" r="19" />
            <circle cx="74" cy="59" r="19" />
            <path d="M44 58h12c0 18 3 28 10 34H34c7-6 10-16 10-34Z" />
        </>
    ),
};

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
