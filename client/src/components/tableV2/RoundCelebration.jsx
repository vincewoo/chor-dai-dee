import { useMemo } from 'react';
import logoImage from '../../assets/chor-dai-dee-logo.webp';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';

// Full-screen round-over celebration with confetti and ranked results.
function RoundCelebration({ roundResult, pointThreshold, onNextRound, acc, accGrad, soft, rm }) {
    const confetti = useMemo(() => (
        Array.from({ length: 26 }, (_, i) => ({
            left: (i * 37 % 100) + '%',
            bg: [acc, '#e05252', '#5aa9e6', '#f4f5f7', '#f0c75e'][i % 5],
            delay: (i * 0.13 % 1.6).toFixed(2) + 's',
            dur: (2 + (i % 5) * 0.35).toFixed(2) + 's',
        }))
    ), [acc]);

    if (!roundResult) return null;

    const rows = [...(roundResult.scores || [])].sort((a, b) => a.cumulativeScore - b.cumulativeScore);
    const nextRoundNum = (roundResult.roundNumber || 0) + 1;

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'radial-gradient(ellipse 120% 90% at 50% 32%,#1e6141 0%,#154930 46%,#0d3520 78%,#082515 100%)',
            display: 'flex', flexDirection: 'column', padding: '26px 22px 22px', overflow: 'hidden',
        }}>
            {!rm && confetti.map((p, i) => (
                <div key={i} style={{
                    position: 'absolute', top: -24, left: p.left, width: 9, height: 14, borderRadius: 2,
                    background: p.bg, animation: `cddConfetti ${p.dur} ${p.delay} linear infinite`,
                }} />
            ))}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 4, position: 'relative' }}>
                <img
                    src={logoImage}
                    alt="Chor Dai Dee"
                    style={{ width: 78, height: 78, filter: `drop-shadow(0 0 24px ${soft})`, animation: rm ? 'none' : 'cddPop .5s cubic-bezier(.2,.8,.3,1.3)' }}
                />
                <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 27, textAlign: 'center', animation: rm ? 'none' : 'cddPop .5s .08s cubic-bezier(.2,.8,.3,1.3) both' }}>
                    {roundResult.roundWinner?.name} won the round!
                </div>
                <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 800, letterSpacing: 2.5 }}>
                    ROUND {roundResult.roundNumber} · RESULTS
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, flex: 1, position: 'relative', overflowY: 'auto' }}>
                {rows.map((r, i) => {
                    const winner = r.isRoundWinner;
                    const hasPenaltyMult = !winner && r.roundPoints > r.cardsLeft;
                    const detail = winner
                        ? 'Went out first · no penalty'
                        : `${r.cardsLeft} ${r.cardsLeft === 1 ? 'card' : 'cards'} left in hand${hasPenaltyMult ? ' · penalty ×' : ''}`;
                    return (
                        <div
                            key={r.name}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                background: winner ? 'linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03))' : 'rgba(255,255,255,.04)',
                                border: `1px solid ${winner ? `${acc}77` : 'rgba(255,255,255,.09)'}`,
                                borderRadius: 16, padding: '12px 14px',
                                boxShadow: winner ? `0 0 22px ${soft}` : 'none',
                                animation: rm ? 'none' : `cddToast .4s ${(0.08 + i * 0.09).toFixed(2)}s ease-out both`,
                            }}
                        >
                            <div style={{ width: 22, textAlign: 'center', color: i === 0 ? acc : 'rgba(244,245,247,.45)', fontWeight: 800, fontSize: 15 }}>{i + 1}</div>
                            <div style={{ width: 42, height: 42, borderRadius: 13, background: getAvatarTile(r.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                                {getAvatarEmoji(r.name)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 14 }}>
                                    {r.name} {i === 0 && <span style={{ fontSize: 13 }}>👑</span>}
                                </div>
                                <div style={{ color: 'rgba(244,245,247,.55)', fontSize: 11, fontWeight: 600, marginTop: 1 }}>{detail}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                <div style={{
                                    display: 'inline-block',
                                    background: winner ? accGrad : 'rgba(224,67,79,.16)',
                                    color: winner ? '#0b0d10' : '#ff8d96',
                                    fontWeight: 800, fontSize: 12, padding: '3px 9px', borderRadius: 8,
                                }}>
                                    +{r.roundPoints}
                                </div>
                                <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 17, marginTop: 3, whiteSpace: 'nowrap' }}>
                                    {r.cumulativeScore} <span style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>pts</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ textAlign: 'center', color: 'rgba(244,245,247,.45)', fontSize: 12, fontWeight: 600, margin: '12px 0 14px', position: 'relative' }}>
                Lowest score wins · game ends at {pointThreshold || 100} pts
            </div>
            <button
                onClick={onNextRound}
                style={{
                    padding: '15px 0', borderRadius: 14, border: 'none', background: accGrad, color: '#0b0d10',
                    fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 17, cursor: 'pointer',
                    boxShadow: `0 10px 24px ${soft},inset 0 1px 0 rgba(255,255,255,.3)`, position: 'relative',
                }}
            >
                Start Round {nextRoundNum}
            </button>
        </div>
    );
}

export default RoundCelebration;
