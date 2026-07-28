import { useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import SuitWatermark from './SuitWatermark';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

const SORTS = [
    { id: 'rating', label: 'Rating' },
    { id: 'games', label: 'Games' },
    { id: 'wins', label: 'Wins' },
    { id: 'winRate', label: 'Win rate' },
    { id: 'firstPlace', label: '1st places' },
    { id: 'avgPlacement', label: 'Avg place' },
];
const MIN_GAMES = [0, 5, 10, 25, 50];

const ARCHETYPE_COLOR = {
    Aggressive: '#ff8d96',
    Conservative: '#7fb2ff',
    Balanced: '#6ee7a8',
    Adaptive: '#a48fff',
};

const GOOD = '#6ee7a8';

const pct = (v) => (v || v === 0 ? `${(v * 100).toFixed(1)}%` : '—');

const chip = (on, acc, accGrad) => ({
    padding: '5px 11px',
    borderRadius: 9,
    border: `1px solid ${on ? acc : 'rgba(255,255,255,.14)'}`,
    background: on ? accGrad : 'rgba(0,0,0,.38)',
    color: on ? '#0b0d10' : 'rgba(244,245,247,.6)',
    fontFamily: "'Outfit',sans-serif",
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
});

// One right-aligned column in a desktop leaderboard row.
function Stat({ label, value, color = '#f4f5f7' }) {
    return (
        <div style={{ textAlign: 'right', minWidth: 54 }}>
            <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>{label.toUpperCase()}</div>
            <div style={{ color, fontWeight: 700, fontSize: 13 }}>{value ?? '—'}</div>
        </div>
    );
}

// v2 leaderboard (global only — no friends system server-side). Mirrors the
// "Leaderboard v2" mockup: podium for the top 3, a rank list, and a pinned "YOU"
// row. Data comes from /api/leaderboard via the Leaderboard container; no trend
// arrows (no historical delta stored).
//
// Sorting, the minimum-games filter and the per-player detail columns are
// desktop-only. They came from the legacy desktop table and there is no room for
// them on a phone, so they render from md up and the phone keeps the podium and
// a rating-ranked list.
function LeaderboardV2({
    data = [], mode, onSetMode, user, loading, error, onBack, onPlayerClick,
    sortBy, onSetSortBy, minGames, onSetMinGames, onArchetypeClick,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();

    const ranked = useMemo(
        () => data.map((p, i) => ({ ...p, rank: i + 1 })),
        [data]
    );
    useAvatars(ranked.map((p) => p.username));
    const top3 = ranked.slice(0, 3);
    const rest = ranked.slice(3);
    const me = ranked.find((p) => user && p.username === user.username);

    const fmt = (r) => Math.round(r).toLocaleString();
    const anim = (d) => (rm ? undefined : d);

    // Podium column order: 2nd, 1st, 3rd (center is tallest).
    const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
    const barHeight = (rank) => (rank === 1 ? 64 : rank === 2 ? 48 : 38);
    const tileSize = (rank) => (rank === 1 ? 64 : 52);

    return (
        <div
            className="relative h-full w-full overflow-y-auto overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div className="absolute pointer-events-none" style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }} />
            <SuitWatermark suit="C" size={150} rotate={-14} style={{ top: 200, left: -46 }} />
            <SuitWatermark suit="D" size={165} rotate={12} opacity={0.03} style={{ top: 540, right: -52 }} />

            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-26 pt-safe-18 md:max-w-[1000px] md:px-8">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 17 }}>Leaderboard</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>

                {/* Mode tabs (Short / Standard — the only real segmentation available) */}
                <div className="mt-4 flex gap-2">
                    {[{ id: 'short', label: 'Short · 50' }, { id: 'standard', label: 'Standard · 100' }].map((m) => {
                        const on = mode === m.id;
                        return (
                            <button
                                key={m.id}
                                onClick={() => onSetMode(m.id)}
                                style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: `1px solid ${on ? acc : 'rgba(255,255,255,.14)'}`, background: on ? accGrad : 'rgba(0,0,0,.38)', color: on ? '#0b0d10' : 'rgba(244,245,247,.6)', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                            >{m.label}</button>
                        );
                    })}
                </div>

                {/* Sorting and the minimum-games filter: desktop only. */}
                {onSetSortBy && (
                    <div className="mt-3 hidden flex-wrap items-center gap-x-5 gap-y-2 md:flex">
                        <div className="flex flex-wrap items-center gap-2">
                            <span style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>SORT</span>
                            {SORTS.map((sort) => (
                                <button
                                    key={sort.id}
                                    onClick={() => onSetSortBy(sort.id)}
                                    style={chip(sortBy === sort.id, acc, accGrad)}
                                >{sort.label}</button>
                            ))}
                        </div>
                        {onSetMinGames && (
                            <div className="flex flex-wrap items-center gap-2">
                                <span style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>MIN GAMES</span>
                                {MIN_GAMES.map((n) => (
                                    <button
                                        key={n}
                                        onClick={() => onSetMinGames(n)}
                                        style={chip(minGames === n, acc, accGrad)}
                                    >{n}+</button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {loading && (
                    <div className="mt-10 text-center" style={{ color: 'rgba(244,245,247,.6)', fontSize: 14, fontWeight: 600 }}>Loading leaderboard…</div>
                )}
                {error && !loading && (
                    <div className="mt-10 text-center" style={{ color: '#ff8f70', fontSize: 14, fontWeight: 600 }}>{error}</div>
                )}

                {!loading && !error && ranked.length === 0 && (
                    <div className="mt-10 text-center" style={{ color: 'rgba(244,245,247,.6)', fontSize: 14, fontWeight: 600 }}>No ranked players yet — play a game!</div>
                )}

                {!loading && !error && top3.length > 0 && (
                    <>
                        {/* Podium */}
                        <div className="mt-6 flex items-end gap-[10px]" style={{ height: 172 }}>
                            {podiumOrder.map((p, col) => {
                                const first = p.rank === 1;
                                return (
                                    <div key={p.username} className="flex flex-1 flex-col items-center gap-[6px]" style={anim({ animation: `cddPop .45s ${(col * 0.08).toFixed(2)}s cubic-bezier(.2,.8,.3,1.2) both` })}>
                                        <div style={{ fontSize: 16, height: 18 }}>{first ? '👑' : ''}</div>
                                        <div style={{ width: tileSize(p.rank), height: tileSize(p.rank), borderRadius: 16, background: getAvatarTile(p.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: first ? 36 : 28, boxShadow: first ? `0 0 22px ${soft}` : '0 6px 14px rgba(0,0,0,.35)' }}>{getAvatarEmoji(p.username)}</div>
                                        <div className="max-w-full truncate" style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 12 }}>{p.username}</div>
                                        <div style={{ width: '100%', borderRadius: '12px 12px 0 0', background: 'linear-gradient(180deg,rgba(0,0,0,.5),rgba(0,0,0,.28))', border: '1px solid rgba(255,255,255,.1)', borderBottom: 'none', height: barHeight(p.rank), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                            <div style={{ color: acc, fontWeight: 800, fontSize: 16 }}>{fmt(p.rating_display)}</div>
                                            <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 700 }}>#{p.rank}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Rest of list */}
                        <div className="mt-4 flex flex-col gap-2">
                            {rest.map((r, i) => (
                                <button
                                    key={r.username}
                                    onClick={() => onPlayerClick?.(r.username)}
                                    className="flex items-center gap-[11px] text-left"
                                    style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: '9px 13px', cursor: 'pointer', ...anim({ animation: `cddToast .35s ${(i * 0.05).toFixed(2)}s ease-out both` }) }}
                                >
                                    <div style={{ width: 24, textAlign: 'center', color: 'rgba(244,245,247,.45)', fontWeight: 800, fontSize: 13 }}>{r.rank}</div>
                                    <div style={{ width: 36, height: 36, borderRadius: 11, background: getAvatarTile(r.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{getAvatarEmoji(r.username)}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="truncate" style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 13 }}>{r.username}</div>
                                        <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>{r.first_place} rounds won</div>
                                    </div>

                                    {/* The legacy desktop table's columns. Hidden
                                        on phones, where there is no room. */}
                                    <div className="hidden items-center gap-5 md:flex">
                                        <Stat label="Games" value={r.games_played} />
                                        <Stat label="Wins" value={r.wins} color={GOOD} />
                                        <Stat label="Win rate" value={pct(r.win_rate)} />
                                        <Stat label="Avg place" value={r.avg_placement ? r.avg_placement.toFixed(2) : '—'} />
                                        <Stat label="Leads won" value={r.leads_won} />
                                        {/* Fixed-width slot: players without an
                                            archetype must not shift the columns
                                            of their row out of line. */}
                                        <div style={{ minWidth: 104, display: 'flex', justifyContent: 'flex-end' }}>
                                            {r.archetype && (
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); onArchetypeClick?.(r.archetype); }}
                                                    role={onArchetypeClick ? 'button' : undefined}
                                                    style={{
                                                        background: `${ARCHETYPE_COLOR[r.archetype] || '#8b949e'}22`,
                                                        border: `1px solid ${ARCHETYPE_COLOR[r.archetype] || '#8b949e'}66`,
                                                        color: ARCHETYPE_COLOR[r.archetype] || '#c3ccd6',
                                                        fontSize: 10, fontWeight: 800, letterSpacing: .4,
                                                        padding: '4px 8px', borderRadius: 8, whiteSpace: 'nowrap',
                                                        cursor: onArchetypeClick ? 'pointer' : 'default',
                                                    }}
                                                >{r.archetype}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', minWidth: 44, textAlign: 'right' }}>{fmt(r.rating_display)}</div>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* Pinned "you" row. Sticky *inside* the scroller and last in the
                    flow, not absolute: an absolutely-positioned child of a scroll
                    container is placed against the scrolled padding box, so it
                    only lands at the bottom edge at scrollTop 0 and rides up into
                    the middle of the list from there. Sticky also means it comes
                    to rest after the last row at the end of the scroll instead of
                    covering it, so the list needs no reserved bottom gutter. */}
                {me && (
                    <div
                        className="sticky z-20 mt-auto pt-3"
                        // Held the same distance off the bottom edge as the
                        // column's own bottom padding, so the stuck position and
                        // the resting position at the end of the scroll are the
                        // same place and the row never jumps.
                        style={{ bottom: 'calc(26px + env(safe-area-inset-bottom))' }}
                    >
                        <div
                            className="flex w-full items-center gap-[11px]"
                            style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.6),rgba(0,0,0,.42))', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${acc}66`, borderRadius: 16, padding: '11px 13px', boxShadow: `0 12px 28px rgba(0,0,0,.5),0 0 18px ${soft}` }}
                        >
                            <div style={{ width: 24, textAlign: 'center', color: acc, fontWeight: 800, fontSize: 13 }}>{me.rank}</div>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: getAvatarTile(me.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23 }}>{getAvatarEmoji(me.username)}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span className="truncate">{me.username}</span>
                                    <span style={{ background: accGrad, color: '#0b0d10', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 6px', borderRadius: 6 }}>YOU</span>
                                </div>
                                <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>{me.first_place} rounds won</div>
                            </div>
                            <div style={{ color: acc, fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap' }}>{fmt(me.rating_display)}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default LeaderboardV2;
