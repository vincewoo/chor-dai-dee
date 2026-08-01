// Geometry for an opponent's hand drawn as a fan of real cards.
//
// On desktop an opponent's remaining cards are drawn one-for-one instead of
// being summarised as a number, so "how close is Bao to going out" is answered
// by the size of the fan rather than by reading a digit. Everything here is a
// pure function of the card count and the space available, so the constraints
// below can be tested without a DOM (see test/desktopFan.test.js).
//
// The card is PileCardGlyph's 'pile' face (60x90) at FAN_SCALE, so the fan, the
// pile and the round log all draw the same card.

export const FAN_SCALE = 0.867;
export const FAN_CARD_W = 52; // 60 * FAN_SCALE, rounded
export const FAN_CARD_H = 78; // 90 * FAN_SCALE, rounded

// Horizontal overlap of the top seat's fan. 17 of 52px leaves each card's
// index corner exposed.
export const TOP_STEP = 17;

// The side seats sit wider apart than the top fan. Rotated 90deg the only part
// of each card left uncovered is the strip holding its rank and suit, and 17px
// of a 52px card clips the two-glyph ranks ("10").
export const SIDE_STEP_MAX = 19;

// Where a 13-card fan will not fit the band it is given, the step compresses
// rather than the fan overflowing onto the pile. Below this the cards read as a
// solid block and the count stops being legible, so the fan is allowed to
// exceed its band instead — a fan that lies about the count is worse than one
// that is slightly too tall.
export const SIDE_STEP_MIN = 8;

// Depth of the fan's bow, and the tilt of its outermost card.
const BOW = 12;
const TILT = 7;

// The rotated card's horizontal extent (FAN_CARD_H) plus the bow.
export const SIDE_FAN_W = FAN_CARD_H + BOW;

// Rendered height of the top seat: fan (card + bow) + gap + nameplate. It is
// what DESKTOP_LAYOUT.upperReserve has to clear.
export const TOP_FAN_H = FAN_CARD_H + BOW + 2;

/**
 * Overlap step for a side seat's fan, given the vertical band it must fit in.
 * Returns SIDE_STEP_MAX until the band runs out, then compresses.
 */
export function sideFanStep(count, bandHeight) {
    if (count <= 1 || !bandHeight) return SIDE_STEP_MAX;
    const fit = (bandHeight - FAN_CARD_W) / (count - 1);
    return Math.max(SIDE_STEP_MIN, Math.min(SIDE_STEP_MAX, fit));
}

/** Bounding box the fan occupies, so the seat's flex row can reserve it. */
export function fanSize(position, count, step = SIDE_STEP_MAX) {
    if (count <= 0) return { width: 0, height: 0 };
    if (position === 'top') {
        return { width: FAN_CARD_W + (count - 1) * TOP_STEP, height: TOP_FAN_H };
    }
    return { width: SIDE_FAN_W, height: FAN_CARD_W + (count - 1) * step };
}

/**
 * Placement of every card in the fan, oldest-to-newest as held.
 *
 * Cards are positioned from their centre and then rotated, which is why the
 * side seats subtract half the *unrotated* card: rotation preserves the centre,
 * so the box only has to put the centre in the right place.
 */
export function fanLayout(position, count, step = SIDE_STEP_MAX) {
    // A single card has no spread to normalise against; `|| 1` keeps t at 0.
    const half = (count - 1) / 2 || 1;

    return Array.from({ length: count }, (_, i) => {
        const t = (i - (count - 1) / 2) / half;

        if (position === 'top') {
            return {
                left: i * TOP_STEP,
                top: BOW * t * t,
                zIndex: i + 1,
                rotate: TILT * t,
            };
        }

        const isLeft = position === 'left';
        const cy = FAN_CARD_W / 2 + i * step;
        // The bow pushes the outer cards toward the table's edge. Centres are
        // measured so the *rotated* card — whose horizontal extent is
        // FAN_CARD_H — stays inside SIDE_FAN_W at both ends of the bow; placing
        // them by the unrotated box instead let the outermost cards bleed 5px
        // past the width the seat's flex row had reserved for them.
        const cx = isLeft
            ? SIDE_FAN_W - FAN_CARD_H / 2 - BOW * t * t
            : FAN_CARD_H / 2 + BOW * t * t;

        return {
            left: cx - FAN_CARD_W / 2,
            top: cy - FAN_CARD_H / 2,
            // Both sides expose the card's index edge — the one carrying the
            // rank — so a spectator can read a side hand. That means the left
            // seat stacks front-to-back and the right seat back-to-front.
            zIndex: isLeft ? i + 1 : count - i,
            rotate: (isLeft ? 90 : -90) + TILT * t,
        };
    });
}
