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
        // Tight to the HUD: the run of header → top seat → side seats used to
        // start at 96 and burn ~100px of felt before the pile. The seats sit
        // higher now and the reclaimed space goes to the pile well, where the
        // played cards need it.
        top: { top: 72, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
        left: { top: 142, left: 12, alignItems: 'flex-start' },
        right: { top: 142, right: 12, alignItems: 'flex-end' },
    },
    pile: {
        // Anchored top AND bottom (rather than a fixed height) so the well can
        // never extend under the bottom controls/hand stack on a viewport
        // shorter than the ~844px phone these offsets were tuned on. maxHeight
        // caps the well on tall viewports.
        // minHeight fits stackHeight plus the fan's 20px upward drift, so the
        // cards can never overflow the well (see layoutTiers.test.js). It does
        // not bind in practice — this tier only applies above 760px, where the
        // computed height is 181+ — but the invariant is what keeps a future
        // retune honest.
        frame: { top: 236, left: 26, right: 26, bottom: 344, maxHeight: 248, minHeight: 140, borderRadius: 24 },
        scale: 1,
        stackHeight: 118,
    },
    // The mobile banner renders in normal flow at the top of the bottom stack
    // (GameTableMobile passes placement=null), so it can never collide with
    // the pile the way the old fixed `bottom: 308` offset did.
    banner: null,
    hand: { maxCardWidth: 75, minVisibleRatio: 0.32, maxVisibleRatio: 0.52 },
};

// Compact tier for short viewports (mobile browser chrome visible — see
// SHORT_QUERY in hooks/useMediaQuery). Same composition, everything shifted up
// and the pile drawn slightly smaller so seats, pile, banner and controls all
// fit in ~650px without overlapping.
export const MOBILE_COMPACT_LAYOUT = {
    ...MOBILE_LAYOUT,
    seats: {
        size: 'sm',
        top: { top: 58, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
        left: { top: 114, left: 12, alignItems: 'flex-start' },
        right: { top: 114, right: 12, alignItems: 'flex-end' },
    },
    pile: {
        frame: { top: 194, left: 26, right: 26, bottom: 330, maxHeight: 232, minHeight: 124, borderRadius: 24 },
        scale: 0.9,
        stackHeight: 104,
    },
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
