import SuitWatermark from './SuitWatermark';

// The shell every scrolling v2 screen sits in: a root that carries the felt
// backdrop and never scrolls, plus the scroller as a child of it.
//
// Keeping those two boxes separate is the entire point of this component.
// A backdrop painted onto the element that scrolls is sized to the scroll
// *port* — one viewport — while the content inside it is `min-h-full` and free
// to be taller. Past one viewport the vignette tint (`inset-0`, so also one
// viewport tall) simply stops, and the base gradient starts tiling a second
// copy of itself, because `background-repeat` defaults to `repeat` and a
// gradient is an image like any other. Both land on the same line, drawing a
// hard horizontal seam across every screen long enough to scroll. A backdrop on
// a box that never scrolls is always exactly the screen, whatever the content
// does.
//
// `overflow-hidden` on that root is the other half of the job: the glow and the
// suit watermarks bleed past the left and right edges on purpose, and on a
// scroller that bleed is horizontally scrollable rather than clipped. Screens
// used to have to remember `overflow-x-hidden` for themselves, and the waiting
// room was the one that didn't.
//
// Deliberately not solved with `position: fixed` or `background-attachment:
// fixed`. Read docs/IOS-PWA-LAYOUT.md before reaching for either — it records
// what viewport-anchored boxes actually measured on device in an installed PWA.
//
// HomeScreenV2 is not built on this: it arrived at the same split independently
// because its bottom nav has to sit below the scroller in normal flow, so its
// root already carries the backdrop and already does not scroll.
function ScreenShell({
    // Positioning and theming for the root, supplied whole by the screen —
    // most fill their parent (`relative h-full w-full`), the waiting room lays
    // over the table (`absolute inset-0 z-40`), the game-over takeover pins to
    // the viewport (`fixed inset-0 z-50`).
    //
    // It has to include a position and a definite height, and this component
    // deliberately does not supply either. Two position utilities on one
    // element are resolved by the cascade rather than by the order they are
    // written in, so a `relative` hardcoded here silently outranked the
    // `absolute` the waiting room passes and left the root auto-height.
    className = '',
    style,
    // Backdrop layers drawn behind the scroller: tint, glow, watermarks, and
    // anything else a screen wants to keep out of the scroll (confetti).
    // Rendered as siblings of the scroller so they stay screen-sized.
    backdrop,
    children,
}) {
    return (
        <div className={`overflow-hidden ${className}`} style={style}>
            {backdrop}
            <div className="relative z-10 h-full w-full overflow-y-auto overflow-x-hidden">
                {children}
            </div>
        </div>
    );
}

// The backdrop nearly every screen draws: the vignette tint over the root's
// base gradient, one accent glow bleeding off the top, and two faded suit
// watermarks bleeding off the sides. Which suits, and where, is the only thing
// screens vary — so that is all they pass.
export function ScreenBackdrop({ tint, soft, glow = {}, watermarks = [] }) {
    const { width = 520, height = 340, top = '-140px' } = glow;
    return (
        <>
            {tint && <div className="absolute inset-0 pointer-events-none" style={{ background: tint }} />}
            <div
                className="absolute pointer-events-none"
                style={{ top, left: '50%', transform: 'translateX(-50%)', width, height, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }}
            />
            {watermarks.map((w, i) => (
                <SuitWatermark key={i} {...w} />
            ))}
        </>
    );
}

export default ScreenShell;
