import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * useSyncExternalStore rather than useState + useEffect: matchMedia is an
 * external store, so React reads it during render and there is never a frame
 * showing the wrong breakpoint (nor a setState inside an effect).
 */
export function useMediaQuery(query) {
    const subscribe = useCallback((onChange) => {
        const media = window.matchMedia(query);
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [query]);

    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// The breakpoint the whole app splits on: below it the v2 mobile layouts, at or
// above it the v2 desktop layouts.
export const DESKTOP_QUERY = '(min-width: 768px)';

// There is deliberately no second width breakpoint. The desktop table used to
// have one (1024px), below which its score and round-log rails were dropped for
// the mobile affordances — a third composition to keep honest. The rails are
// gone: the scoreboard is a corner panel and the log a slide-in, both of which
// fit at 768px, so one desktop composition now covers every width above it.
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

// Height breakpoint for the mobile game table. MOBILE_LAYOUT's offsets were
// tuned on a ~844px-tall phone; with mobile-browser chrome visible the usable
// height drops to ~650-760px, and the fixed offsets need the compact tier
// (see layout.js) to keep the pile clear of the banner and controls.
export const SHORT_QUERY = '(max-height: 760px)';
export const useIsShortViewport = () => useMediaQuery(SHORT_QUERY);

export default useMediaQuery;
