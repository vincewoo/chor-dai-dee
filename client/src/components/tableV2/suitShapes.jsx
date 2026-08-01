// The four suit shapes as SVG paths, shared by every v2 surface that draws a
// suit as artwork rather than as type: the background watermarks and the card
// back's diamond.
//
// They are paths and never text glyphs. iOS resolves ♠ ♥ ♦ ♣ to Apple Color
// Emoji, and a colour font ignores `fill`/`color` — as text these render on
// iPhone as full-opacity black and red emoji on top of the page.
export const SUIT_SHAPES = {
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
