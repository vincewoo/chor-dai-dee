import { useMemo, useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import SuitWatermark from './SuitWatermark';
import MaxBotsChip from './MaxBotsChip';
import RoundReviewPanel from './RoundReviewPanel';
import logoImage from '../../assets/chor-dai-dee-logo.webp';
import { timeAgo } from '../../utils/timeAgo';

// v2 mobile activity feed. Same shell language as LeaderboardV2 (surface wash,
// suit watermarks, HUD row, pill filters). Data and paging live in the
// ActivityFeed container; this component is presentational.
//
// Tapping a game expands its final standings in place rather than opening the
// legacy ScoreDialog, which would break out of the v2 look on mobile.

const STATUS_FILTERS = [
    { id: 'completed', label: 'Finished' },
    { id: 'all', label: 'Everything' },
    { id: 'abandoned', label: 'Rage quits' },
];

// Kept short so all three pills stay on one line down to 320px viewports; the
// point thresholds are implied by the mode chip on each card.
const MODE_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'short', label: '⚡ Short' },
    { id: 'standard', label: '🏆 Standard' },
];

function formatDuration(seconds) {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
}

function ordinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

function ActivityFeedV2({
    games = [],
    filters,
    onSetFilters,
    loading,
    loadingMore,
    error,
    hasMore,
    onLoadMore,
    onRetry,
    onBack,
    username,
    // Fetched per expanded card; undefined = not loaded, null = this game
    // predates the feature and has nothing to show.
    reviews = {},
    onExpandGame,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const [expandedId, setExpandedId] = useState(null);
    // Snapshot "now" once so the relative labels stay stable across re-renders.
    const [nowTs] = useState(() => Date.now());

    const anim = (d) => (rm ? undefined : d);

    // Winners and expanded standings both render avatars for these names.
    useAvatars(games.flatMap((g) => (g.participants || []).map((p) => p.username)));

    const pill = (on) => ({
        flex: 1,
        padding: '9px 0',
        borderRadius: 12,
        border: `1px solid ${on ? acc : 'rgba(255,255,255,.14)'}`,
        background: on ? accGrad : 'rgba(0,0,0,.38)',
        color: on ? '#0b0d10' : 'rgba(244,245,247,.6)',
        fontFamily: "'Outfit',sans-serif",
        fontWeight: 800,
        fontSize: 13,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    });

    const cards = useMemo(
        () =>
            games.map((g) => {
                const abandoned = g.status === 'abandoned';
                // Abandoned games carry scores but no placements, so ordering by
                // placement would leave them in seat order. Their scores are
                // still a standing, just not a final one — lower is better.
                const participants = [...(g.participants || [])].sort((a, b) =>
                    abandoned
                        ? (a.score ?? 0) - (b.score ?? 0)
                        : (a.placement ?? 99) - (b.placement ?? 99)
                );
                const winner = participants.find((p) => p.placement === 1);
                const winnerName = winner?.username || g.winner_username || null;
                return {
                    id: g.game_id,
                    mode: g.game_mode,
                    abandoned,
                    isPrivate: !g.is_public,
                    // Server-derived, and already a real boolean: it knows both
                    // the frozen tier and whether the game seated a bot for it
                    // to apply to. Consumed bare here, in the Recent list and in
                    // the score dialog, so the three agree about the type.
                    maxBots: g.max_bots,
                    when: timeAgo(g.end_time, nowTs),
                    rounds: g.total_rounds,
                    duration: formatDuration(g.duration_seconds),
                    highlights: g.event_count || 0,
                    winnerName,
                    winnerIsMe: !!winnerName && winnerName === username,
                    hasMe: participants.some((p) => p.username === username),
                    participants,
                };
            }),
        [games, nowTs, username]
    );

    return (
        <div
            className="relative h-full w-full overflow-y-auto overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div className="absolute pointer-events-none" style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }} />
            <SuitWatermark suit="H" size={150} rotate={-14} style={{ top: 210, left: -46 }} />
            <SuitWatermark suit="S" size={165} rotate={12} opacity={0.03} style={{ top: 560, right: -52 }} />

            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-36 pt-safe-18 md:max-w-[960px] md:px-8">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 17 }}>Activity</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>

                {/* Filters */}
                <div className="mt-4 flex gap-2">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => onSetFilters({ ...filters, status: f.id })}
                            style={pill(filters.status === f.id)}
                        >{f.label}</button>
                    ))}
                </div>
                <div className="mt-2 flex gap-2">
                    {MODE_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => onSetFilters({ ...filters, gameMode: f.id })}
                            style={pill(filters.gameMode === f.id)}
                        >{f.label}</button>
                    ))}
                </div>

                {loading && (
                    <div className="mt-10 text-center" style={{ color: 'rgba(244,245,247,.6)', fontSize: 14, fontWeight: 600 }}>Loading games…</div>
                )}

                {error && !loading && (
                    <div className="mt-10 flex flex-col items-center gap-3">
                        <div style={{ color: '#ff8f70', fontSize: 14, fontWeight: 600 }}>{error}</div>
                        <button
                            onClick={onRetry}
                            style={{ padding: '9px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                        >Try again</button>
                    </div>
                )}

                {!loading && !error && cards.length === 0 && (
                    <div className="mt-10 text-center" style={{ color: 'rgba(244,245,247,.6)', fontSize: 14, fontWeight: 600 }}>No games here yet — go play one!</div>
                )}

                {/* Two columns of cards once there is room; each still expands
                    its standings in place. */}
                {!loading && !error && cards.length > 0 && (
                    <div className="mt-4 grid grid-cols-1 items-start gap-[10px] md:grid-cols-2 md:gap-3">
                        {cards.map((c, i) => {
                            // Games swept out of the historic 'in_progress'
                            // backlog never had participants written, so there
                            // are no standings to open.
                            const canExpand = c.participants.length > 0;
                            const open = canExpand && expandedId === c.id;
                            const review = reviews[c.id] || null;
                            return (
                                // A div with button semantics, not a <button>:
                                // the expanded body now contains the round
                                // review's own toggle, and a button inside a
                                // button is not parseable HTML. Keyboard and
                                // ARIA behaviour are kept by hand so this is a
                                // change of element, not of affordance.
                                <div
                                    key={c.id}
                                    role={canExpand ? 'button' : undefined}
                                    tabIndex={canExpand ? 0 : undefined}
                                    onClick={(e) => {
                                        if (!canExpand) return;
                                        // Same reasoning as onKeyDown: a click on
                                        // the review's toggle must not also toggle
                                        // the card underneath it.
                                        if (e.target.closest('button') ) return;
                                        const next = open ? null : c.id;
                                        setExpandedId(next);
                                        if (next) onExpandGame?.(c.id);
                                    }}
                                    onKeyDown={(e) => {
                                        if (!canExpand) return;
                                        // Only the card's own key events. The
                                        // expanded body holds the round review's
                                        // toggle, and Enter/Space on that bubbles
                                        // up here -- which swallowed the keypress
                                        // and collapsed the whole card instead of
                                        // opening the grid, leaving the inner
                                        // control reachable by mouse only.
                                        if (e.target !== e.currentTarget) return;
                                        if (e.key !== 'Enter' && e.key !== ' ') return;
                                        e.preventDefault();
                                        const next = open ? null : c.id;
                                        setExpandedId(next);
                                        if (next) onExpandGame?.(c.id);
                                    }}
                                    aria-expanded={canExpand ? open : undefined}
                                    className="text-left"
                                    style={{
                                        background: c.hasMe
                                            ? 'linear-gradient(160deg,rgba(0,0,0,.52),rgba(0,0,0,.34))'
                                            : 'rgba(0,0,0,.34)',
                                        border: `1px solid ${c.hasMe ? `${acc}55` : 'rgba(255,255,255,.09)'}`,
                                        borderRadius: 16,
                                        padding: '12px 14px',
                                        cursor: canExpand ? 'pointer' : 'default',
                                        boxShadow: c.hasMe ? `0 0 16px ${soft}` : 'none',
                                        ...anim({ animation: `cddToast .35s ${(Math.min(i, 8) * 0.04).toFixed(2)}s ease-out both` }),
                                    }}
                                >
                                    {/* Meta row */}
                                    <div className="flex items-center justify-between gap-2">
                                        {/* Wraps rather than overflows: mode is
                                            always there, and a game can carry
                                            all three of QUIT, PRIVATE and MAX
                                            BOTS at once, which does not fit one
                                            line beside the timestamp at 320px. */}
                                        <div className="flex flex-wrap items-center gap-[6px]" style={{ minWidth: 0 }}>
                                            <span style={{ background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(244,245,247,.75)', fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '3px 8px', borderRadius: 7, whiteSpace: 'nowrap' }}>
                                                {c.mode === 'short' ? '⚡ SHORT' : '🏆 STANDARD'}
                                            </span>
                                            {c.abandoned && (
                                                <span style={{ background: 'rgba(255,143,112,.15)', border: '1px solid rgba(255,143,112,.35)', color: '#ff8f70', fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '3px 8px', borderRadius: 7, whiteSpace: 'nowrap' }}>
                                                    QUIT
                                                </span>
                                            )}
                                            {c.isPrivate && (
                                                <span style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: .6, padding: '3px 8px', borderRadius: 7, whiteSpace: 'nowrap' }}>
                                                    PRIVATE
                                                </span>
                                            )}
                                            {c.maxBots && <MaxBotsChip />}
                                        </div>
                                        <span style={{ color: 'rgba(244,245,247,.42)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            {c.when || 'In progress'}
                                        </span>
                                    </div>

                                    {/* Winner line. An abandoned game has no
                                        winner, so it gets a door instead of a
                                        crowned "?" avatar. */}
                                    <div className="mt-[10px] flex items-center gap-[11px]">
                                        <div style={{ position: 'relative', flexShrink: 0 }}>
                                            <div style={{ width: 38, height: 38, borderRadius: 12, background: c.abandoned ? 'rgba(255,143,112,.14)' : getAvatarTile(c.winnerName || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21 }}>
                                                {c.abandoned ? '🚪' : getAvatarEmoji(c.winnerName || '?')}
                                            </div>
                                            {!c.abandoned && <span style={{ position: 'absolute', top: -8, left: -4, fontSize: 14 }}>👑</span>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="truncate" style={{ color: c.abandoned ? 'rgba(244,245,247,.6)' : (c.winnerIsMe ? acc : '#f4f5f7'), fontWeight: 700, fontSize: 14 }}>
                                                {c.abandoned ? 'Nobody finished' : (c.winnerName || 'No winner')}
                                                {!c.abandoned && c.winnerIsMe && <span style={{ color: 'rgba(244,245,247,.5)', fontWeight: 600 }}> · you</span>}
                                            </div>
                                            <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>
                                                {/* Games swept from the historic
                                                    'in_progress' backlog have no
                                                    participant rows at all. */}
                                                {c.participants.length > 0
                                                    ? `${c.participants.length} players`
                                                    : 'Players unknown'}
                                                {c.rounds ? ` · ${c.rounds} round${c.rounds === 1 ? '' : 's'}` : ''}
                                                {c.duration ? ` · ${c.duration}` : ''}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                            {c.highlights > 0 && (
                                                <span style={{ color: acc, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>⭐ {c.highlights}</span>
                                            )}
                                            {canExpand && (
                                                <span
                                                    aria-hidden="true"
                                                    style={{ color: 'rgba(244,245,247,.4)', fontSize: 12, display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: rm ? undefined : 'transform .2s ease' }}
                                                >▾</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded standings */}
                                    {open && (
                                        <div className="mt-3 flex flex-col gap-[6px]" style={{ borderTop: '1px solid rgba(255,255,255,.09)', paddingTop: 10 }}>
                                            {c.participants.map((p, idx) => {
                                                const first = p.placement === 1;
                                                const isMe = p.username === username;
                                                const deal = review?.[p.username];
                                                return (
                                                    <div key={`${p.username}-${idx}`} className="flex items-center gap-[10px]">
                                                        <div style={{ width: 16, textAlign: 'center', color: first ? acc : 'rgba(244,245,247,.4)', fontWeight: 800, fontSize: 12 }}>
                                                            {p.placement ?? '–'}
                                                        </div>
                                                        <div style={{ width: 26, height: 26, borderRadius: 9, background: getAvatarTile(p.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                                                            {getAvatarEmoji(p.username)}
                                                        </div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div className="truncate" style={{ color: isMe ? acc : '#f4f5f7', fontWeight: 700, fontSize: 12 }}>
                                                                {p.username}
                                                                {p.isBot ? <span style={{ color: 'rgba(244,245,247,.4)', fontWeight: 600 }}> · bot</span> : null}
                                                            </div>
                                                            {/* Placement is the number in the left
                                                                gutter, so naming it again here spends the
                                                                line on nothing -- same reasoning as the
                                                                game-over standings. It survives only for
                                                                an abandoned game, where the gutter shows a
                                                                dash because there is no final standing. */}
                                                            <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 10, fontWeight: 600 }}>
                                                                {[
                                                                    // No placement means no gutter number to be
                                                                    // redundant with, so this still earns its space.
                                                                    p.placement
                                                                        ? null
                                                                        : (c.abandoned ? 'Score when abandoned' : 'Unranked'),
                                                                    // Nothing recorded for this game: fall back to the
                                                                    // placement rather than leaving an empty line.
                                                                    (!deal?.dealRank && p.placement)
                                                                        ? (first ? 'Winner' : `${p.placement}${ordinalSuffix(p.placement)} place`)
                                                                        : null,
                                                                    // What they did, then the cards they did it with.
                                                                    p.roundsWon
                                                                        ? `${p.roundsWon} round${p.roundsWon === 1 ? '' : 's'} won`
                                                                        : null,
                                                                    deal?.dealRank
                                                                        ? `Deal strength: ${deal.dealRank}${ordinalSuffix(deal.dealRank)}`
                                                                          + ` (${deal.avgPercentile}${ordinalSuffix(deal.avgPercentile)} pct)`
                                                                        : null,
                                                                ].filter(Boolean).join(' · ')}
                                                            </div>
                                                        </div>
                                                        <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
                                                            {p.score ?? 0} <span style={{ color: 'rgba(244,245,247,.4)', fontSize: 10, fontWeight: 600 }}>pts</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* The same panel the game-over screen
                                                draws, from the same recorded data,
                                                so the two cannot describe one game
                                                differently. Absent for games played
                                                before it was recorded. */}
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <RoundReviewPanel
                                                    rows={c.participants.map((p) => ({
                                                        key: p.username,
                                                        name: p.username,
                                                        isYou: p.username === username,
                                                    }))}
                                                    roundReview={review}
                                                    acc={acc}
                                                    rm={rm}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {hasMore && (
                            <button
                                onClick={onLoadMore}
                                disabled={loadingMore}
                                style={{ marginTop: 6, padding: '12px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.38)', color: loadingMore ? 'rgba(244,245,247,.45)' : '#f4f5f7', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 14, cursor: loadingMore ? 'default' : 'pointer' }}
                            >{loadingMore ? 'Loading…' : 'Load more'}</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default ActivityFeedV2;
