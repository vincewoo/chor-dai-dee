import { useMemo } from 'react';

/**
 * Overlapping-hand geometry for the v2 hand.
 * Shared by MobileHandV2 (interactive) and SpectatorHandV2 (read-only) so the
 * two stay visually identical as sizing is tuned.
 *
 * The sizing options come from the active table layout (see
 * components/tableV2/layout.js); the defaults are the mobile values, so callers
 * that pass nothing keep the original sizing.
 *
 * - `maxCardWidth`   how big a single card may get
 * - `minVisibleRatio` how much of each card must stay visible with 13 in hand
 * - `maxVisibleRatio` how far the fan may spread once there is room to spare
 */
export default function useHandGeometry(cardCount, containerWidth, opts) {
    const maxCardWidth = opts?.maxCardWidth ?? 75;
    const minVisibleRatio = opts?.minVisibleRatio ?? 0.32;
    const maxVisibleRatio = opts?.maxVisibleRatio ?? 0.52;

    return useMemo(() => {
        const n = cardCount;
        const avail = Math.max(0, (containerWidth || 390) - 12);
        // Base width `maxCardWidth`; shrink to fit up to 13 cards at
        // ~minVisibleRatio visible each.
        const maxByCount = avail / (1 + (13 - 1) * minVisibleRatio);
        const w = Math.max(48, Math.min(maxCardWidth, maxByCount));
        const h = w * 1.533;
        const ml = n <= 1
            ? 0
            : Math.max(-(w * 0.68), Math.min(-(w * (1 - maxVisibleRatio)), (avail - w) / (n - 1) - w));
        // Card type was drawn at the 75px mobile card. Scale it up once the card
        // grows past that, and never down — so every mobile width (48–75) keeps
        // exactly the sizes it has today.
        const typeScale = Math.max(1, w / 75);
        return { width: Math.round(w), height: Math.round(h), marginLeft: Math.round(ml), typeScale };
    }, [cardCount, containerWidth, maxCardWidth, minVisibleRatio, maxVisibleRatio]);
}
