import { useEffect, useMemo, useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import {
    PUBLIC_RANK_ORDER,
    publicRankColor,
    publicRankIndex,
} from '../../constants/publicRank';
import RankBadge from './RankBadge';
import SuitWatermark from './SuitWatermark';

// Full-screen celebration for the one thing in this game that takes weeks to
// earn. It runs BEFORE the final scoreboard (GameRoom holds that back until the
// rank result lands), so it gets the moment to itself rather than competing
// with standings.
//
// The animation is a three-beat sequence rather than one long transition: the
// old badge leaves, the impact is drawn as flash + shockwave + sparks, and the
// new badge lands. Beats are React state, not one keyframe, because the two
// badges are different components and only one is mounted at a time.
const BEATS = {
    // Old rank sits on screen long enough to be read...
    rise: 1150,
    // ...then leaves, and the new one lands through the burst.
    burst: 1650,
    // Ladder + button arrive once the badge has settled, so nothing competes
    // with the landing.
    settle: 2500,
};
// Long enough to take it in, short enough that nobody feels held hostage. The
// screen is dismissible from `settle` onward and the scoreboard is behind it.
const AUTO_ADVANCE_MS = 7000;

const SPARK_COUNT = 16;
// The badge's own box inside the stage. Sized for the larger (new) badge so the
// smaller outgoing one centres on the same point; the shockwave and sparks are
// centred on the stage, which is this box plus the label line.
const BADGE_BOX = 176;
const STAGE_HEIGHT = 218;

function RankPromotionSplash({
    playerName,
    rank,
    previousRank,
    change = 'promoted',
    onDone,
}) {
    const { acc, accGrad, rm } = useTableTheme();
    // The hero avatar is the player's own chosen one; the lookup may land after
    // first paint, and this re-renders when it does.
    useAvatars(useMemo(() => [playerName], [playerName]));

    // Reduced motion skips straight to the settled state: no badge swap, no
    // burst, and the button is available immediately.
    const [beat, setBeat] = useState(rm ? 'settled' : 'before');

    useEffect(() => {
        if (rm) return undefined;
        const timers = [
            setTimeout(() => setBeat('rising'), BEATS.rise),
            setTimeout(() => setBeat('landed'), BEATS.burst),
            setTimeout(() => setBeat('settled'), BEATS.settle),
        ];
        return () => timers.forEach(clearTimeout);
    }, [rm]);

    // Auto-advance so an unattended game still reaches the scoreboard. Started
    // from mount, not from `settled`, so a player who walks away is not held on
    // this screen for the sum of both.
    useEffect(() => {
        const timer = setTimeout(() => onDone?.(), AUTO_ADVANCE_MS);
        return () => clearTimeout(timer);
    }, [onDone]);

    const isPlacement = change === 'placed';
    const color = publicRankColor(rank);
    const newIndex = publicRankIndex(rank);
    const showOldBadge = beat === 'before' || beat === 'rising';
    // A placement has no prior rank to animate away from — the player was
    // Unranked, which has no badge worth showing — so it goes straight to the
    // landing and the ladder carries the "where you start" story instead.
    const hasPrevious = !isPlacement && publicRankIndex(previousRank) >= 0;

    const sparks = useMemo(() => {
        if (rm) return [];
        return Array.from({ length: SPARK_COUNT }, (_, i) => {
            const angle = (i / SPARK_COUNT) * Math.PI * 2;
            const reach = 130 + (i % 4) * 34;
            return {
                x: `${Math.round(Math.cos(angle) * reach)}px`,
                y: `${Math.round(Math.sin(angle) * reach)}px`,
                dur: `${(0.7 + (i % 3) * 0.16).toFixed(2)}s`,
                size: 5 + (i % 3) * 2,
            };
        });
    }, [rm]);

    const anim = (value) => (rm ? undefined : value);

    return (
        <div
            // Fixed and above the game-over screen: this is a full-screen
            // takeover, pinned to the viewport rather than to whatever mounted
            // it, exactly as RoundCelebration and GameOverV2 are.
            className="fixed inset-0 z-[120] overflow-hidden font-sans"
            style={{
                background:
                    'radial-gradient(ellipse 120% 90% at 50% 40%,#123f2a 0%,#0d3220 44%,#08210f 76%,#050d07 100%)',
                fontFamily: "'Outfit',sans-serif",
            }}
        >
            {/* Background rays, tinted by the rank being earned. Slow enough to
                read as light rather than as spin. */}
            {!rm && (
                <div
                    className="absolute pointer-events-none"
                    style={{
                        top: '50%',
                        left: '50%',
                        width: 1400,
                        height: 1400,
                        marginTop: -700,
                        marginLeft: -700,
                        opacity: beat === 'before' ? 0.18 : 0.42,
                        transition: 'opacity .8s ease-out',
                        background: `repeating-conic-gradient(from 0deg at 50% 50%, ${color}2e 0deg 7deg, transparent 7deg 21deg)`,
                        animation: 'cddRankRays 44s linear infinite',
                    }}
                />
            )}
            <div
                className="absolute pointer-events-none"
                style={{
                    top: '50%',
                    left: '50%',
                    width: 620,
                    height: 620,
                    marginTop: -330,
                    marginLeft: -310,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${color}3d, transparent 68%)`,
                    ...anim({ animation: 'cddRankHalo 3.4s ease-in-out infinite' }),
                }}
            />
            <SuitWatermark suit="S" size={300} opacity={0.03} style={{ top: -60, left: -80 }} />
            <SuitWatermark suit="D" size={260} opacity={0.03} rotate={12} style={{ bottom: -50, right: -60 }} />

            {/* Impact flash, one shot at the moment the badge lands. */}
            {!rm && beat === 'landed' && (
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: '#fff', animation: 'cddRankFlash .5s ease-out both' }}
                />
            )}

            <div className="relative z-10 mx-auto flex h-full w-full max-w-[440px] flex-col items-center justify-center px-[22px] pb-safe-6 pt-6 md:max-w-[560px]">
                <div
                    style={{
                        color: 'rgba(244,245,247,.55)',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 3,
                        ...anim({ animation: 'cddToast .45s ease-out both' }),
                    }}
                >
                    {isPlacement ? 'PLACEMENT COMPLETE' : 'RANK UP'}
                </div>

                {/* Who this is happening to. Avatar + name, so the screen is
                    unmistakably about the player and not about the table. */}
                <div
                    className="mt-4 flex flex-col items-center gap-2"
                    style={anim({ animation: 'cddPop .5s .08s cubic-bezier(.2,.8,.3,1.3) both' })}
                >
                    <div
                        style={{
                            width: 78,
                            height: 78,
                            borderRadius: 22,
                            background: getAvatarTile(playerName),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 44,
                            boxShadow: `0 0 34px ${color}55, 0 14px 30px rgba(0,0,0,.5)`,
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                        {getAvatarEmoji(playerName)}
                        {!rm && (
                            <span
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: '40%',
                                    background:
                                        'linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)',
                                    animation: 'cddShine 2.6s 1.2s ease-in-out infinite',
                                }}
                            />
                        )}
                    </div>
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 20 }}>{playerName}</div>
                </div>

                {/* The badge stage. Fixed height so the swap does not reflow the
                    column under it — the ladder and button must not jump when
                    the new badge lands. */}
                <div
                    className="relative mt-5 flex w-full items-center justify-center"
                    style={{ height: STAGE_HEIGHT }}
                >
                    {/* Both of these are anchored to the centre of the stage
                        explicitly. An `absolute` child of a flex container with
                        no offsets falls back to its static position, which for
                        a burst that has to originate at the badge is not a
                        position worth depending on. */}
                    {!rm && beat === 'landed' && (
                        <div
                            className="absolute pointer-events-none"
                            style={{
                                // Centred on the BADGE, not on the stage: the
                                // stage is taller by its label line.
                                top: BADGE_BOX / 2,
                                left: '50%',
                                width: 210,
                                height: 210,
                                marginTop: -105,
                                marginLeft: -105,
                                borderRadius: '50%',
                                border: `8px solid ${color}`,
                                animation: 'cddRankShock .75s cubic-bezier(.2,.7,.3,1) both',
                            }}
                        />
                    )}
                    {!rm && beat === 'landed' && sparks.map((s, i) => (
                        <div
                            key={i}
                            className="absolute pointer-events-none"
                            style={{
                                top: BADGE_BOX / 2,
                                left: '50%',
                                width: s.size,
                                height: s.size,
                                marginTop: -s.size / 2,
                                marginLeft: -s.size / 2,
                                borderRadius: '50%',
                                background: i % 3 === 0 ? '#fff' : color,
                                boxShadow: `0 0 10px ${color}`,
                                '--cdd-spark-x': s.x,
                                '--cdd-spark-y': s.y,
                                animation: `cddRankSpark ${s.dur} cubic-bezier(.15,.7,.3,1) both`,
                            }}
                        />
                    ))}

                    {/* Both badges hang in the same fixed-height box, so the
                        two are centred on the same point despite being
                        different sizes with differently sized labels. Letting
                        the columns centre themselves put the old badge visibly
                        lower than the one replacing it. */}
                    {showOldBadge && hasPrevious ? (
                        <div
                            className="absolute inset-0 flex flex-col items-center"
                            style={anim(
                                beat === 'rising'
                                    ? { animation: 'cddRankRise .55s ease-in both' }
                                    : { animation: 'cddPop .5s .18s cubic-bezier(.2,.8,.3,1.3) both' }
                            )}
                        >
                            <div className="flex items-center justify-center" style={{ height: BADGE_BOX }}>
                                <RankBadge rank={previousRank} size={126} dim />
                            </div>
                            <div
                                style={{
                                    color: 'rgba(244,245,247,.5)',
                                    fontWeight: 800,
                                    fontSize: 13,
                                    letterSpacing: 2,
                                }}
                            >
                                {previousRank}
                            </div>
                        </div>
                    ) : showOldBadge ? null : (
                        <div
                            className="absolute inset-0 flex flex-col items-center"
                            style={anim({
                                animation: 'cddRankSlam .8s cubic-bezier(.2,.7,.3,1) both',
                            })}
                        >
                            <div className="flex items-center justify-center" style={{ height: BADGE_BOX }}>
                                <RankBadge rank={rank} size={152} />
                            </div>
                            <div
                                style={{
                                    color,
                                    fontWeight: 800,
                                    fontSize: 30,
                                    letterSpacing: 1,
                                    textShadow: `0 0 26px ${color}77`,
                                }}
                            >
                                {rank}
                            </div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        marginTop: 6,
                        minHeight: 22,
                        color: 'rgba(244,245,247,.75)',
                        fontWeight: 600,
                        fontSize: 14,
                        textAlign: 'center',
                    }}
                >
                    {beat === 'settled' && (
                        <span style={anim({ animation: 'cddToast .4s ease-out both' })}>
                            {isPlacement
                                ? `Your placement games are done — you start at ${rank}.`
                                : `Promoted from ${previousRank} to ${rank}.`}
                        </span>
                    )}
                </div>

                {/* The ladder. Shows the rung just climbed in context, so a
                    promotion reads as progress rather than as a single word. */}
                <div
                    className="mt-5 flex w-full items-center justify-center gap-[5px]"
                    style={{
                        opacity: beat === 'settled' ? 1 : 0,
                        transition: rm ? undefined : 'opacity .45s ease-out',
                    }}
                >
                    {PUBLIC_RANK_ORDER.map((label, i) => {
                        const reached = newIndex >= 0 && i <= newIndex;
                        const current = i === newIndex;
                        return (
                            <div
                                key={label}
                                title={label}
                                style={{
                                    flex: current ? '0 0 auto' : '1 1 0',
                                    minWidth: 0,
                                    height: current ? 26 : 6,
                                    borderRadius: 999,
                                    padding: current ? '0 10px' : 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    whiteSpace: 'nowrap',
                                    background: current
                                        ? color
                                        : reached
                                            ? `${publicRankColor(label)}99`
                                            : 'rgba(255,255,255,.13)',
                                    color: '#0b0d10',
                                    fontWeight: 800,
                                    fontSize: 11,
                                    letterSpacing: 0.6,
                                    boxShadow: current ? `0 0 18px ${color}88` : 'none',
                                }}
                            >
                                {current ? label.toUpperCase() : ''}
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={() => onDone?.()}
                    disabled={beat !== 'settled'}
                    className="mt-7 w-full max-w-[300px]"
                    style={{
                        padding: '14px 0',
                        borderRadius: 14,
                        border: 'none',
                        background: accGrad,
                        color: '#0b0d10',
                        fontFamily: "'Outfit',sans-serif",
                        fontWeight: 800,
                        fontSize: 16,
                        cursor: beat === 'settled' ? 'pointer' : 'default',
                        opacity: beat === 'settled' ? 1 : 0,
                        transition: rm ? undefined : 'opacity .4s ease-out',
                        boxShadow: `0 10px 24px ${acc}33, inset 0 1px 0 rgba(255,255,255,.3)`,
                    }}
                >
                    See final scores
                </button>
            </div>
        </div>
    );
}

export default RankPromotionSplash;
