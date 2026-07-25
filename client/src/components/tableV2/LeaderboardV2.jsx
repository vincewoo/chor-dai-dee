import { useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 mobile leaderboard (global only — no friends system server-side). Mirrors
// the "Leaderboard v2" mockup: podium for the top 3, a scrollable rank list, and
// a pinned "YOU" row. Data comes from /api/leaderboard via the Leaderboard
// container; no trend arrows (no historical delta stored).
function LeaderboardV2({ data = [], mode, onSetMode, user, loading, error, onBack, onPlayerClick }) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();

    const ranked = useMemo(
        () => data.map((p, i) => ({ ...p, rank: i + 1 })),
        [data]
    );
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
            className="relative min-h-screen-safe w-full overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div className="absolute pointer-events-none" style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }} />
            <div className="absolute pointer-events-none select-none" style={{ top: 200, left: -46, fontSize: 190, lineHeight: 1, color: 'rgba(255,255,255,.035)', transform: 'rotate(-14deg)' }}>♣</div>
            <div className="absolute pointer-events-none select-none" style={{ top: 540, right: -52, fontSize: 210, lineHeight: 1, color: 'rgba(255,255,255,.03)', transform: 'rotate(12deg)' }}>♦</div>

            <div className="relative z-10 mx-auto flex min-h-screen-safe max-w-[440px] flex-col px-[22px] pb-[104px] pt-[18px]">
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
                                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', minWidth: 44, textAlign: 'right' }}>{fmt(r.rating_display)}</div>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Pinned "you" row */}
            {me && (
                <div
                    className="absolute inset-x-0 z-20 mx-auto flex max-w-[440px] items-center gap-[11px] px-[22px]"
                    style={{ bottom: 26 }}
                >
                    <div
                        className="flex w-full items-center gap-[11px]"
                        style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.6),rgba(0,0,0,.42))', border: `1px solid ${acc}66`, borderRadius: 16, padding: '11px 13px', boxShadow: `0 12px 28px rgba(0,0,0,.5),0 0 18px ${soft}` }}
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
    );
}

export default LeaderboardV2;
