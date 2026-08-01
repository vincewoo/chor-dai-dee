// Placement tokens for the v2 game table, one set per breakpoint.
//
// The v2 table was originally built for a ~390x844 phone with every offset
// written inline. Those literals now live here as MOBILE_LAYOUT and are still
// the defaults inside each component, so the mobile table renders exactly as
// before. DESKTOP_LAYOUT is the wide-viewport composition, consumed by
// GameTableDesktop.
//
// Coordinates are relative to each orchestrator's own positioning context:
// on mobile that is the full-bleed table root, on desktop it is the "table
// area", which excludes the HUD and the bottom controls/hand section.

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

// Vertical space at the top of the desktop table area that the pile and the
// side seats stay clear of. Two things live in it: the top seat's fan and
// nameplate (TOP_FAN_H + gap + plate, see fanGeometry.js), and the corner
// scoreboard, which hangs down from the HUD into the same band.
//
// Rather than each element carrying its own offset from the viewport edge,
// everything below the band is centred in what is left — so the composition
// holds at any viewport height, not only at the 900px it was drawn at.
export const DESKTOP_UPPER_RESERVE = 150;

// --- The desktop table's vertical budget -----------------------------------
//
// The hand and the pile compete for the same pixels. At the 900px-tall viewport
// this table was drawn for there is room for both at full size; below that
// something has to give, and the two functions below decide what, so a short
// viewport gets a smaller table rather than a broken one. Before they existed,
// a 1280x720 window put a 200px card stack in a 99px well and the pile landed
// on top of the top seat's nameplate.
//
// The hand yields first: a smaller card is still a card, whereas a pile you
// cannot read is not a pile. Both are pure functions of a measured height, so
// the arithmetic is checked in test/desktopFan.test.js rather than by eye.

// Fixed chrome above the hand inside the bottom stack: its padding, the status
// banner, the controls row and the gaps between them. Measured on the running
// table; a lower bound would under-reserve, so this is the real number.
const BOTTOM_CHROME = 174;
// The band the pile wants before the hand starts giving up height for it.
const BAND_TARGET = 290;
// The hand's box: card height plus MobileHandV2's 8px of slack.
const HAND_BOX_MAX = 192;
const HAND_BOX_MIN = 104;
const HAND_CARD_RATIO = 1.533; // useHandGeometry's card aspect
export const HAND_CARD_MAX = 120;

// Pile at full size, and the headroom the in-well label needs above the stack.
const PILE_SCALE_MAX = 1.5;
const PILE_STACK_MAX = 200;
const PILE_WELL_MAX = 310;
const PILE_LABEL_H = 44;
// A floor, only so a degenerate viewport can't scale the pile to nothing.
const PILE_K_MIN = 0.2;

const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Largest hand card the column's height can afford, given that the pile band
 * below the upper reserve wants BAND_TARGET first.
 *
 * `columnHeight` is the content height of the table column — the viewport less
 * the HUD and the bottom padding. It is 0 before the first measurement, which
 * draws the design size rather than the floor.
 */
export function desktopHandCardWidth(columnHeight) {
    if (!columnHeight) return HAND_CARD_MAX;
    const budget = columnHeight - BOTTOM_CHROME - DESKTOP_UPPER_RESERVE;
    const box = clamp(HAND_BOX_MIN, budget - BAND_TARGET, HAND_BOX_MAX);
    return Math.round((box - 8) / HAND_CARD_RATIO);
}

/**
 * Card scale and stack height for the pile, given the band it sits in. The well
 * itself is CSS (`min(310px, 100% - 20px)`); this scales its contents to match,
 * so the stack can never be taller than the well holding it.
 */
export function desktopPileMetrics(bandHeight) {
    if (!bandHeight) return { scale: PILE_SCALE_MAX, stackHeight: PILE_STACK_MAX };
    const well = Math.min(PILE_WELL_MAX, bandHeight - 20);
    const k = clamp(PILE_K_MIN, (well - PILE_LABEL_H) / PILE_STACK_MAX, 1);
    return {
        scale: Number((PILE_SCALE_MAX * k).toFixed(3)),
        stackHeight: Math.round(PILE_STACK_MAX * k),
    };
}

export const DESKTOP_LAYOUT = {
    // The top seat is placed in the table area; the side seats are placed in
    // the band below DESKTOP_UPPER_RESERVE. Their nameplates sit *beside* the
    // fan rather than under it: a rotated 13-card fan is already 280px tall,
    // and stacking the plate below would cost another ~58px the band does not
    // have.
    seats: {
        top: { top: 0, left: '50%', transform: 'translateX(-50%)', flexDirection: 'column', gap: 10, alignItems: 'center' },
        left: { top: '50%', left: 8, transform: 'translateY(-50%)', flexDirection: 'row', gap: 12, alignItems: 'center' },
        right: { top: '50%', right: 8, transform: 'translateY(-50%)', flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
    },
    upperReserve: DESKTOP_UPPER_RESERVE,
    pile: {
        frame: {
            top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            // The subtraction reserves the gutters the side seats sit in (fan
            // plus nameplate, both sides), so the well never grows under one.
            width: 'min(820px,calc(100% - 560px))',
            height: 'min(310px,calc(100% - 20px))',
            borderRadius: 30,
        },
        scale: 1.5,
        stackHeight: 200,
    },
    // On desktop the banner sits in normal flow above the controls, so it needs
    // no offset at all.
    banner: null,
    // A wide screen has room to fan the hand out, so cards may show much
    // more of themselves than the phone's tight 52%. `maxCardWidth` is the
    // ceiling; desktopHandCardWidth lowers it on a short viewport.
    hand: { maxCardWidth: HAND_CARD_MAX, minVisibleRatio: 0.34, maxVisibleRatio: 0.78 },
    // How wide the quick-select chips and the Reset/Sort actions may spread.
    // Deliberately much narrower than the hand they act on: a full 13-card fan
    // is ~1250px here, and a row stretched to match put the chips under the
    // left seat and Sort under the right. These are clicked constantly and
    // between clicks the pointer wants to be on the cards, so the row is capped
    // just inside the pile above it — one centred column of controls rather
    // than a shelf spanning the table.
    controls: { maxWidth: 760 },
    // The corner scoreboard. It sits on the left, under the room block, so the
    // right corner is left to the voice/spectator/settings cluster alone —
    // stacking the scores there too made that side of the table read as the
    // busy one. `top` is what drops it clear of whichever HUD block is above
    // it, which is why the scoreboard is its own layer rather than part of the
    // HUD row.
    scoreboard: { side: 'left', top: 62, inset: 18 },
};
