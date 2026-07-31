import { useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import SuitWatermark from './SuitWatermark';
import logoImage from '../../assets/chor-dai-dee-logo.webp';
import { timeAgo } from '../../utils/timeAgo';

const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';
const FONT = "'Outfit',sans-serif";

// One frosted container per section instead of a stack of black cards. Rows
// inside are separated by hairlines, so a list of games reads as one object
// rather than N nested cards.
const shell = {
    background: 'linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.022))',
    border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 20,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    overflow: 'hidden',
};

// Stroke icons rather than emoji: the nav has to sit on one line at 320px, and
// emoji would drag their own colour and metrics into the bar.
const NAV_ICONS = {
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1 1-1.1 1.9" /><path d="M12 16.8h.01" /></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 5.5H5.5V7a3 3 0 0 0 3 3" /><path d="M16 5.5h2.5V7a3 3 0 0 1-3 3" /><path d="M12 13v3.5" /><path d="M9 20h6" /></>,
    pulse: <path d="M3 12.5h4l2.5-7 4 14 2.5-7h5" />,
    bars: <><path d="M5 20v-8" /><path d="M12 20V4" /><path d="M19 20v-5" /></>,
    signOut: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M9 8.5 5 12l4 3.5" /><path d="M5 12h10" /></>,
    signIn: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 8.5l4 3.5-4 3.5" /><path d="M19 12H9" /></>,
};

function NavIcon({ name, size = 19 }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {NAV_ICONS[name]}
        </svg>
    );
}

// v2 home screen. The brand is a mark in the corner, not a hero: the page opens
// on who you are and the one button that starts a game, then a single Live /
// Recent list for everything happening on the server. Destinations live in a
// bottom bar on phones (thumb reach, and it can't collide with the scrolling
// content the way the old floating footer did) and in the header on desktop.
// All connection state and actions live in Lobby and arrive via props.
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
    recentGames = [],
    onGameClick,
    nowTs,
    onHowToPlay,
    onLeaderboard,
    onActivity,
    onStats,
    onEditAvatar,
    onProfile,
    onLogout,
    error,
    spectateOffer,
    onWatchRoom,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const codeReady = (code || '').trim().length >= 4;
    const anim = (delay) => (rm ? undefined : { animation: `cddToast .4s ${delay} ease-out both` });

    const liveGames = onJoinActiveGame ? activeGames : [];
    const finishedGames = onGameClick ? recentGames : [];
    const hasLive = liveGames.length > 0;
    const hasRecent = finishedGames.length > 0;

    // `null` means "follow the data" — live rooms arrive a beat after mount, and
    // until someone picks a tab we want the busier one in front.
    const [pickedTab, setPickedTab] = useState(null);
    const tab = pickedTab ?? (hasLive ? 'live' : 'recent');
    const showLive = tab === 'live';
    const isEmpty = showLive ? !hasLive : !hasRecent;

    // Your own avatar, the players on the joinable-game rows, and the winners in
    // the recent-results list.
    useAvatars([
        username,
        ...liveGames.flatMap(g => (g.players || []).map(p => p.name)),
        ...finishedGames.flatMap(g => (g.participants || []).map(p => p.username)),
    ]);

    const statusText = reconnecting
        ? 'Checking for an existing game…'
        : connected ? (ratingLine || (isGuest ? 'Stats not saved' : 'Ready to play')) : 'Offline';
    const statusDot = reconnecting ? '#ffc94d' : connected ? '#6ee7a8' : '#ff8f70';

    const destinations = [
        { key: 'how', label: 'How to play', icon: 'help', onClick: onHowToPlay },
        { key: 'board', label: 'Leaders', icon: 'trophy', onClick: onLeaderboard },
        onActivity && { key: 'activity', label: 'Activity', icon: 'pulse', onClick: onActivity },
        { key: 'stats', label: 'Stats', icon: 'bars', onClick: onStats },
        // Guests have no account to leave, so this is their route to one;
        // registered players use it to switch accounts.
        onLogout && {
            key: 'auth',
            label: isGuest ? 'Sign in' : 'Log out',
            icon: isGuest ? 'signIn' : 'signOut',
            onClick: onLogout,
        },
    ].filter(Boolean);

    const tabButton = (id, label, count) => {
        const on = tab === id;
        return (
            <button
                onClick={() => setPickedTab(id)}
                aria-pressed={on}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 10, border: 'none',
                    background: on ? accGrad : 'transparent',
                    color: on ? '#0b0d10' : MUTED,
                    fontFamily: FONT, fontWeight: 800, fontSize: 13,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                }}
            >
                {label}
                {count > 0 && (
                    <span style={{ color: on ? 'rgba(11,13,16,.6)' : FAINT, fontSize: 11, fontWeight: 800 }}>{count}</span>
                )}
            </button>
        );
    };

    const row = (isFirst) => ({
        display: 'flex', alignItems: 'center', gap: 11,
        width: '100%', padding: '12px 14px', boxSizing: 'border-box',
        border: 'none',
        borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,.07)',
        background: 'none', textAlign: 'left', fontFamily: FONT,
    });

    return (
        // Column shell, not a scroller: the phone nav is the last row IN NORMAL
        // FLOW rather than `position: fixed; bottom: 0`. In an installed
        // viewport-fit=cover iOS PWA a fixed bottom edge resolves one
        // safe-area-inset-top above the screen, which left the bar floating
        // ~60pt up with the page painting underneath it. Nothing here is taken
        // out of flow, so the bar lands on the physical bottom edge and iOS
        // extends its background through the home-indicator band.
        <div
            className="relative flex h-full w-full flex-col overflow-hidden font-sans"
            style={{ background: surface.base, fontFamily: FONT, '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div
                className="absolute pointer-events-none"
                style={{ top: '-160px', left: '50%', transform: 'translateX(-50%)', width: 560, height: 380, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }}
            />
            <SuitWatermark suit="S" size={150} rotate={-14} opacity={0.03} style={{ top: 120, left: -52 }} />
            <SuitWatermark suit="H" size={170} rotate={12} opacity={0.026} style={{ top: 520, right: -60 }} />

            {/* Scrolling lives here, between the two flow rows. min-h-0 so the
                flex item may shrink below its content and actually scroll. */}
            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col px-5 pb-6 pt-safe-18 md:max-w-[1000px] md:px-8 md:pb-10 md:pt-7">
                    {/* Header: identity first, brand reduced to a corner mark. */}
                    <header className="flex items-center gap-3" style={anim('.02s')}>
                        <button
                            onClick={onEditAvatar}
                            disabled={!onEditAvatar}
                            aria-label={onEditAvatar ? 'Change your avatar' : undefined}
                            style={{ flexShrink: 0, width: 46, height: 46, borderRadius: 15, border: '1px solid rgba(255,255,255,.12)', background: getAvatarTile(username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, padding: 0, cursor: onEditAvatar ? 'pointer' : 'default' }}
                        >{getAvatarEmoji(username)}</button>

                        {/* The name doubles as the way into account settings. The
                            bottom nav has to hold one line at 320px, so a fifth
                            destination goes here rather than there. Guests get no
                            `onProfile` and the block stays inert text. */}
                        <div
                            {...(onProfile ? {
                                role: 'button',
                                tabIndex: 0,
                                onClick: onProfile,
                                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProfile(); } },
                                'aria-label': 'Account settings',
                            } : {})}
                            style={{ flex: 1, minWidth: 0, cursor: onProfile ? 'pointer' : 'default' }}
                        >
                            <div className="flex items-center gap-[6px]" style={{ color: TEXT, fontWeight: 800, fontSize: 17 }}>
                                <span className="truncate">{username}</span>
                                {isGuest && (
                                    <span style={{ flexShrink: 0, background: 'rgba(255,255,255,.12)', color: 'rgba(244,245,247,.8)', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 6px', borderRadius: 6 }}>GUEST</span>
                                )}
                                {onProfile && (
                                    <span aria-hidden="true" style={{ flexShrink: 0, color: MUTED, fontSize: 14, fontWeight: 700 }}>›</span>
                                )}
                            </div>
                            <div className="flex items-center gap-[6px]" style={{ color: MUTED, fontSize: 12, fontWeight: 600 }}>
                                <span
                                    aria-hidden="true"
                                    style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot, flexShrink: 0, ...(rm || !reconnecting ? {} : { animation: 'cddBreathe 1.8s ease-in-out infinite' }) }}
                                />
                                <span className="truncate">{statusText}</span>
                            </div>
                        </div>

                        {/* Desktop destinations. On phones these are the bottom bar. */}
                        <nav className="hidden items-center gap-1 md:flex">
                            {destinations.map((d) => (
                                <button
                                    key={d.key}
                                    onClick={d.onClick}
                                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 11, border: 'none', background: 'none', color: 'rgba(244,245,247,.62)', fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                                >
                                    <NavIcon name={d.icon} size={17} />
                                    {d.label}
                                </button>
                            ))}
                        </nav>

                        <img
                            src={logoImage}
                            alt="Chor Dai Dee"
                            style={{ flexShrink: 0, width: 38, height: 38, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.45))' }}
                        />
                    </header>

                    {/* Actions on the left, everything happening on the server on the
                        right. `min-w-0` on both tracks matters: a grid item defaults
                        to min-width:auto, so the tracking on the code input would
                        otherwise push the column past the viewport. */}
                    <div className="mt-7 grid grid-cols-1 gap-4 md:mt-9 md:grid-cols-2 md:items-start md:gap-8">
                        <div className="flex min-w-0 flex-col gap-3">
                            <button
                                onClick={onCreateRoom}
                                disabled={isJoining}
                                style={{ padding: '19px 0', borderRadius: 18, border: 'none', background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 18, letterSpacing: '.2px', boxShadow: `0 14px 30px ${soft},inset 0 1px 0 rgba(255,255,255,.32)`, cursor: isJoining ? 'default' : 'pointer', fontFamily: FONT, opacity: isJoining ? 0.7 : 1, ...anim('.08s') }}
                            >{isJoining ? 'Connecting…' : 'Create a room'}</button>

                            {onQuickPlay && (
                                <button
                                    onClick={onQuickPlay}
                                    disabled={isJoining}
                                    style={{ padding: '15px 0', borderRadius: 16, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', color: TEXT, fontWeight: 800, fontSize: 15, cursor: isJoining ? 'default' : 'pointer', fontFamily: FONT, ...anim('.12s') }}
                                >Quick play vs bots</button>
                            )}

                            {/* Joining a friend is one row, not a titled panel. */}
                            <form
                                className="flex gap-2"
                                onSubmit={(e) => { e.preventDefault(); if (codeReady && !isJoining) onJoinRoom(); }}
                                style={anim('.16s')}
                            >
                                <input
                                    value={code}
                                    onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
                                    placeholder="Room code"
                                    maxLength={5}
                                    aria-label="Room code"
                                    // `onCodeChange` already uppercases, so no
                                    // text-transform — that would shout the
                                    // placeholder too.
                                    style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '0 16px', height: 52, color: TEXT, fontFamily: FONT, fontWeight: 700, fontSize: 16, letterSpacing: 1, outline: 'none' }}
                                />
                                <button
                                    type="submit"
                                    disabled={!codeReady || isJoining}
                                    style={{
                                        minWidth: 88, borderRadius: 14, border: codeReady ? 'none' : '1px solid rgba(255,255,255,.1)',
                                        background: codeReady ? accGrad : 'rgba(0,0,0,.22)',
                                        color: codeReady ? '#0b0d10' : FAINT,
                                        fontWeight: 800, fontSize: 15, fontFamily: FONT,
                                        cursor: codeReady && !isJoining ? 'pointer' : 'default',
                                        boxShadow: codeReady ? `0 8px 18px ${soft}` : 'none',
                                        transition: rm ? undefined : 'background .18s ease,color .18s ease',
                                    }}
                                >Join</button>
                            </form>
                        </div>

                        <div className="flex min-w-0 flex-col" style={anim('.2s')}>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(0,0,0,.26)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 13, padding: 3 }}>
                                    {tabButton('live', 'Live', liveGames.length)}
                                    {tabButton('recent', 'Recent')}
                                </div>
                                {/* The full feed is finished games, so this only
                                    belongs to the Recent tab. */}
                                {onActivity && !showLive && (
                                    <button
                                        onClick={onActivity}
                                        style={{ background: 'none', border: 'none', padding: 0, color: acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}
                                    >View all →</button>
                                )}
                            </div>

                            <div style={shell}>
                                {showLive && liveGames.slice(0, 6).map((game, i) => {
                                    const humans = (game.players || []).filter((p) => !p.isBot);
                                    const seats = game.botCount || 0;
                                    const meta = [
                                        game.roomId,
                                        game.gameMode === 'short' ? 'Short' : 'Standard',
                                        game.gameState === 'round_over' ? 'Between rounds' : `Round ${game.roundNumber}`,
                                        `${seats} open`,
                                    ].join(' · ');
                                    return (
                                        <div key={game.roomId} style={{ ...row(i === 0), opacity: isJoining ? 0.6 : 1 }}>
                                            <div className="flex" style={{ flexShrink: 0 }}>
                                                {(humans.length ? humans : [{ name: game.roomId }]).slice(0, 3).map((p, idx) => (
                                                    <div
                                                        key={`${p.name}-${idx}`}
                                                        style={{ width: 32, height: 32, borderRadius: 11, background: getAvatarTile(p.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, marginLeft: idx === 0 ? 0 : -10, border: '1.5px solid rgba(12,32,22,.65)' }}
                                                    >{getAvatarEmoji(p.name)}</div>
                                                ))}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div className="truncate" style={{ color: TEXT, fontWeight: 700, fontSize: 14 }}>
                                                    {humans.length > 0 ? humans.map((p) => p.name).join(', ') : 'Bots only'}
                                                </div>
                                                <div className="truncate" style={{ color: MUTED, fontSize: 11, fontWeight: 600 }}>{meta}</div>
                                            </div>
                                            <div className="flex items-center gap-[6px]" style={{ flexShrink: 0 }}>
                                                {onWatchRoom && (
                                                    <button
                                                        onClick={() => onWatchRoom(game.roomId)}
                                                        disabled={isJoining}
                                                        aria-label={`Watch room ${game.roomId}`}
                                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.05)', color: 'rgba(244,245,247,.7)', cursor: isJoining ? 'default' : 'pointer', padding: 0 }}
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                                            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
                                                            <circle cx="12" cy="12" r="2.6" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => onJoinActiveGame(game.roomId)}
                                                    disabled={isJoining}
                                                    aria-label={`Join room ${game.roomId}, round ${game.roundNumber}, ${seats} seat${seats === 1 ? '' : 's'} open`}
                                                    style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${acc}66`, background: `${acc}18`, color: acc, fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', cursor: isJoining ? 'default' : 'pointer', fontFamily: FONT }}
                                                >Join</button>
                                            </div>
                                        </div>
                                    );
                                })}

                                {!showLive && finishedGames.slice(0, 4).map((game, i) => {
                                    // `nowTs` is sampled once by Lobby, so the
                                    // relative times don't drift on re-render.
                                    const timeStr = nowTs ? timeAgo(game.end_time, nowTs) : null;
                                    const ranked = [...(game.participants || [])].sort((a, b) => a.placement - b.placement);
                                    const winner = ranked[0];
                                    const meta = [
                                        game.game_mode === 'short' ? 'Short' : 'Standard',
                                        `${game.total_rounds} round${game.total_rounds === 1 ? '' : 's'}`,
                                        ranked.length ? `beat ${ranked.slice(1).map((p) => p.username).join(', ')}` : null,
                                    ].filter(Boolean).join(' · ');
                                    return (
                                        <button
                                            key={game.game_id}
                                            onClick={() => onGameClick(game)}
                                            style={{ ...row(i === 0), cursor: 'pointer' }}
                                        >
                                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                                <div style={{ width: 32, height: 32, borderRadius: 11, background: getAvatarTile(winner?.username || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: '1.5px solid rgba(12,32,22,.65)' }}>
                                                    {getAvatarEmoji(winner?.username || '?')}
                                                </div>
                                                <span aria-hidden="true" style={{ position: 'absolute', top: -7, left: -5, fontSize: 12 }}>👑</span>
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div className="truncate" style={{ color: TEXT, fontWeight: 700, fontSize: 14 }}>
                                                    {winner ? `${winner.username} won` : 'Game finished'}
                                                </div>
                                                <div className="truncate" style={{ color: MUTED, fontSize: 11, fontWeight: 600 }}>{meta}</div>
                                            </div>
                                            <span style={{ color: FAINT, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{timeStr}</span>
                                        </button>
                                    );
                                })}

                                {isEmpty && (
                                    <div style={{ padding: '26px 16px', textAlign: 'center', color: MUTED, fontSize: 13, fontWeight: 600 }}>
                                        {showLive ? 'No games in progress — start one!' : 'No finished games yet.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div role="alert" style={{ marginTop: 14, textAlign: 'center', color: '#ff8f70', fontSize: 13, fontWeight: 600 }}>{error}</div>
                    )}

                    {spectateOffer && (
                        <button
                            onClick={() => onWatchRoom(spectateOffer)}
                            className="md:mx-auto md:max-w-[420px]"
                            style={{ marginTop: 12, width: '100%', padding: '13px 16px', borderRadius: 14, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.15)', color: TEXT, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
                        >Watch {spectateOffer} instead</button>
                    )}
                </div>
            </div>

            {/* Phone destinations. A flow row of the column shell — NOT fixed and
                NOT absolute in the scroller. Absolute inside the scroller let the
                old footer ride up onto the game list once the page grew, and
                `fixed` cured that but broke in the installed iOS PWA (see the
                shell comment above). As the last row it can do neither. */}
            <nav
                className="relative z-20 shrink-0 flex items-stretch justify-around gap-1 px-2 pb-safe-bar pt-[7px] md:hidden"
                style={{ background: 'rgba(8,26,18,.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid rgba(255,255,255,.09)' }}
            >
                {destinations.map((d) => (
                    <button
                        key={d.key}
                        onClick={d.onClick}
                        // No bottom padding of its own: the bar's pb-safe-bar
                        // owns the space below the labels, so the two do not
                        // stack into a tall half-empty bar on a device with a
                        // home indicator. minHeight replaces the tap area that
                        // padding used to provide — the bar's padding sits
                        // OUTSIDE the button box, so without this the target
                        // shrinks to 41px, under the 44pt minimum.
                        style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 2px 0', border: 'none', background: 'none', color: 'rgba(244,245,247,.6)', fontFamily: FONT, fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                    >
                        <NavIcon name={d.icon} />
                        <span className="truncate" style={{ maxWidth: '100%' }}>{d.label}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
}

export default HomeScreenV2;
