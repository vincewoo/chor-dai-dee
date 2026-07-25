import { useMemo } from 'react';

/**
 * Overlapping-hand geometry for the v2 mobile hand.
 * Shared by MobileHandV2 (interactive) and SpectatorHandV2 (read-only) so the
 * two stay visually identical as sizing is tuned.
 */
export default function useHandGeometry(cardCount, containerWidth) {
    return useMemo(() => {
        const n = cardCount;
        const avail = Math.max(0, (containerWidth || 390) - 12);
        // Base width 75; shrink to fit up to 13 cards at ~32% visible each.
        const maxByCount = avail / (1 + (13 - 1) * 0.32);
        const w = Math.max(48, Math.min(75, maxByCount));
        const h = w * 1.533;
        const ml = n <= 1 ? 0 : Math.max(-(w * 0.68), Math.min(-(w * 0.48), (avail - w) / (n - 1) - w));
        return { width: Math.round(w), height: Math.round(h), marginLeft: Math.round(ml) };
    }, [cardCount, containerWidth]);
}
