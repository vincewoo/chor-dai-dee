import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTableTheme } from '../../theme/tableTheme';
import { APP_TABS, activeTabFor } from '../../utils/appNav';
import NavIcon from './NavIcon';

const FONT = "'Outfit',sans-serif";

// Layout route for every screen outside a game: the persistent tab bar lives
// here, so it survives navigating between Home, Leaders, Activity and Stats
// instead of being a private detail of the home screen.
//
// The structure is the column shell docs/IOS-PWA-LAYOUT.md requires: nothing is
// taken out of flow. The phone bar is the LAST ROW IN NORMAL FLOW of a
// full-height column — `position: fixed` anchored by bottom alone resolves one
// safe-area-inset-top above the physical bottom edge in the installed
// viewport-fit=cover iOS PWA, which is exactly the bug that killed the old
// floating footer. The bar's own `pb-safe-bar` paints its background through
// the home-indicator band.
//
// Screens render in the middle row and keep their own ScreenShell backdrops;
// the root carries `surface.base` only so the translucent bar (and the strip
// above the fold on desktop) has felt behind it rather than the page default.
// The middle row is `relative` because the waiting room's ScreenShell positions
// itself `absolute inset-0` against its nearest positioned ancestor.
function AppShell() {
    const { acc, surface } = useTableTheme();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const active = activeTabFor(pathname);

    // A screen that has committed the player to something the tabs would
    // silently walk out of can ask for the chrome to go away. The one case
    // today is Lobby's post-game rematch waiting room: the player holds a live
    // seat server-side, and navigating off /lobby runs no leave_room cleanup —
    // so while it is up, the explicit Leave button must be the only way out,
    // exactly as it was when the bar was HomeScreenV2's own. The setter rides
    // the Outlet context so only route elements can reach it.
    const [chromeHidden, setChromeHidden] = useState(false);

    // Tapping the tab you are already on returns you to that tab's root —
    // /stats/:username lights the Stats tab, and tapping it again is "take me
    // back to my stats". At the root itself it is a no-op.
    const go = (tab) => {
        if (pathname !== tab.path) navigate(tab.path);
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: surface.base }}>
            {/* Desktop destinations: a slim header strip. The bottom bar is a
                thumb-reach affordance; from 768px up these read better as
                header links, as they did on the old desktop home screen. */}
            {!chromeHidden && <nav
                className="hidden shrink-0 items-center justify-end gap-1 px-6 py-[6px] md:flex"
                style={{ background: 'rgba(8,26,18,.6)', borderBottom: '1px solid rgba(255,255,255,.08)' }}
            >
                {APP_TABS.map((tab) => {
                    const on = active === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => go(tab)}
                            aria-current={on ? 'page' : undefined}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 11, border: 'none', background: on ? 'rgba(255,255,255,.08)' : 'none', color: on ? acc : 'rgba(244,245,247,.62)', fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                        >
                            <NavIcon name={tab.icon} size={17} />
                            {tab.label}
                        </button>
                    );
                })}
            </nav>}

            <div className="relative min-h-0 flex-1">
                <Outlet context={{ setChromeHidden }} />
            </div>

            {/* Phone destinations. A flow row of the column shell — NOT fixed
                and NOT absolute in the scroller (see the shell comment). */}
            {!chromeHidden && <nav
                className="relative z-20 shrink-0 flex items-stretch justify-around gap-1 px-2 pb-safe-bar pt-[7px] md:hidden"
                style={{ background: 'rgba(8,26,18,.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid rgba(255,255,255,.09)' }}
            >
                {APP_TABS.map((tab) => {
                    const on = active === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => go(tab)}
                            aria-current={on ? 'page' : undefined}
                            // No bottom padding of its own: the bar's pb-safe-bar
                            // owns the space below the labels, so the two do not
                            // stack into a tall half-empty bar on a device with a
                            // home indicator. minHeight replaces the tap area that
                            // padding used to provide — the bar's padding sits
                            // OUTSIDE the button box, so without this the target
                            // shrinks to 41px, under the 44pt minimum.
                            style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 2px 0', border: 'none', background: 'none', color: on ? acc : 'rgba(244,245,247,.6)', fontFamily: FONT, fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                        >
                            <NavIcon name={tab.icon} />
                            <span className="truncate" style={{ maxWidth: '100%' }}>{tab.label}</span>
                        </button>
                    );
                })}
            </nav>}
        </div>
    );
}

export default AppShell;
