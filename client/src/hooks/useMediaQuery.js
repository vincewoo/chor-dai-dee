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

// Second breakpoint, used only by the desktop game table: the persistent score
// and round-log rails need this much width before they earn their space.
export const WIDE_QUERY = '(min-width: 1024px)';

export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);
export const useIsWide = () => useMediaQuery(WIDE_QUERY);

export default useMediaQuery;
