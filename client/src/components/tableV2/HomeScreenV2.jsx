import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 mobile home / lobby screen. Mirrors the "Home Screen v2" claude.ai/design
// mockup. All connection state and actions live in Lobby and arrive via props.
function HomeScreenV2({
    username,
    isGuest,
    ratingLine,
    connected,
    reconnecting,
    isJoining,
    code,
    onCodeChange,
    onCreateRoom,
    onQuickPlay,
    onJoinRoom,
    onHowToPlay,
    onLeaderboard,
    onStats,
    onEditAvatar,
    error,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const codeReady = (code || '').trim().length >= 4;
    const anim = (delay) => (rm ? undefined : { animation: `cddToast .4s ${delay} ease-out both` });

    const statusText = reconnecting
        ? 'Checking for existing game…'
        : connected ? "Let's blast some 2s!" : 'Disconnected — is the server running?';
    const statusColor = reconnecting
        ? 'rgba(244,245,247,.6)'
        : connected ? 'rgba(244,245,247,.6)' : '#ff8f70';

    return (
        <div
            className="relative min-h-screen-safe w-full overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div
                className="absolute pointer-events-none"
                style={{ top: '-120px', left: '50%', transform: 'translateX(-50%)', width: 560, height: 380, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }}
            />
            <div className="absolute pointer-events-none select-none" style={{ top: 150, left: -46, fontSize: 190, lineHeight: 1, color: 'rgba(255,255,255,.035)', transform: 'rotate(-14deg)' }}>♠</div>
            <div className="absolute pointer-events-none select-none" style={{ top: 480, right: -52, fontSize: 210, lineHeight: 1, color: 'rgba(255,255,255,.03)', transform: 'rotate(12deg)' }}>♥</div>
            <div className="absolute pointer-events-none select-none" style={{ top: 700, left: -30, fontSize: 150, lineHeight: 1, color: 'rgba(255,255,255,.028)', transform: 'rotate(8deg)' }}>♦</div>

            <div className="relative z-10 mx-auto flex min-h-screen-safe max-w-[440px] flex-col px-[22px] pb-[88px] pt-16">
                {/* Hero */}
                <div className="flex flex-col items-center gap-[10px]">
                    <img
                        src={logoImage}
                        alt="Chor Dai Dee"
                        style={{ width: 150, height: 150, filter: 'drop-shadow(0 14px 30px rgba(0,0,0,.5))', ...(rm ? {} : { animation: 'cddFloat 4s ease-in-out infinite' }) }}
                    />
                    <div style={{ color: statusColor, fontSize: 14, fontWeight: 600, letterSpacing: '.3px' }}>{statusText}</div>
                </div>

                {/* Player identity */}
                <div
                    className="mt-8 flex items-center gap-3"
                    style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))', border: '1px solid rgba(255,255,255,.1)', borderRadius: 18, padding: '12px 14px', boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)', ...anim('.05s') }}
                >
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: getAvatarTile(username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>{getAvatarEmoji(username)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="truncate">{username}</span>
                            {isGuest && (
                                <span style={{ background: 'rgba(255,255,255,.14)', color: 'rgba(244,245,247,.85)', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 6px', borderRadius: 6 }}>GUEST</span>
                            )}
                        </div>
                        <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 600 }}>
                            {ratingLine || (isGuest ? 'Stats not saved' : 'Ready to play')}
                        </div>
                    </div>
                    {onEditAvatar && (
                        <button
                            onClick={onEditAvatar}
                            style={{ padding: '7px 13px', borderRadius: 10, border: `1px solid ${acc}66`, background: 'rgba(0,0,0,.35)', color: acc, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}
                        >Edit</button>
                    )}
                </div>

                {/* Primary actions */}
                <div className="mt-3 flex flex-col gap-3">
                    <button
                        onClick={onCreateRoom}
                        disabled={isJoining}
                        style={{ padding: '17px 0', borderRadius: 16, border: 'none', background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 18, boxShadow: `0 10px 24px ${soft},inset 0 1px 0 rgba(255,255,255,.3)`, cursor: isJoining ? 'default' : 'pointer', fontFamily: "'Outfit',sans-serif", opacity: isJoining ? 0.7 : 1, ...anim('.12s') }}
                    >{isJoining ? 'Connecting…' : 'Create a room'}</button>
                    {onQuickPlay && (
                        <button
                            onClick={onQuickPlay}
                            disabled={isJoining}
                            style={{ padding: '14px 0', borderRadius: 16, background: 'rgba(0,0,0,.38)', border: '1px solid rgba(255,255,255,.2)', color: '#f4f5f7', fontWeight: 800, fontSize: 15, cursor: isJoining ? 'default' : 'pointer', fontFamily: "'Outfit',sans-serif", ...anim('.18s') }}
                        >Quick play vs bots</button>
                    )}
                </div>

                {/* Join with code */}
                <div
                    className="mt-4"
                    style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))', border: '1px solid rgba(255,255,255,.1)', borderRadius: 18, padding: 16, boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)', ...anim('.24s') }}
                >
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }}>JOIN A FRIEND'S ROOM</div>
                    <form
                        className="flex gap-[10px]"
                        onSubmit={(e) => { e.preventDefault(); if (codeReady && !isJoining) onJoinRoom(); }}
                    >
                        <input
                            value={code}
                            onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
                            placeholder="Enter code"
                            maxLength={5}
                            aria-label="Room code"
                            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, padding: '0 14px', height: 48, color: '#f4f5f7', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: 5, textTransform: 'uppercase', outline: 'none' }}
                        />
                        {codeReady ? (
                            <button
                                type="submit"
                                disabled={isJoining}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 86, borderRadius: 12, border: 'none', background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 15, boxShadow: `0 6px 16px ${soft}`, cursor: isJoining ? 'default' : 'pointer', fontFamily: "'Outfit',sans-serif", ...(rm ? {} : { animation: 'cddPop .3s cubic-bezier(.2,.8,.3,1.2)' }) }}
                            >Join</button>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 86, borderRadius: 12, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(244,245,247,.4)', fontWeight: 800, fontSize: 15 }}>Join</div>
                        )}
                    </form>
                </div>

                {error && (
                    <div style={{ marginTop: 12, textAlign: 'center', color: '#ff8f70', fontSize: 13, fontWeight: 600 }}>{error}</div>
                )}
            </div>

            {/* Footer */}
            <div className="absolute inset-x-0 z-10 flex justify-center gap-[26px]" style={{ bottom: 28 }}>
                <button onClick={onHowToPlay} style={{ background: 'none', border: 'none', color: 'rgba(244,245,247,.55)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}>How to play</button>
                <button onClick={onLeaderboard} style={{ background: 'none', border: 'none', color: 'rgba(244,245,247,.55)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}>Leaderboard</button>
                <button onClick={onStats} style={{ background: 'none', border: 'none', color: 'rgba(244,245,247,.55)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}>Stats</button>
            </div>
        </div>
    );
}

export default HomeScreenV2;
