// Compact relative label — the wide "about 2 hours ago" phrasing from date-fns
// crowds cards at mobile widths. Rolls all the way up (minutes → hours →
// days → weeks → months → years) so old games never read as a huge hour count.
// Shared by the activity feed and the home screen's recent-games list.
export function timeAgo(iso, now) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    const s = Math.max(0, Math.floor((now - t) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
}
