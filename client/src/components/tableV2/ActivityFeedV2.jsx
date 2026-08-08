import { useMemo, useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { useAvatars } from '../../hooks/useAvatars';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import BackButton from './BackButton';
import GameSummaryCard from './GameSummaryCard';
import logoImage from '../../assets/chor-dai-dee-logo.webp';
import { buildGameCards } from '../../utils/gameSummary';

// v2 mobile activity feed. Same shell language as LeaderboardV2 (surface wash,
// suit watermarks, HUD row, pill filters). Data and paging live in the
// ActivityFeed container; this component is presentational.
//
// The cards themselves are GameSummaryCard, shared with the home screen's
// Recent list — the two consume the identical /api/activity row, and drawing
// them separately is how home's tap target ended up on a legacy dialog with
// none of the standings, deal strength or round review this screen shows.

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
    isGuest,
    // Fetched per expanded card, keyed by game id. A missing key means the
    // fetch has not run or failed; see GameSummaryCard's `review` note.
    reviews = {},
    onExpandGame,
    onReviewGame,
}) {
    const { acc, accGrad, soft, surface } = useTableTheme();
    const [expandedId, setExpandedId] = useState(null);
    // Snapshot "now" once so the relative labels stay stable across re-renders.
    const [nowTs] = useState(() => Date.now());

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
        () => buildGameCards(games, { username, isGuest, nowTs }),
        [games, nowTs, username, isGuest]
    );

    return (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    watermarks={[
                        { suit: 'H', size: 150, rotate: -14, style: { top: 210, left: -46 } },
                        { suit: 'S', size: 165, rotate: 12, opacity: 0.03, style: { top: 460, right: -52 } },
                    ]}
                />
            }
        >
            {/* pb-9 with no safe-area inset: AppShell's tab bar sits below this screen
                in flow and owns the bottom safe-area inset. */}
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-9 pt-safe-18 md:max-w-[960px] md:px-8">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <BackButton onClick={onBack} />
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
                        {cards.map((c, i) => (
                            <GameSummaryCard
                                key={c.id}
                                card={c}
                                index={i}
                                username={username}
                                expanded={expandedId === c.id}
                                onToggle={(next) => {
                                    setExpandedId(next);
                                    if (next) onExpandGame?.(next);
                                }}
                                review={reviews[c.id] || null}
                                onReview={onReviewGame}
                            />
                        ))}

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
        </ScreenShell>
    );
}

export default ActivityFeedV2;
