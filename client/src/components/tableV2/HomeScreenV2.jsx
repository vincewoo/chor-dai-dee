import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

const footerLink = {
    background: 'none',
    border: 'none',
    color: 'rgba(244,245,247,.55)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Outfit',sans-serif",
};

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
    activeGames = [],
    onJoinActiveGame,
    onHowToPlay,
    onLeaderboard,
    onActivity,
    onStats,
    onEditAvatar,
    error,
    spectateOffer,
    onWatchRoom,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const codeReady = (code || '').trim().length >= 4;
    const anim = (delay) => (rm ? undefined : { animation: `cddToast .4s ${delay} ease-out both` });
    const showActiveGames = !!onJoinActiveGame && activeGames.length > 0;

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

                {/* Active games — public rooms in progress with a bot seat to take over */}
                {showActiveGames && (
                    <div
                        className="mt-4"
                        style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))', border: '1px solid rgba(255,255,255,.1)', borderRadius: 18, padding: 16, boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)', ...anim('.3s') }}
                    >
                        <div className="flex items-center gap-[7px]" style={{ marginBottom: 10 }}>
                            <span
                                aria-hidden="true"
                                style={{ width: 7, height: 7, borderRadius: '50%', background: acc, boxShadow: `0 0 8px ${soft}`, ...(rm ? {} : { animation: 'cddBreathe 1.8s ease-in-out infinite' }) }}
                            />
                            <span style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>ACTIVE GAMES</span>
                            <span style={{ color: 'rgba(244,245,247,.35)', fontSize: 10, fontWeight: 700 }}>
                                {activeGames.length} joinable
                            </span>
                        </div>

                        <div className="flex flex-col gap-[10px]">
                            {activeGames.map((game, i) => {
                                const humans = (game.players || []).filter((p) => !p.isBot);
                                const seats = game.botCount || 0;
                                return (
                                    <div
                                        key={game.roomId}
                                        className="text-left"
                                        style={{
                                            background: 'rgba(0,0,0,.34)',
                                            border: '1px solid rgba(255,255,255,.09)',
                                            borderRadius: 14,
                                            padding: '11px 12px',
                                            opacity: isJoining ? 0.6 : 1,
                                            ...anim(`${(0.34 + Math.min(i, 6) * 0.04).toFixed(2)}s`),
                                        }}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-[6px]" style={{ minWidth: 0 }}>
                                                <span style={{ color: acc, fontWeight: 800, fontSize: 14, letterSpacing: 1.5 }}>{game.roomId}</span>
                                                <span style={{ background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(244,245,247,.75)', fontSize: 9, fontWeight: 800, letterSpacing: .6, padding: '3px 7px', borderRadius: 7, whiteSpace: 'nowrap' }}>
                                                    {game.gameMode === 'short' ? '⚡ SHORT' : '🏆 STANDARD'}
                                                </span>
                                            </div>
                                            <span style={{ color: 'rgba(244,245,247,.42)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                {game.gameState === 'round_over' ? 'Between rounds' : `Round ${game.roundNumber}`}
                                            </span>
                                        </div>

                                        <div className="mt-[9px] flex items-center gap-[9px]">
                                            <div className="flex" style={{ flexShrink: 0 }}>
                                                {humans.slice(0, 3).map((p, idx) => (
                                                    <div
                                                        key={`${p.name}-${idx}`}
                                                        style={{ width: 28, height: 28, borderRadius: 9, background: getAvatarTile(p.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginLeft: idx === 0 ? 0 : -8, border: '1px solid rgba(0,0,0,.45)' }}
                                                    >{getAvatarEmoji(p.name)}</div>
                                                ))}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div className="truncate" style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 12 }}>
                                                    {humans.length > 0 ? humans.map((p) => p.name).join(', ') : 'Bots only'}
                                                </div>
                                                <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 600 }}>
                                                    {seats} seat{seats === 1 ? '' : 's'} open
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-[6px]" style={{ flexShrink: 0 }}>
                                                {onWatchRoom && (
                                                    <button
                                                        onClick={() => onWatchRoom(game.roomId)}
                                                        disabled={isJoining}
                                                        aria-label={`Watch room ${game.roomId}`}
                                                        style={{
                                                            padding: '6px 10px', borderRadius: 10,
                                                            border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.35)',
                                                            color: 'rgba(244,245,247,.8)', fontWeight: 800, fontSize: 12,
                                                            whiteSpace: 'nowrap', cursor: isJoining ? 'default' : 'pointer',
                                                            fontFamily: "'Outfit',sans-serif",
                                                        }}
                                                    >
                                                        👁
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => onJoinActiveGame(game.roomId)}
                                                    disabled={isJoining}
                                                    aria-label={`Join room ${game.roomId}, round ${game.roundNumber}, ${seats} seat${seats === 1 ? '' : 's'} open`}
                                                    style={{
                                                        padding: '6px 12px', borderRadius: 10, border: `1px solid ${acc}66`,
                                                        background: 'rgba(0,0,0,.35)', color: acc, fontWeight: 800, fontSize: 12,
                                                        whiteSpace: 'nowrap', cursor: isJoining ? 'default' : 'pointer',
                                                        fontFamily: "'Outfit',sans-serif",
                                                    }}
                                                >
                                                    Join
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {error && (
                    <div style={{ marginTop: 12, textAlign: 'center', color: '#ff8f70', fontSize: 13, fontWeight: 600 }}>{error}</div>
                )}

                {spectateOffer && (
                    <button
                        onClick={() => onWatchRoom(spectateOffer)}
                        style={{
                            marginTop: 12, width: '100%', padding: '12px 16px', borderRadius: 14,
                            background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.16)',
                            color: '#f4f5f7', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                            fontFamily: "'Outfit',sans-serif",
                        }}
                    >
                        👁 Watch {spectateOffer} instead
                    </button>
                )}
            </div>

            {/* Footer */}
            <div className="absolute inset-x-0 z-10 flex flex-wrap justify-center gap-x-[18px] gap-y-[6px] px-4" style={{ bottom: 28 }}>
                <button onClick={onHowToPlay} style={footerLink}>How to play</button>
                <button onClick={onLeaderboard} style={footerLink}>Leaderboard</button>
                {onActivity && (
                    <button onClick={onActivity} style={footerLink}>Activity</button>
                )}
                <button onClick={onStats} style={footerLink}>Stats</button>
            </div>
        </div>
    );
}

export default HomeScreenV2;
