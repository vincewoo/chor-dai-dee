import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FAN_CARD_W, FAN_CARD_H, TOP_STEP, TOP_FAN_H, SIDE_FAN_W,
    SIDE_STEP_MAX, SIDE_STEP_MIN,
    fanLayout, fanSize, sideFanStep,
} from '../src/components/tableV2/fanGeometry.js';
import {
    DESKTOP_LAYOUT, DESKTOP_UPPER_RESERVE, HAND_CARD_MAX,
    desktopHandCardWidth, desktopPileMetrics,
} from '../src/components/tableV2/layout.js';

// The desktop table draws each opponent's hand as one card per card held. That
// makes the fan's size a function of the game state, not a constant — a seat
// holding 13 cards is 280px of table that a seat holding 3 was not — so the
// geometry has to be checked against the space it is given rather than eyeballed
// at one viewport. These are the constraints that keep a fan off the pile, off
// the scoreboard and out of the bottom stack.

const FULL_HAND = 13;

test('a fan draws exactly one card per card held', () => {
    for (const position of ['top', 'left', 'right']) {
        for (const n of [0, 1, 3, 7, FULL_HAND]) {
            assert.equal(fanLayout(position, n).length, n, `${position} with ${n}`);
        }
    }
});

test('a one-card fan is a single upright card, not a degenerate spread', () => {
    const [only] = fanLayout('top', 1);
    // `half` guards against dividing by zero; without it t is NaN and both the
    // bow and the tilt come out NaN.
    assert.equal(only.top, 0);
    assert.equal(only.rotate, 0);
    assert.equal(only.left, 0);
});

test('side fans expose the index edge from both sides', () => {
    // The left seat stacks front-to-back and the right seat back-to-front, so
    // the uncovered strip is the one carrying the rank either way. Reversing
    // one of them is what makes a spectator's side hand readable.
    const left = fanLayout('left', 5).map(c => c.zIndex);
    const right = fanLayout('right', 5).map(c => c.zIndex);
    assert.deepEqual(left, [1, 2, 3, 4, 5]);
    assert.deepEqual(right, [5, 4, 3, 2, 1]);
});

test('side cards are rotated a quarter turn, top cards are not', () => {
    for (const c of fanLayout('left', 5)) assert.ok(Math.abs(c.rotate - 90) <= 7);
    for (const c of fanLayout('right', 5)) assert.ok(Math.abs(c.rotate + 90) <= 7);
    for (const c of fanLayout('top', 5)) assert.ok(Math.abs(c.rotate) <= 7);
});

test('a side fan reserves the rotated card height, not its width', () => {
    // A rotated card's vertical extent is the card's *width*. Reserving its
    // height instead cost 26px of a band that had none to give.
    const { height } = fanSize('left', FULL_HAND, SIDE_STEP_MAX);
    assert.equal(height, FAN_CARD_W + (FULL_HAND - 1) * SIDE_STEP_MAX);
    assert.equal(fanSize('left', FULL_HAND).width, SIDE_FAN_W);
});

test('the top fan reserves its own width', () => {
    assert.equal(
        fanSize('top', FULL_HAND).width,
        FAN_CARD_W + (FULL_HAND - 1) * TOP_STEP
    );
    assert.equal(fanSize('top', FULL_HAND).height, TOP_FAN_H);
});

test('every card stays inside the box its fan reserves', () => {
    for (const position of ['top', 'left', 'right']) {
        const step = position === 'top' ? undefined : SIDE_STEP_MAX;
        const box = fanSize(position, FULL_HAND, step);
        for (const c of fanLayout(position, FULL_HAND, step)) {
            // Side cards are rotated about their centre, so compare centres
            // against the extent the rotated card actually occupies.
            const cx = c.left + FAN_CARD_W / 2;
            const cy = c.top + FAN_CARD_H / 2;
            const halfW = position === 'top' ? FAN_CARD_W / 2 : FAN_CARD_H / 2;
            const halfH = position === 'top' ? FAN_CARD_H / 2 : FAN_CARD_W / 2;
            assert.ok(cx - halfW >= -0.5, `${position}: left edge ${cx - halfW}`);
            assert.ok(cx + halfW <= box.width + 0.5, `${position}: right edge ${cx + halfW} > ${box.width}`);
            assert.ok(cy - halfH >= -0.5, `${position}: top edge ${cy - halfH}`);
            assert.ok(cy + halfH <= box.height + 0.5, `${position}: bottom edge ${cy + halfH} > ${box.height}`);
        }
    }
});

// The step is the one thing that adapts to the viewport. Everything else about
// the fan is fixed, so if the step is wrong the fan is the element that lands on
// the pile.

test('a side fan never spreads wider than its design step', () => {
    for (const band of [0, 200, 400, 4000]) {
        assert.ok(sideFanStep(FULL_HAND, band) <= SIDE_STEP_MAX, `band ${band}`);
    }
});

test('a full hand fits the band it is given', () => {
    for (const band of [260, 300, 380, 520]) {
        const step = sideFanStep(FULL_HAND, band);
        const { height } = fanSize('left', FULL_HAND, step);
        assert.ok(height <= band + 0.5, `13 cards are ${height}px in a ${band}px band`);
    }
});

test('the step compresses rather than the fan overflowing', () => {
    const roomy = sideFanStep(FULL_HAND, 520);
    // 200px is genuinely tight: 13 cards at the design step need 280.
    const tight = sideFanStep(FULL_HAND, 200);
    assert.equal(roomy, SIDE_STEP_MAX);
    assert.ok(tight < roomy, 'a tighter band gives a tighter fan');
    assert.ok(tight >= SIDE_STEP_MIN, 'never past the point where the count stops being legible');
});

test('an unmeasured band draws the design fan, not a collapsed one', () => {
    // The band is 0 on the first render, before the ResizeObserver reports.
    // Compressing to the minimum there would show a full hand as a solid block
    // for a frame every time the table mounts.
    assert.equal(sideFanStep(FULL_HAND, 0), SIDE_STEP_MAX);
});

// Where the fans sit, relative to everything else on the table.

test('the upper reserve clears the top seat', () => {
    // Fan, then the gap from DESKTOP_LAYOUT.seats.top, then the nameplate.
    const NAMEPLATE_H = 46; // 34px avatar tile + 6px padding either side
    const topSeatHeight = TOP_FAN_H + DESKTOP_LAYOUT.seats.top.gap + NAMEPLATE_H;
    assert.ok(
        DESKTOP_UPPER_RESERVE >= topSeatHeight,
        `reserve ${DESKTOP_UPPER_RESERVE} must clear the top seat (${topSeatHeight})`
    );
});

test('the upper reserve clears the collapsed corner scoreboard', () => {
    // The scoreboard hangs from the HUD into the same band. Only its collapsed
    // height is reserved — that is the state it is in whenever nobody is
    // pointing at it. Expanded it is ~210px and may overlay the top of a full
    // fan, which is why it turns near-opaque there (see ScoreCorner); buying
    // that clearance in layout would cost every viewport ~50px of pile band.
    const COLLAPSED_BOARD_H = 151; // measured on the running table
    const HUD_HEIGHT = 72; // GameTableDesktop's paddingTop, where the band's 0 is
    const boardBottom = DESKTOP_LAYOUT.scoreboard.top + COLLAPSED_BOARD_H - HUD_HEIGHT;
    assert.ok(
        DESKTOP_UPPER_RESERVE >= boardBottom,
        `reserve ${DESKTOP_UPPER_RESERVE} must clear the scoreboard (${boardBottom})`
    );
});

test('the side seats are level with each other', () => {
    const { left, right } = DESKTOP_LAYOUT.seats;
    assert.equal(left.top, right.top);
    assert.equal(left.transform, right.transform);
});

test('the side seats put their nameplate beside the fan', () => {
    // Stacking the plate under a 280px fan costs another ~58px of a band that
    // does not have it, which is what pushed the fans onto the pile.
    const { left, right } = DESKTOP_LAYOUT.seats;
    assert.equal(left.flexDirection, 'row');
    assert.equal(right.flexDirection, 'row-reverse');
    assert.equal(DESKTOP_LAYOUT.seats.top.flexDirection, 'column');
});

test('the pile reserves the gutters both side seats sit in', () => {
    // A side seat is its fan, the flex gap, its nameplate and the edge inset.
    const NAMEPLATE_W = 150; // avatar + a typical name, padding included
    const seat = SIDE_FAN_W + DESKTOP_LAYOUT.seats.left.gap + NAMEPLATE_W + DESKTOP_LAYOUT.seats.left.left;
    const reserved = Number(DESKTOP_LAYOUT.pile.frame.width.match(/calc\(100% - (\d+)px\)/)[1]);
    assert.ok(
        reserved >= 2 * seat,
        `pile reserves ${reserved}px for two ${seat}px seats`
    );
});

test('the pile well fits the card stack it holds', () => {
    const capped = Number(DESKTOP_LAYOUT.pile.frame.height.match(/min\((\d+)px/)[1]);
    // CenterPile's OFF offsets drift older plays up to 20px upward.
    const required = DESKTOP_LAYOUT.pile.stackHeight + Math.round(20 * DESKTOP_LAYOUT.pile.scale);
    assert.ok(capped >= required, `well ${capped} must fit stack + drift (${required})`);
});

test('the fan card matches the pile card it is drawn from', () => {
    // The fan renders PileCardGlyph's 'pile' face (60x90) at FAN_SCALE; the
    // geometry hard-codes the result, so the two must agree.
    assert.equal(FAN_CARD_W, Math.round(60 * 0.867));
    assert.equal(FAN_CARD_H, Math.round(90 * 0.867));
});

// The vertical budget. The hand and the pile compete for the same pixels, and
// on a viewport shorter than the 900px this was drawn for one of them has to
// give. These pin *which*, and that neither ends up bigger than its container.

// Content height of the table column: viewport less the HUD and bottom padding.
const columnFor = (viewportHeight) => viewportHeight - 72 - 14;
// What the band works out to once the hand has taken its share. Mirrors the
// flex layout: table area = column - bottom stack, band = table area - reserve.
const BOTTOM_CHROME = 174;
const bandFor = (viewportHeight) => {
    const column = columnFor(viewportHeight);
    const handBox = Math.round(desktopHandCardWidth(column) * 1.533) + 8;
    return column - (BOTTOM_CHROME + handBox) - DESKTOP_UPPER_RESERVE;
};

test('a 900px viewport gets the table at its design size', () => {
    // The size everything was drawn at — nothing should be scaling down here.
    assert.equal(desktopHandCardWidth(columnFor(900)), HAND_CARD_MAX);
    const pile = desktopPileMetrics(bandFor(900));
    assert.equal(pile.scale, DESKTOP_LAYOUT.pile.scale);
    assert.equal(pile.stackHeight, DESKTOP_LAYOUT.pile.stackHeight);
});

test('an unmeasured column draws the design size, not the floor', () => {
    // Both are 0 on the first render, before the ResizeObserver reports.
    assert.equal(desktopHandCardWidth(0), HAND_CARD_MAX);
    assert.equal(desktopPileMetrics(0).scale, DESKTOP_LAYOUT.pile.scale);
});

test('the hand never grows past its design card', () => {
    for (const h of [900, 1080, 1440, 2160]) {
        assert.ok(desktopHandCardWidth(columnFor(h)) <= HAND_CARD_MAX, `${h}px viewport`);
    }
});

test('the hand yields height before the pile does', () => {
    // At 800px the hand has started shrinking but the pile is still full size:
    // a smaller card is still a card, a pile you cannot read is not a pile.
    const column = columnFor(800);
    assert.ok(desktopHandCardWidth(column) < HAND_CARD_MAX, 'hand shrank');
    assert.equal(desktopPileMetrics(bandFor(800)).scale, DESKTOP_LAYOUT.pile.scale);
});

test('the stack always fits the well holding it', () => {
    // The regression this exists for: at 1280x720 a 200px stack was drawn in a
    // 99px well, so the pile overflowed onto the top seat's nameplate.
    const PILE_LABEL_H = 44;
    for (const viewport of [1080, 900, 800, 768, 720, 680, 640]) {
        const band = bandFor(viewport);
        const { stackHeight } = desktopPileMetrics(band);
        const well = Math.min(310, band - 20);
        assert.ok(
            stackHeight <= well - PILE_LABEL_H || well - PILE_LABEL_H <= 0,
            `${viewport}px viewport: stack ${stackHeight} in a ${well}px well`
        );
    }
});

test('a shorter viewport is never given a bigger table', () => {
    let prevHand = Infinity;
    let prevPile = Infinity;
    for (const viewport of [1080, 960, 900, 840, 800, 768, 720]) {
        const hand = desktopHandCardWidth(columnFor(viewport));
        const pile = desktopPileMetrics(bandFor(viewport)).scale;
        assert.ok(hand <= prevHand, `hand grew at ${viewport}px`);
        assert.ok(pile <= prevPile, `pile grew at ${viewport}px`);
        prevHand = hand;
        prevPile = pile;
    }
});

test('the hand stays large enough to read at the shortest viewport', () => {
    // The floor is roughly the phone's card, which is known to be playable.
    assert.ok(desktopHandCardWidth(columnFor(640)) >= 60);
});
