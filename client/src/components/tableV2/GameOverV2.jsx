import { useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import MaxBotsChip from './MaxBotsChip';
import DealLuckPanel from './DealLuckPanel';

// v2 mobile game-over / final-results screen. Mirrors the "Game Over v2"
// mockup. Standings are derived from the game_over payload; shadow-rating
// changes stay server-side. Post-game action buttons are
// passed as children (all wiring stays in GameRoom).
function GameOverV2({ gameOver, myName, maxBots = false, children }) {
    const { acc, accGrad, soft, rm } = useTableTheme();
    // Standings show each player's chosen avatar; avatarsVersion re-runs the
    // memo below once the lookup lands.
    const avatarsVersion = useAvatars((gameOver?.scores || []).map(s => s.name));

    const rows = useMemo(() => {
        const scores = (gameOver?.scores || []).slice().sort((a, b) => a.cumulativeScore - b.cumulativeScore);
        return scores.map((s, i) => ({
            key: s.id || s.name,
            pos: i + 1,
            name: s.name,
            isBot: s.isBot,
            isYou: s.name === myName,
            winner: i === 0,
            animal: getAvatarEmoji(s.name),
            tile: getAvatarTile(s.name),
            total: s.cumulativeScore,
            // Mean percentile of the game's deals. A number rather than a tier
            // label because the label is nearly constant once averaged -- see
            // Room.describeDealLuck.
            dealPercentile: gameOver?.dealLuck?.[s.name]?.avgPercentile ?? null,
            delay: `${(0.35 + i * 0.09).toFixed(2)}s`,
        }));
        // avatarsVersion isn't read here, but it changes when a looked-up
        // avatar lands and must invalidate the cached rows.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameOver, myName, avatarsVersion]);

    const you = rows.find(r => r.isYou);
    const winnerRow = rows[0];
    const youWon = you?.winner;
    const isDragon = gameOver?.isDragonWin;

    const heroAnimal = winnerRow?.animal || '🐯';
    const heroTile = winnerRow?.tile || 'linear-gradient(145deg,#fff7e8,#ede3cd)';
    const heroTitle = isDragon
        ? '🐉 Dragon win!'
        : youWon ? 'You win the game!' : `${winnerRow?.name || 'Winner'} wins!`;

    const anim = (a) => (rm ? undefined : a);

    const confetti = useMemo(() => {
        if (rm) return [];
        return Array.from({ length: 22 }, (_, i) => ({
            left: `${(i * 37) % 100}%`,
            bg: ['#6ee7a8', '#e05252', '#5aa9e6', '#f4f5f7', '#f0c75e'][i % 5],
            delay: `${((i * 0.13) % 1.6).toFixed(2)}s`,
            dur: `${(2 + (i % 5) * 0.35).toFixed(2)}s`,
        }));
    }, [rm]);

    return (
        <div
            // Fixed, like RoundCelebration: a full-screen takeover should be
            // pinned to the viewport rather than to whatever mounted it.
            className="fixed inset-0 z-50 overflow-y-auto font-sans"
            style={{
                background: 'radial-gradient(ellipse 120% 90% at 50% 32%,#1e6141 0%,#154930 46%,#0d3520 78%,#082515 100%)',
                fontFamily: "'Outfit',sans-serif",
                '--cdd-acc': acc,
                '--cdd-acc-soft': soft,
            }}
        >
            <div
                className="absolute pointer-events-none"
                style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 560, height: 380, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }}
            />
            {confetti.map((p, i) => (
                <div
                    key={i}
                    className="absolute pointer-events-none"
                    style={{ top: -24, left: p.left, width: 9, height: 14, borderRadius: 2, background: p.bg, zIndex: 5, animation: `cddConfetti ${p.dur} ${p.delay} linear infinite` }}
                />
            ))}

            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-6 pt-[52px] md:max-w-[560px] md:justify-center">
                {/* Winner hero */}
                <div className="flex flex-col items-center gap-2">
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 800, letterSpacing: 2.5, ...anim({ animation: 'cddToast .4s ease-out both' }) }}>
                        GAME OVER · {gameOver?.roundNumber || 0} ROUNDS
                    </div>
                    {/* Gated on a bot actually having played, exactly as the
                        activity feed gates it: max difficulty is a room setting,
                        so a table that filled with four humans carries it with
                        nothing to apply it to. This is the moment the badge is
                        for -- the feed is where you go to find it again. */}
                    {maxBots && rows.some(r => r.isBot) && (
                        <div style={anim({ animation: 'cddToast .4s .05s ease-out both' })}>
                            <MaxBotsChip />
                        </div>
                    )}
                    <div style={{ position: 'relative', marginTop: 6, ...anim({ animation: 'cddPop .5s .1s cubic-bezier(.2,.8,.3,1.3) both' }) }}>
                        <div style={{ fontSize: 30, position: 'absolute', top: -24, left: '50%', transform: 'translateX(-50%)' }}>👑</div>
                        <div style={{ width: 96, height: 96, borderRadius: 26, background: heroTile, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, boxShadow: `0 0 44px ${soft},0 18px 40px rgba(0,0,0,.5)`, position: 'relative', overflow: 'hidden' }}>
                            {isDragon ? '🐉' : heroAnimal}
                            {!rm && <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)', width: '40%', animation: 'cddShine 2.6s 1s ease-in-out infinite' }} />}
                        </div>
                    </div>
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 30, textAlign: 'center', ...anim({ animation: 'cddPop .5s .2s cubic-bezier(.2,.8,.3,1.3) both' }) }}>{heroTitle}</div>
                    {you && (
                        <div style={{ display: 'flex', gap: 8, ...anim({ animation: 'cddToast .4s .3s ease-out both' }) }}>
                            <div style={{ background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 13, padding: '5px 13px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                                {youWon ? '🏆 ' : ''}{you.total} pts{youWon ? ' · lowest' : ''}
                            </div>
                            <div style={{ background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.2)', color: 'rgba(244,245,247,.85)', fontWeight: 800, fontSize: 13, padding: '5px 13px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                                #{you.pos} of {rows.length}
                            </div>
                        </div>
                    )}
                </div>

                {/* Final standings */}
                <div className="mt-8">
                    <div className="mb-[10px] flex items-center gap-2">
                        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.12)' }} />
                        <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>FINAL STANDINGS</div>
                        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.12)' }} />
                    </div>
                    <div className="flex flex-col gap-[9px]">
                        {rows.map((r) => (
                            <div
                                key={r.key}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    background: r.winner ? 'linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03))' : 'rgba(0,0,0,.3)',
                                    border: `1px solid ${r.winner ? acc + '77' : 'rgba(255,255,255,.09)'}`,
                                    borderRadius: 16, padding: '11px 14px',
                                    boxShadow: r.winner ? `0 0 22px ${soft}` : 'none',
                                    ...anim({ animation: `cddToast .4s ${r.delay} ease-out both` }),
                                }}
                            >
                                <div style={{ width: 22, textAlign: 'center', color: r.winner ? acc : 'rgba(244,245,247,.45)', fontWeight: 800, fontSize: 15 }}>{r.pos}</div>
                                <div style={{ width: 42, height: 42, borderRadius: 13, background: r.tile, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{r.animal}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 14 }}>
                                        {r.name}{r.isYou ? ' (You)' : ''}{r.isBot ? ' · bot' : ''}
                                    </div>
                                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 600 }}>
                                        {r.winner ? 'Winner' : `${r.pos}${ordinalSuffix(r.pos)} place`}
                                        {r.dealPercentile != null
                                            ? ` · deals ${r.dealPercentile}${ordinalSuffix(r.dealPercentile)} percentile`
                                            : ''}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 17 }}>{r.total} <span style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>pts</span></div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <DealLuckPanel
                        rows={rows}
                        dealLuck={gameOver?.dealLuck}
                        acc={acc}
                        rm={rm}
                    />
                </div>

                {/* Actions slot (buttons supplied by GameRoom) */}
                <div className="mt-auto flex flex-col items-center gap-[10px] pt-8">
                    {children}
                </div>
            </div>
        </div>
    );
}

function ordinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

export default GameOverV2;
