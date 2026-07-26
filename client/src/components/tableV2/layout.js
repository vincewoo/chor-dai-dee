// Placement tokens for the v2 game table, one set per breakpoint.
//
// The v2 table was originally built for a ~390x844 phone with every offset
// written inline. Those literals now live here as MOBILE_LAYOUT and are still
// the defaults inside each component, so the mobile table renders exactly as
// before. DESKTOP_LAYOUT is the wide-viewport composition, consumed by
// GameTableDesktop.
//
// Coordinates are relative to each orchestrator's own positioning context:
// on mobile that is the full-bleed table root, on desktop it is the centre
// column of the grid (the "table area"), which excludes the HUD and the
// bottom controls/hand section.

export const MOBILE_LAYOUT = {
    seats: {
        size: 'sm',
        top: { top: 96, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
        left: { top: 178, left: 12, alignItems: 'flex-start' },
        right: { top: 178, right: 12, alignItems: 'flex-end' },
    },
    pile: {
        frame: { top: 268, left: 26, right: 26, height: 216, borderRadius: 24 },
        scale: 1,
        stackHeight: 118,
    },
    // The mobile banner floats above the hand, which is itself pinned to the
    // bottom of the viewport, so it needs an explicit offset.
    banner: { bottom: 308, left: 0, right: 0 },
    hand: { maxCardWidth: 75, minVisibleRatio: 0.32, maxVisibleRatio: 0.52 },
};

export const DESKTOP_LAYOUT = {
    seats: {
        size: 'lg',
        top: { top: 8, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
        left: { top: '50%', left: 8, transform: 'translateY(-50%)', alignItems: 'flex-start' },
        right: { top: '50%', right: 8, transform: 'translateY(-50%)', alignItems: 'flex-end' },
    },
    pile: {
        frame: {
            top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            // The subtractions reserve the gutters the side and top seats sit
            // in, so the well never grows under a seat badge.
            width: 'min(620px,calc(100% - 320px))',
            height: 'min(330px,calc(100% - 150px))',
            borderRadius: 28,
        },
        scale: 1.3,
        stackHeight: 168,
    },
    // On desktop the banner sits in normal flow above the controls, so it needs
    // no offset at all.
    banner: null,
    // A wide screen has room to fan the hand out, so cards may show much
    // more of themselves than the phone's tight 52%.
    hand: { maxCardWidth: 108, minVisibleRatio: 0.34, maxVisibleRatio: 0.78 },
};

// Width of the two persistent desktop rails. Below WIDE_QUERY they are not
// rendered and the table falls back to the Info toggle + round-log sheet.
export const SCORE_RAIL_WIDTH = 244;
export const LOG_RAIL_WIDTH = 304;
