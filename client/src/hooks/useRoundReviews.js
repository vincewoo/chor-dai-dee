import { useCallback, useRef, useState } from 'react';
import { shouldLoadReview } from '../utils/gameSummary';

// Round reviews for expandable game cards, shared by the Activity feed and the
// home screen's Recent list so both can draw the same expanded card.
//
// Fetched per expanded card, not with the list: a review is a few KB and a feed
// page is twenty games, almost none of which get opened. Cached by game id, so
// re-expanding the same card is free for as long as the screen stays mounted —
// the cache is per-mount, and navigating away and back refetches.
export function useRoundReviews(serverUrl) {
    const [reviews, setReviews] = useState({});

    // In-flight is its own value. Marking it `null` -- which is also what "this
    // game has no review" means -- made a failed request indistinguishable from
    // a legitimately empty one, so the card was stuck on the plain standings
    // forever and reopening it could never retry.
    // Two refs rather than reading `reviews`: a state updater is not run
    // synchronously, so deciding "already in flight" inside one and checking it
    // on the next line always saw an empty set and skipped the fetch entirely.
    // Refs also keep this callback out of the reviews dependency, which would
    // otherwise rebuild it on every resolved fetch.
    const inFlight = useRef(new Set());
    const loaded = useRef(new Set());

    const loadReview = useCallback(async (gameId) => {
        // The decision itself is pure and tested; this hook is the fetch shell.
        if (!shouldLoadReview(gameId, { inFlight: inFlight.current, loaded: loaded.current })) return;
        inFlight.current.add(gameId);
        try {
            const response = await fetch(`${serverUrl}/api/games/${gameId}/round-review`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setReviews(prev => ({ ...prev, [gameId]: data.review || null }));
            loaded.current.add(gameId);
        } catch (err) {
            // Left unresolved on purpose, so closing and reopening retries.
            // Named: this string is the only observability the feature has, and
            // it now fires from two screens.
            console.error(`Error fetching round review for ${gameId}:`, err);
        } finally {
            inFlight.current.delete(gameId);
        }
    }, [serverUrl]);

    return { reviews, loadReview };
}

export default useRoundReviews;
