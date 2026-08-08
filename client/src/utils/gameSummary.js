// Extension-ful, like every other relative import under src/utils: these are
// loaded directly by `node --test`, which will not resolve a bare specifier.
import { timeAgo } from './timeAgo.js';

// The one derivation of an `/api/activity` row into what a game card shows.
//
// The home screen's Recent list and the Activity feed request the *identical*
// row from the same endpoint — home just asks for four of them. They used to
// interpret it separately, and home's path remapped the row into the legacy
// score dialog's `{winner, scores[]}` shape, silently dropping deal strength,
// rounds won, duration, the timestamp, the highlights count and the whole
// abandoned-game treatment. Deriving the view model in one place is what stops
// that divergence from coming back: a field added here reaches both surfaces.

export function formatDuration(seconds) {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
}

export function ordinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

export function buildGameCard(game, { username, isGuest = false, nowTs } = {}) {
    const abandoned = game.status === 'abandoned';
    // Abandoned games carry scores but no placements, so ordering by placement
    // would leave them in seat order. Their scores are still a standing, just
    // not a final one — lower is better.
    const participants = [...(game.participants || [])].sort((a, b) =>
        abandoned
            ? (a.score ?? 0) - (b.score ?? 0)
            : (a.placement ?? 99) - (b.placement ?? 99)
    );
    const winner = participants.find((p) => p.placement === 1);
    const winnerName = winner?.username || game.winner_username || null;

    return {
        id: game.game_id,
        mode: game.game_mode,
        abandoned,
        isPrivate: !game.is_public,
        // Server-derived, and already a real boolean: it knows both the frozen
        // tier and whether the game seated a bot for it to apply to.
        maxBots: game.max_bots,
        when: timeAgo(game.end_time, nowTs),
        rounds: game.total_rounds,
        duration: formatDuration(game.duration_seconds),
        highlights: game.event_count || 0,
        winnerName,
        winnerIsMe: !!winnerName && winnerName === username,
        hasMe: participants.some((p) => p.username === username),
        // A review shows every hand at the table, so it is offered only for a
        // game this player actually sat in — and never to a guest, who has no
        // account for the review to be scoped to.
        canReview: !!game.game_id && !isGuest
            && participants.some((p) => !p.isBot && p.username === username),
        participants,
    };
}

export function buildGameCards(games = [], opts) {
    return games.map((g) => buildGameCard(g, opts));
}
