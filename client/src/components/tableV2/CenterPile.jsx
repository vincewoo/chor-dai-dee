import { memo } from 'react';
import PileCardGlyph from './PileCardGlyph';
import { describeHand } from '../../theme/tableTheme';
import { MOBILE_LAYOUT } from './layout';

// Offsets per depth-from-top (0 = newest, on top). Translations scale with the
// pile; rotations do not, so the stack keeps the same silhouette at any size.
const OFF = [
    { dx: 0, dy: 0, r: 0 },
    { dx: -54, dy: -20, r: -9 },
    { dx: 56, dy: -16, r: 8 },
    { dx: -30, dy: 22, r: -5 },
    { dx: 34, dy: 24, r: 6 },
];

// The mobile pile frame, used when no explicit frame is passed — the single
// source of truth in layout.js, not a hand-mirrored copy that could drift.
const DEFAULT_FRAME = MOBILE_LAYOUT.pile.frame;

// Maps a relative seat offset (0=self bottom, 1=right, 2=top, 3=left) to a fly-in keyframe.
const FLY = { 0: 'cddFlyUp', 1: 'cddFlyRight', 2: 'cddFlyDown', 3: 'cddFlyLeft' };

// The center pile: layered stack of the current trick's last ~5 plays, a label
// chip for the top play, a "tap to review" hint, and the control toast.
const CenterPile = memo(function CenterPile({
    pilePlays,      // oldest→newest non-pass entries of current trick (<=5)
    lastPlayedHand, // authoritative top play from gameState
    players,
    viewerIndex,
    fourColor,
    pusoyMode,
    accGrad,
    soft,
    rm,
    logCount,       // number of entries in the round log
    showControlToast,
    onOpenLog,
    hasLog,
    frame,          // positioning + size of the pile well; defaults to mobile
    scale = 1,      // card + fan scale
    stackHeight = 118,
}) {
    // Resolve label from authoritative lastPlayedHand.
    let label = '';
    if (lastPlayedHand) {
        const owner = players?.find(p => p.id === lastPlayedHand.playerId);
        label = `${owner ? owner.name : ''}${owner ? ' · ' : ''}${describeHand(lastPlayedHand.type, lastPlayedHand.cards)}`;
    }

    const stack = pilePlays.slice(-5);
    const topIndex = stack.length - 1;

    return (
        <div
            onClick={hasLog ? onOpenLog : undefined}
            style={{
                position: 'absolute', ...(frame || DEFAULT_FRAME),
                background: 'linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.02))',
                border: '1px solid rgba(255,255,255,.13)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.1),inset 0 -18px 30px rgba(0,0,0,.25),0 18px 36px rgba(0,0,0,.28)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                zIndex: 5, cursor: hasLog ? 'pointer' : 'default',
            }}
        >
            {stack.length > 0 && (
                <>
                    {/* Pinned to the well's top edge, out of the flex flow, so
                        the card fan (whose older plays drift upward via OFF's
                        negative dy) can never slide underneath it — the label
                        used to render on top of the cards it was naming. */}
                    <div style={{
                        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,.45)', borderRadius: 8, padding: '4px 12px',
                        color: 'rgba(244,245,247,.9)', fontSize: Math.round(12 * scale), fontWeight: 700, zIndex: 8,
                        maxWidth: 'calc(100% - 24px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                        {label}
                    </div>
                    {/* marginTop reserves the label band plus the fan's upward
                        drift (max |dy| is 20 at scale 1), keeping the cards
                        clear of the label on the shortest wells. */}
                    <div style={{ position: 'relative', width: '100%', height: stackHeight, marginTop: Math.round(26 * scale) }}>
                        {stack.map((play, idx) => {
                            const back = topIndex - idx; // 0 = top
                            const isTop = back === 0;
                            const o = OFF[back] || OFF[4];
                            // Fly-in direction is relative to the seat the viewer
                            // occupies (own seat, or the watched seat when spectating).
                            const relOffset = viewerIndex === -1 ? 2 : (players.findIndex(p => p.id === play.playerId) - viewerIndex + 4) % 4;
                            const flyName = FLY[relOffset] || 'cddFlyDown';
                            const cards = play.cards || [];
                            return (
                                <div
                                    key={`${play.trick}-${play.playOrder}`}
                                    style={{
                                        position: 'absolute', left: '50%', top: '50%',
                                        transform: `translate(-50%,-50%) translate(${o.dx * scale}px,${o.dy * scale}px) rotate(${o.r}deg) scale(${isTop ? 1 : 0.82})`,
                                        opacity: isTop ? 1 : 0.6,
                                        filter: isTop ? 'none' : 'brightness(.75)',
                                        zIndex: idx + 1,
                                        transition: rm ? 'none' : 'transform .18s ease',
                                    }}
                                >
                                    <div style={{ display: 'flex' }}>
                                        {cards.map((c, i) => (
                                            <div
                                                key={`${c.rank}-${c.suit}`}
                                                style={{
                                                    marginLeft: i === 0 ? 0 : -22 * scale,
                                                    transform: `rotate(${(i - (cards.length - 1) / 2) * 5}deg)`,
                                                }}
                                            >
                                                {/* The fly-in gets its own element: the keyframes end at
                                                    `transform: none`, which would otherwise flatten the fan
                                                    rotation above. It is keyed to this play's mount rather
                                                    than to `isTop`, so a play that lands within the stagger
                                                    (i * 80ms) can't cancel the cards still waiting to fly. */}
                                                <div
                                                    style={{
                                                        animation: rm
                                                            ? 'none'
                                                            : `${flyName} .5s cubic-bezier(.2,.8,.3,1.1) ${i * 80}ms both`,
                                                    }}
                                                >
                                                    <PileCardGlyph rank={c.rank} suit={c.suit} fourColor={fourColor} pusoyMode={pusoyMode} size="pile" scale={scale} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {hasLog && (
                <div style={{
                    position: 'absolute', bottom: 8, right: 12, zIndex: 9,
                    background: 'rgba(0,0,0,.42)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8,
                    padding: '3px 9px', color: 'rgba(244,245,247,.65)', fontSize: 10, fontWeight: 700,
                }}>
                    {logCount} · tap to review
                </div>
            )}

            {showControlToast && (
                <div style={{
                    background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 14,
                    padding: '8px 18px', borderRadius: 12, boxShadow: `0 10px 24px ${soft}`,
                    animation: rm ? 'none' : 'cddPop .45s cubic-bezier(.2,.8,.3,1.2)',
                    position: 'relative', zIndex: 9,
                }}>
                    You have control — lead anything
                </div>
            )}
        </div>
    );
});

export default CenterPile;
