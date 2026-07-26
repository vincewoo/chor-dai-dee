import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import { archetypeDescriptions } from '../ArchetypeDialog';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 mobile player statistics. Same shell language as LeaderboardV2 /
// ActivityFeedV2 (surface wash, suit watermarks, HUD row, pill tabs). All
// fetching lives in the Stats container; this component is presentational.
//
// The desktop page stacks every tier in one long column, which is unusable on a
// phone — here the same data is split across three tabs that mirror the tiers:
// Overview (tier 1), Play (tier 2 + usage), Advanced (tier 3).

const GOOD = '#6ee7a8';
const BAD = '#ff8f70';
const WARN = '#ffc94d';
const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.4)';

const ARCHETYPE_COLORS = {
    Aggressive: BAD,
    Conservative: '#7fb2ff',
    Balanced: GOOD,
    Adaptive: '#a48fff',
};

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'play', label: 'Play' },
    { id: 'advanced', label: 'Advanced' },
];

const card = {
    background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
};

const num = (v) => (v || 0).toLocaleString();
const pct = (part, whole, digits = 1) => (whole > 0 ? ((part / whole) * 100).toFixed(digits) : '0.0');
const ratio = (v, digits = 1) => ((v || 0) * 100).toFixed(digits);

function Section({ title, hint, children, delay, rm }) {
    return (
        <div
            className="mt-3"
            style={{ ...card, ...(rm ? {} : { animation: `cddToast .35s ${delay} ease-out both` }) }}
        >
            <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>{title}</div>
            {hint && <div style={{ color: FAINT, fontSize: 11, fontWeight: 600, marginTop: 3 }}>{hint}</div>}
            <div className="mt-3">{children}</div>
        </div>
    );
}

function Tile({ label, value, color = TEXT, sub }) {
    return (
        <div style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: '9px 10px' }}>
            <div style={{ color: FAINT, fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>{label}</div>
            <div style={{ color, fontSize: 19, fontWeight: 800, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
            {sub && <div style={{ color: FAINT, fontSize: 9, fontWeight: 600, marginTop: 1 }}>{sub}</div>}
        </div>
    );
}

// Horizontal bar row: fixed-width label, flexible track, right-aligned count.
function Bar({ label, labelWidth = 40, percentage, color, right, rm }) {
    const p = parseFloat(percentage) || 0;
    return (
        <div className="flex items-center gap-[8px]">
            <div style={{ width: labelWidth, color: 'rgba(244,245,247,.7)', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, minWidth: 0, height: 20, borderRadius: 8, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                <div
                    style={{
                        width: `${Math.max(p, 1.5)}%`,
                        height: '100%',
                        borderRadius: 8,
                        background: `linear-gradient(90deg,${color}cc,${color})`,
                        transition: rm ? undefined : 'width .5s ease',
                    }}
                />
            </div>
            <div style={{ width: 74, textAlign: 'right', color: 'rgba(244,245,247,.62)', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {p.toFixed(1)}% <span style={{ color: FAINT, fontWeight: 600 }}>· {right}</span>
            </div>
        </div>
    );
}

// Score meter used for the 0-100% behavioural / quality scores.
function Meter({ label, value, color, note, rm }) {
    const p = Math.max(0, Math.min(100, parseFloat(value) || 0));
    return (
        <div>
            <div className="flex items-baseline justify-between">
                <div style={{ color: 'rgba(244,245,247,.7)', fontSize: 11, fontWeight: 700 }}>{label}</div>
                <div style={{ color, fontSize: 13, fontWeight: 800 }}>{value}%</div>
            </div>
            <div className="mt-[5px]" style={{ height: 7, borderRadius: 5, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                <div style={{ width: `${p}%`, height: '100%', borderRadius: 5, background: `linear-gradient(90deg,${color}aa,${color})`, transition: rm ? undefined : 'width .5s ease' }} />
            </div>
            {note && <div style={{ color: FAINT, fontSize: 10, fontWeight: 600, marginTop: 4 }}>{note}</div>}
        </div>
    );
}

function Empty({ children }) {
    return (
        <div className="py-3 text-center" style={{ color: MUTED, fontSize: 12, fontWeight: 600 }}>{children}</div>
    );
}

// Archetype explainer, replacing the white ArchetypeDialog on mobile.
function ArchetypeSheet({ archetype, onClose, rm }) {
    const details = archetype ? archetypeDescriptions[archetype] : null;
    const color = ARCHETYPE_COLORS[archetype] || TEXT;

    return (
        <AnimatePresence>
            {details && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8,9,12,.62)' }}
                    />
                    <motion.div
                        initial={rm ? false : { y: 60, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 60, opacity: 0 }}
                        transition={{ duration: rm ? 0 : 0.28, ease: 'easeOut' }}
                        role="dialog"
                        aria-label={details.title}
                        style={{
                            position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '82vh', zIndex: 95,
                            background: 'linear-gradient(180deg,rgba(24,27,33,.97),rgba(13,15,19,.98))',
                            border: '1px solid rgba(255,255,255,.12)', borderBottom: 'none',
                            borderRadius: '24px 24px 0 0', boxShadow: '0 -18px 44px rgba(0,0,0,.55)',
                            display: 'flex', flexDirection: 'column', fontFamily: "'Outfit',sans-serif",
                        }}
                    >
                        <div className="flex items-center justify-between" style={{ padding: '16px 18px 10px' }}>
                            <div style={{ color, fontWeight: 800, fontSize: 17 }}>{details.title}</div>
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: TEXT, fontSize: 13, cursor: 'pointer' }}
                            >✕</button>
                        </div>
                        <div className="scrollbar-thin" style={{ overflowY: 'auto', padding: '0 18px 24px' }}>
                            <div style={{ color: 'rgba(244,245,247,.75)', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{details.description}</div>

                            <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: 2, marginTop: 16 }}>STRENGTHS</div>
                            <div className="mt-2 flex flex-col gap-[6px]">
                                {details.strengths.map((s) => (
                                    <div key={s} className="flex gap-2" style={{ color: 'rgba(244,245,247,.75)', fontSize: 12, fontWeight: 600 }}>
                                        <span style={{ color: GOOD, flexShrink: 0 }}>✓</span>{s}
                                    </div>
                                ))}
                            </div>

                            <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: 2, marginTop: 16 }}>WATCH OUT FOR</div>
                            <div className="mt-2 flex flex-col gap-[6px]">
                                {details.improvements.map((s) => (
                                    <div key={s} className="flex gap-2" style={{ color: 'rgba(244,245,247,.75)', fontSize: 12, fontWeight: 600 }}>
                                        <span style={{ color: WARN, flexShrink: 0 }}>•</span>{s}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4" style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: 12 }}>
                                <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>STRATEGIC INSIGHT</div>
                                <div className="mt-[6px]" style={{ color: 'rgba(244,245,247,.8)', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>{details.strategy}</div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

function StatsV2({
    username,
    isSelf = true,
    isGuest = false,
    mode,
    onSetMode,
    stats,
    headToHead = [],
    tier3,
    handStrength,
    rank,
    loading,
    error,
    onBack,
    onViewMyStats,
    onOpponentClick,
    onCreateAccount,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const [tab, setTab] = useState('overview');
    const [archetypeSheet, setArchetypeSheet] = useState(null);

    // Identity card plus the head-to-head rows below it.
    useAvatars([username, ...headToHead.map((r) => r.opponent_name)]);

    const game = stats?.gameStats || {};
    const rounds = stats?.roundAggregates || {};
    const combos = stats?.combinationStats || {};

    const overview = useMemo(() => {
        const g = stats?.gameStats || {};
        const played = g.games_played || 0;
        const wins = g.wins || 0;
        return {
            played,
            wins,
            losses: g.losses || 0,
            winRate: pct(wins, played),
            avgPoints: played > 0 ? ((g.points || 0) / played).toFixed(1) : '0.0',
            rating: g.rating_mu ? Math.round((g.rating_mu - 3 * g.rating_sigma) * 40 + 1200) : 1200,
        };
    }, [stats]);

    const pill = (on) => ({
        flex: 1,
        padding: '9px 0',
        borderRadius: 12,
        border: `1px solid ${on ? acc : 'rgba(255,255,255,.14)'}`,
        background: on ? accGrad : 'rgba(0,0,0,.38)',
        color: on ? '#0b0d10' : MUTED,
        fontFamily: "'Outfit',sans-serif",
        fontWeight: 800,
        fontSize: 13,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    });

    const shell = (children) => (
        <div
            className="relative h-full w-full overflow-y-auto overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div className="absolute pointer-events-none" style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }} />
            <div className="absolute pointer-events-none select-none" style={{ top: 220, left: -46, fontSize: 190, lineHeight: 1, color: 'rgba(255,255,255,.035)', transform: 'rotate(-14deg)' }}>♠</div>
            <div className="absolute pointer-events-none select-none" style={{ top: 580, right: -52, fontSize: 210, lineHeight: 1, color: 'rgba(255,255,255,.03)', transform: 'rotate(12deg)' }}>♣</div>

            <div className="relative z-10 mx-auto flex min-h-full max-w-[440px] flex-col px-[22px] pb-safe-36 pt-safe-18">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: TEXT, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div style={{ color: TEXT, fontWeight: 800, fontSize: 17 }}>Stats</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>
                {children}
            </div>
        </div>
    );

    // Guests have no persisted stats — offer the upgrade path instead.
    if (isGuest) {
        return shell(
            <div className="mt-6" style={card}>
                <div style={{ color: TEXT, fontWeight: 800, fontSize: 16 }}>Stats aren't saved for guests</div>
                <div className="mt-2" style={{ color: MUTED, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                    Create an account to track your rating, placements and play style across games.
                </div>
                <div className="mt-4 flex flex-col gap-[10px]">
                    <button
                        onClick={onCreateAccount}
                        style={{ padding: '14px 0', borderRadius: 14, border: 'none', background: accGrad, color: '#0b0d10', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 15, boxShadow: `0 8px 20px ${soft}`, cursor: 'pointer' }}
                    >Create an account</button>
                    <button
                        onClick={onBack}
                        style={{ padding: '12px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.38)', color: TEXT, fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
                    >Back to lobby</button>
                </div>
            </div>
        );
    }

    const rankLabel = rank ? (rank === 1 ? '🥇 #1' : rank === 2 ? '🥈 #2' : rank === 3 ? '🥉 #3' : `#${rank}`) : null;

    return shell(
        <>
            {/* Player identity */}
            <div
                className="mt-4 flex items-center gap-3"
                style={{ ...card, padding: '12px 14px', ...(rm ? {} : { animation: 'cddToast .35s ease-out both' }) }}
            >
                <div style={{ width: 48, height: 48, borderRadius: 14, background: getAvatarTile(username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>
                    {getAvatarEmoji(username)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-[6px]">
                        <span className="truncate" style={{ color: TEXT, fontWeight: 800, fontSize: 15 }}>{username}</span>
                        {!isSelf && (
                            <span style={{ background: 'rgba(255,255,255,.14)', color: 'rgba(244,245,247,.85)', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>RIVAL</span>
                        )}
                    </div>
                    {/* Rating and rank live in the hero tile — keep this line on volume. */}
                    <div style={{ color: MUTED, fontSize: 11, fontWeight: 600 }}>
                        {loading && !stats
                            ? 'Loading…'
                            : `${num(overview.played)} ${mode === 'short' ? 'short' : 'standard'} game${overview.played === 1 ? '' : 's'} · ${num(game.total_rounds)} rounds`}
                    </div>
                </div>
                {!isSelf && onViewMyStats && (
                    <button
                        onClick={onViewMyStats}
                        style={{ padding: '7px 12px', borderRadius: 10, border: `1px solid ${acc}66`, background: 'rgba(0,0,0,.35)', color: acc, fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                    >Mine</button>
                )}
            </div>

            {/* Mode tabs */}
            <div className="mt-3 flex gap-2">
                {[{ id: 'short', label: 'Short · 50' }, { id: 'standard', label: 'Standard · 100' }].map((m) => (
                    <button key={m.id} onClick={() => onSetMode(m.id)} style={pill(mode === m.id)}>{m.label}</button>
                ))}
            </div>

            {/* Section tabs */}
            <div className="mt-2 flex gap-2">
                {TABS.map((t) => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={pill(tab === t.id)}>{t.label}</button>
                ))}
            </div>

            {loading && (
                <div className="mt-10 text-center" style={{ color: MUTED, fontSize: 14, fontWeight: 600 }}>Loading stats…</div>
            )}

            {error && !loading && (
                <div className="mt-10 text-center" style={{ color: BAD, fontSize: 14, fontWeight: 600 }}>{error}</div>
            )}

            {!loading && !error && stats && (
                <>
                    {overview.played === 0 && (
                        <div className="mt-3" style={{ ...card, padding: '12px 14px' }}>
                            <div style={{ color: MUTED, fontSize: 12, fontWeight: 600 }}>
                                {isSelf
                                    ? `No finished ${mode === 'short' ? 'short' : 'standard'} games yet — numbers below fill in once you play one.`
                                    : `${username} hasn't finished a ${mode === 'short' ? 'short' : 'standard'} game yet.`}
                            </div>
                        </div>
                    )}

                    {tab === 'overview' && (
                        <OverviewTab
                            overview={overview}
                            game={game}
                            rounds={rounds}
                            rankLabel={rankLabel}
                            acc={acc}
                            rm={rm}
                        />
                    )}

                    {tab === 'play' && (
                        <PlayTab
                            game={game}
                            rounds={rounds}
                            combos={combos}
                            headToHead={headToHead}
                            onOpponentClick={onOpponentClick}
                            acc={acc}
                            soft={soft}
                            rm={rm}
                        />
                    )}

                    {tab === 'advanced' && (
                        <AdvancedTab
                            tier3={tier3}
                            handStrength={handStrength}
                            acc={acc}
                            rm={rm}
                            onArchetypeClick={setArchetypeSheet}
                        />
                    )}
                </>
            )}

            <ArchetypeSheet archetype={archetypeSheet} onClose={() => setArchetypeSheet(null)} rm={rm} />
        </>
    );
}

function OverviewTab({ overview, game, rounds, rankLabel, acc, rm }) {
    const first = game.first_place || 0;
    const second = game.second_place || 0;
    const third = game.third_place || 0;
    const fourth = game.fourth_place || 0;
    const placements = first + second + third + fourth;

    return (
        <>
            {/* Hero */}
            <div
                className="mt-3"
                style={{ ...card, ...(rm ? {} : { animation: 'cddToast .35s .04s ease-out both' }) }}
            >
                <div className="flex items-end justify-between">
                    <div>
                        <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>RATING</div>
                        <div style={{ color: acc, fontSize: 38, fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{num(overview.rating)}</div>
                    </div>
                    {rankLabel && (
                        <div style={{ background: 'rgba(0,0,0,.34)', border: `1px solid ${acc}55`, borderRadius: 12, padding: '7px 11px', textAlign: 'right' }}>
                            <div style={{ color: FAINT, fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>RANK</div>
                            <div style={{ color: acc, fontSize: 15, fontWeight: 800 }}>{rankLabel}</div>
                        </div>
                    )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <Tile label="Win rate" value={`${overview.winRate}%`} color={parseFloat(overview.winRate) >= 25 ? GOOD : TEXT} />
                    <Tile label="Games" value={num(overview.played)} />
                    <Tile label="Avg points" value={overview.avgPoints} sub="per game" />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                    <Tile label="Wins" value={num(overview.wins)} color={GOOD} />
                    <Tile label="Losses" value={num(overview.losses)} color={BAD} />
                    <Tile label="Rounds won" value={num(rounds.round_wins)} color={WARN} />
                </div>
            </div>

            <Section title="PLACEMENT DISTRIBUTION" hint={`${num(placements)} finished game${placements === 1 ? '' : 's'}`} delay=".08s" rm={rm}>
                {placements === 0 ? (
                    <Empty>No placements recorded yet</Empty>
                ) : (
                    <div className="flex flex-col gap-[7px]">
                        <Bar label="🥇 1st" labelWidth={46} percentage={pct(first, placements)} color={WARN} right={num(first)} rm={rm} />
                        <Bar label="🥈 2nd" labelWidth={46} percentage={pct(second, placements)} color="#c3ccd6" right={num(second)} rm={rm} />
                        <Bar label="🥉 3rd" labelWidth={46} percentage={pct(third, placements)} color="#d08c4a" right={num(third)} rm={rm} />
                        <Bar label="4th" labelWidth={46} percentage={pct(fourth, placements)} color={BAD} right={num(fourth)} rm={rm} />
                    </div>
                )}
            </Section>

            <Section title="ROUND SNAPSHOT" delay=".12s" rm={rm}>
                <div className="grid grid-cols-3 gap-2">
                    <Tile label="Rounds" value={num(game.total_rounds)} />
                    <Tile
                        label="Avg placement"
                        value={rounds.avg_placement ? rounds.avg_placement.toFixed(2) : '—'}
                        color={rounds.avg_placement && rounds.avg_placement <= 2.5 ? GOOD : TEXT}
                    />
                    <Tile label="Points" value={num(game.points)} sub="total conceded" />
                </div>
            </Section>
        </>
    );
}

function PlayTab({ game, rounds, combos, headToHead, onOpponentClick, acc, soft, rm }) {
    const plays = game.total_plays || 0;
    const passes = game.total_passes || 0;
    const actions = plays + passes;
    const totalRounds = game.total_rounds || 0;

    const leadsWon = game.leads_won || 0;
    const leadAttempts = game.lead_attempts || 0;

    const comboList = [
        { label: 'Singles', value: combos.singles || 0, color: '#7fb2ff' },
        { label: 'Pairs', value: combos.pairs || 0, color: GOOD },
        { label: 'Triples', value: combos.triples || 0, color: WARN },
        { label: 'Straights', value: combos.straights || 0, color: '#a48fff' },
        { label: 'Flushes', value: combos.flushes || 0, color: '#ff9fd0' },
        { label: 'Full houses', value: combos.full_houses || 0, color: '#ffab6b' },
        { label: 'Quads', value: combos.quads || 0, color: BAD },
        { label: 'Str. flushes', value: combos.straight_flushes || 0, color: '#8fe3ff' },
    ];
    const comboTotal = comboList.reduce((sum, c) => sum + c.value, 0);
    const comboMax = comboList.reduce((max, c) => Math.max(max, c.value), 0);

    // Penalty severity comes from live round data when available (matches desktop).
    const penaltySource = rounds && rounds.total_rounds > 0 ? rounds : game;
    const penaltyRounds = penaltySource.total_rounds || 0;
    const penalty2x = penaltySource.penalty_2x_rounds || 0;
    const penalty3x = penaltySource.penalty_3x_rounds || 0;
    const penalty1x = penaltyRounds - penalty2x - penalty3x;

    return (
        <>
            <Section title="PLAY STYLE" delay=".04s" rm={rm}>
                <div className="grid grid-cols-3 gap-2">
                    <Tile label="Plays" value={num(plays)} color={GOOD} />
                    <Tile label="Passes" value={num(passes)} color={BAD} />
                    <Tile label="Pass rate" value={`${pct(passes, actions)}%`} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                    <Tile label="Plays / round" value={totalRounds > 0 ? (plays / totalRounds).toFixed(2) : '—'} />
                    <Tile label="Passes / round" value={totalRounds > 0 ? (passes / totalRounds).toFixed(2) : '—'} />
                    <Tile label="Rounds won" value={num(rounds.round_wins)} color={WARN} />
                </div>
            </Section>

            <Section title="LEAD CONTROL" hint="Plays that ended with everyone else passing" delay=".08s" rm={rm}>
                <div className="grid grid-cols-3 gap-2">
                    <Tile label="Leads won" value={num(leadsWon)} color={GOOD} />
                    <Tile label="Lead attempts" value={num(leadAttempts)} />
                    <Tile
                        label="Success rate"
                        value={`${pct(leadsWon, leadAttempts)}%`}
                        color={parseFloat(pct(leadsWon, leadAttempts)) >= 50 ? GOOD : TEXT}
                    />
                </div>
                <div className="mt-3">
                    <Meter
                        label="Control efficiency"
                        value={pct(leadsWon, actions)}
                        color={acc}
                        note="Leads won across all actions (plays + passes)."
                        rm={rm}
                    />
                </div>
            </Section>

            <Section title="HAND TYPES PLAYED" hint={comboTotal > 0 ? `${num(comboTotal)} hands` : undefined} delay=".12s" rm={rm}>
                {comboTotal === 0 ? (
                    <Empty>No hands played yet in this mode</Empty>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {comboList.map((c) => (
                            <div key={c.label} style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: '9px 10px' }}>
                                <div className="flex items-baseline justify-between">
                                    <div style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>{c.label}</div>
                                    <div style={{ color: FAINT, fontSize: 9, fontWeight: 700 }}>{pct(c.value, comboTotal, 0)}%</div>
                                </div>
                                <div style={{ color: c.value > 0 ? TEXT : FAINT, fontSize: 18, fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{num(c.value)}</div>
                                <div className="mt-[6px]" style={{ height: 5, borderRadius: 4, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                                    <div style={{ width: `${comboMax > 0 ? (c.value / comboMax) * 100 : 0}%`, height: '100%', borderRadius: 4, background: c.color, transition: rm ? undefined : 'width .5s ease' }} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            <Section title="PENALTY SEVERITY" hint="Cards left when someone else went out" delay=".16s" rm={rm}>
                {penaltyRounds === 0 ? (
                    <Empty>No scored rounds yet</Empty>
                ) : (
                    <div className="flex flex-col gap-[7px]">
                        <Bar label="1–9" labelWidth={46} percentage={pct(penalty1x, penaltyRounds)} color={GOOD} right={num(penalty1x)} rm={rm} />
                        <Bar label="10–12" labelWidth={46} percentage={pct(penalty2x, penaltyRounds)} color={WARN} right={num(penalty2x)} rm={rm} />
                        <Bar label="13" labelWidth={46} percentage={pct(penalty3x, penaltyRounds)} color={BAD} right={num(penalty3x)} rm={rm} />
                    </div>
                )}
            </Section>

            <Section title="HEAD TO HEAD" delay=".2s" rm={rm}>
                {(!headToHead || headToHead.length === 0) ? (
                    <Empty>Play against other people to build a record</Empty>
                ) : (
                    <div className="flex flex-col gap-2">
                        {headToHead.map((r) => {
                            const winRate = parseFloat(((r.win_rate || 0) * 100).toFixed(1));
                            const delta = r.games_played > 0 ? (r.total_placement_diff / r.games_played) : 0;
                            const ahead = delta > 0;
                            return (
                                <button
                                    key={r.opponent_name}
                                    onClick={() => onOpponentClick?.(r.opponent_name)}
                                    className="flex items-center gap-[10px] text-left"
                                    style={{ background: 'rgba(0,0,0,.34)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, padding: '9px 11px', cursor: onOpponentClick ? 'pointer' : 'default' }}
                                >
                                    <div style={{ width: 32, height: 32, borderRadius: 10, background: getAvatarTile(r.opponent_name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                                        {getAvatarEmoji(r.opponent_name)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="truncate" style={{ color: TEXT, fontWeight: 700, fontSize: 13 }}>{r.opponent_name}</div>
                                        <div style={{ color: FAINT, fontSize: 10, fontWeight: 600 }}>
                                            {r.games_played} game{r.games_played === 1 ? '' : 's'} · {ahead ? '+' : ''}{delta.toFixed(2)} avg placement
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                                            <span style={{ color: GOOD }}>{r.wins}</span>
                                            <span style={{ color: FAINT }}>–</span>
                                            <span style={{ color: BAD }}>{r.losses}</span>
                                        </div>
                                        <div style={{ color: winRate >= 50 ? GOOD : MUTED, fontSize: 10, fontWeight: 700 }}>{winRate.toFixed(1)}%</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </Section>

            {/* Accent glow marker keeps the tab visually anchored to the theme. */}
            <div className="pointer-events-none" style={{ height: 1, background: `linear-gradient(90deg,transparent,${soft},transparent)`, marginTop: 18 }} />
        </>
    );
}

// Deal strength vs outcome. Did you do better or worse than the cards you were
// dealt would predict? Bot rounds and human rounds stay on separate scopes:
// bot games are most of the play, so they are shown rather than hidden, but
// beating three bots is a different test from beating three humans.
function DealStrengthSection({ data, acc, rm }) {
    const [scope, setScope] = useState('all');

    if (!data || !data.all || data.all.rounds === 0) {
        return (
            <Section title="DEAL STRENGTH" hint="Your results against the cards you were dealt" delay=".16s" rm={rm}>
                <Empty>No scored rounds yet</Empty>
            </Section>
        );
    }

    const s = data[scope] || data.all;
    const scopes = [
        { id: 'all', label: 'All' },
        { id: 'vsBots', label: 'Bots' },
        { id: 'vsHumans', label: 'Humans' },
    ];
    const signed = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`;
    // Below the threshold the interval is wider than any plausible skill
    // effect, so Edge is not presented as a verdict.
    const edgeKnown = s.confidence !== 'insufficient';
    const edgeColor = !edgeKnown ? MUTED : s.winRateAboveExpected >= 0 ? GOOD : BAD;

    const chip = (on) => ({
        flex: 1,
        padding: '5px 0',
        borderRadius: 9,
        border: `1px solid ${on ? acc : 'rgba(255,255,255,.12)'}`,
        background: on ? `${acc}33` : 'rgba(0,0,0,.3)',
        color: on ? TEXT : MUTED,
        fontFamily: "'Outfit',sans-serif",
        fontWeight: 800,
        fontSize: 11,
        cursor: 'pointer',
    });

    return (
        <Section title="DEAL STRENGTH" hint="Your results against the cards you were dealt" delay=".16s" rm={rm}>
            <div className="flex gap-[6px]">
                {scopes.map((sc) => (
                    <button
                        key={sc.id}
                        onClick={() => setScope(sc.id)}
                        disabled={!data[sc.id] || data[sc.id].rounds === 0}
                        style={{ ...chip(scope === sc.id), opacity: !data[sc.id] || data[sc.id].rounds === 0 ? 0.35 : 1 }}
                    >
                        {sc.label}
                        {data[sc.id] ? ` ${data[sc.id].rounds}` : ''}
                    </button>
                ))}
            </div>

            {s.rounds === 0 ? (
                <div className="mt-3"><Empty>No rounds in this category yet</Empty></div>
            ) : (
                <>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <Tile
                            label="Deal luck"
                            value={`p${s.avgDealPercentile}`}
                            color={s.avgDealPercentile > 55 ? WARN : s.avgDealPercentile < 45 ? '#7fb2ff' : TEXT}
                            sub="p50 is average"
                        />
                        <Tile
                            label="Edge"
                            value={edgeKnown ? signed(s.winRateAboveExpected) : '—'}
                            color={edgeColor}
                            sub={edgeKnown ? `±${(s.winRateConfidence * 100).toFixed(1)}pp` : `needs ${data.minRoundsForEdge} rounds`}
                        />
                        <Tile label="Steals" value={`${s.steals}/${s.worstDeals}`} color={GOOD} sub="won on the worst deal" />
                        <Tile label="Squanders" value={`${s.squanders}/${s.bestDeals}`} color="#ffab6b" sub="lost with the best" />
                    </div>

                    {!edgeKnown && (
                        <div style={{ color: FAINT, fontSize: 10, fontWeight: 600, marginTop: 8 }}>
                            Single-round luck in Big 2 is large enough to swamp skill below {data.minRoundsForEdge} rounds.
                        </div>
                    )}

                    <div className="mt-3 flex flex-col gap-3">
                        {s.tiers.map((t) => {
                            // Fewer than 10 rounds is too little to draw a bar from.
                            if (t.rounds < 10) {
                                return (
                                    <div key={t.key} className="flex items-baseline justify-between">
                                        <div style={{ color: 'rgba(244,245,247,.7)', fontSize: 11, fontWeight: 700 }}>{t.label}</div>
                                        <div style={{ color: FAINT, fontSize: 11, fontWeight: 700 }}>{t.rounds} rounds</div>
                                    </div>
                                );
                            }
                            const beat = t.winRate >= t.expectedWinRate;
                            return (
                                <Meter
                                    key={t.key}
                                    label={t.label}
                                    value={(t.winRate * 100).toFixed(0)}
                                    color={beat ? GOOD : '#ffab6b'}
                                    note={`expected ${(t.expectedWinRate * 100).toFixed(0)}% from ${t.rounds} round${t.rounds === 1 ? '' : 's'}`}
                                    rm={rm}
                                />
                            );
                        })}
                    </div>

                    <div style={{ color: FAINT, fontSize: 10, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>
                        Deal luck is variance, not skill. Edge is how much more you win than those same
                        hands are worth — that part is you.
                    </div>
                </>
            )}
        </Section>
    );
}

function AdvancedTab({ tier3, handStrength, acc, rm, onArchetypeClick }) {
    const awareness = tier3?.cardAwareness;
    const variance = tier3?.variance;
    const behavioral = tier3?.behavioral;

    const totalDecisions = awareness?.total_decisions || 0;
    const optimal = awareness?.optimal_decisions || 0;
    const suboptimal = awareness?.suboptimal_decisions || 0;
    const optimalRate = pct(optimal, totalDecisions);
    const lateAccuracy = ratio(awareness?.late_game_accuracy);
    const riskyTotal = (awareness?.risky_plays_successful || 0) + (awareness?.risky_plays_failed || 0);
    const riskyRate = pct(awareness?.risky_plays_successful || 0, riskyTotal);

    const streak = variance?.current_streak || 0;
    const luckyWins = variance?.lucky_wins || 0;
    const skilledWins = variance?.skilled_wins || 0;
    const skillRate = pct(skilledWins, luckyWins + skilledWins);
    const varianceScore = ratio(variance?.variance_score);
    const consistency = ratio(variance?.consistency_rating);

    const archetype = behavioral?.player_archetype || 'Unknown';
    const archetypeColor = ARCHETYPE_COLORS[archetype] || TEXT;
    const known = !!archetypeDescriptions[archetype];

    return (
        <>
            <DealStrengthSection data={handStrength} acc={acc} rm={rm} />

            <Section title="DECISION EFFICIENCY" hint="Quality of your play choices" delay=".04s" rm={rm}>
                {totalDecisions === 0 ? (
                    <Empty>No decision data yet</Empty>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <Tile label="Decisions" value={num(totalDecisions)} />
                            <Tile label="Optimal" value={num(optimal)} color={GOOD} />
                            <Tile label="Suboptimal" value={num(suboptimal)} color="#ffab6b" />
                        </div>
                        <div className="mt-3 flex flex-col gap-3">
                            <Meter label="Optimal rate" value={optimalRate} color={parseFloat(optimalRate) >= 60 ? GOOD : acc} rm={rm} />
                            <Meter label="Late game accuracy" value={lateAccuracy} color={parseFloat(lateAccuracy) >= 50 ? GOOD : acc} note="Positional advantage in the final stages of a round." rm={rm} />
                            {riskyTotal > 0 && (
                                <Meter label="Risky play success" value={riskyRate} color={parseFloat(riskyRate) >= 50 ? GOOD : BAD} note={`${riskyTotal} risky play${riskyTotal === 1 ? '' : 's'} attempted.`} rm={rm} />
                            )}
                        </div>
                    </>
                )}
            </Section>

            <Section title="CONSISTENCY & STREAKS" delay=".08s" rm={rm}>
                {!variance ? (
                    <Empty>No variance data yet</Empty>
                ) : (
                    <>
                        <div
                            className="flex items-center justify-between"
                            style={{ background: 'rgba(0,0,0,.34)', border: `1px solid ${streak > 0 ? `${GOOD}55` : streak < 0 ? `${BAD}55` : 'rgba(255,255,255,.09)'}`, borderRadius: 14, padding: '11px 13px' }}
                        >
                            <div style={{ color: FAINT, fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>CURRENT STREAK</div>
                            <div style={{ color: streak > 0 ? GOOD : streak < 0 ? BAD : MUTED, fontSize: 16, fontWeight: 800 }}>
                                {streak > 0
                                    ? `${streak} win${streak === 1 ? '' : 's'} 🔥`
                                    : streak < 0
                                        ? `${Math.abs(streak)} loss${streak === -1 ? '' : 'es'}`
                                        : 'None'}
                            </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <Tile label="Longest win streak" value={num(variance.longest_win_streak)} color={GOOD} />
                            <Tile label="Longest loss streak" value={num(variance.longest_loss_streak)} color={BAD} />
                            <Tile label="Skilled wins" value={num(skilledWins)} color={GOOD} sub="earned by play" />
                            <Tile label="Lucky wins" value={num(luckyWins)} color={WARN} sub="favourable deals" />
                        </div>
                        <div className="mt-3 flex flex-col gap-3">
                            <Meter label="Skill rate" value={skillRate} color={parseFloat(skillRate) >= 70 ? GOOD : acc} rm={rm} />
                            <Meter
                                label="Consistency"
                                value={consistency}
                                color={parseFloat(consistency) >= 70 ? GOOD : parseFloat(consistency) >= 50 ? WARN : acc}
                                note="Higher is better — how reliably you perform."
                                rm={rm}
                            />
                            <Meter
                                label="Variance"
                                value={varianceScore}
                                color={parseFloat(varianceScore) < 30 ? GOOD : parseFloat(varianceScore) < 50 ? WARN : BAD}
                                note="Lower is better — swing between good and bad games."
                                rm={rm}
                            />
                        </div>
                    </>
                )}
            </Section>

            <Section title="PLAYER PROFILE" hint="Play style classified from your decisions" delay=".12s" rm={rm}>
                {!behavioral ? (
                    <Empty>No behavioural data yet</Empty>
                ) : (
                    <>
                        <button
                            onClick={() => known && onArchetypeClick(archetype)}
                            disabled={!known}
                            className="w-full"
                            style={{ background: 'rgba(0,0,0,.34)', border: `1px solid ${known ? `${archetypeColor}55` : 'rgba(255,255,255,.09)'}`, borderRadius: 14, padding: '13px 13px', cursor: known ? 'pointer' : 'default', fontFamily: "'Outfit',sans-serif" }}
                        >
                            <div style={{ color: FAINT, fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>ARCHETYPE</div>
                            <div style={{ color: archetypeColor, fontSize: 26, fontWeight: 800, lineHeight: 1.2, marginTop: 2 }}>{archetype}</div>
                            {known && <div style={{ color: FAINT, fontSize: 10, fontWeight: 600, marginTop: 2 }}>Tap for strengths & pitfalls</div>}
                        </button>

                        <div className="mt-3 flex flex-col gap-3">
                            <Meter label="Aggression" value={ratio(behavioral.aggression_score)} color={parseFloat(ratio(behavioral.aggression_score)) > 70 ? BAD : parseFloat(ratio(behavioral.aggression_score)) < 40 ? '#7fb2ff' : acc} rm={rm} />
                            <Meter label="Risk" value={ratio(behavioral.risk_score)} color={parseFloat(ratio(behavioral.risk_score)) > 60 ? '#ffab6b' : acc} rm={rm} />
                            <Meter label="Adaptability" value={ratio(behavioral.adaptability_score)} color={parseFloat(ratio(behavioral.adaptability_score)) > 70 ? GOOD : acc} rm={rm} />
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <Tile label="Early game" value={behavioral.early_game_style || 'Neutral'} />
                            <Tile label="Late game" value={behavioral.late_game_style || 'Neutral'} />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {Object.keys(archetypeDescriptions).map((a) => (
                                <button
                                    key={a}
                                    onClick={() => onArchetypeClick(a)}
                                    style={{ background: 'rgba(0,0,0,.3)', border: `1px solid ${ARCHETYPE_COLORS[a]}44`, borderRadius: 9, padding: '5px 9px', color: ARCHETYPE_COLORS[a], fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                                >{a}</button>
                            ))}
                        </div>
                    </>
                )}
            </Section>
        </>
    );
}

export default StatsV2;
