import { useState, useRef, useEffect } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { useAvatars } from '../../hooks/useAvatars';
import { GAME_MODES } from '../../constants/gameModes';
import SuitWatermark from './SuitWatermark';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 waiting room. Mirrors the "Waiting Room v2" claude.ai/design mockup and
// widens to a single row of seats on desktop. All room state and socket actions
// live in GameRoom and arrive via props; only transient UI flashes (copied /
// shared labels) are local.
function WaitingRoomV2({
    roomId,
    players = [],
    myPlayerId,
    isHost,
    hostUsername,
    gameMode,
    isPrivate,
    onSetPrivacy,
    onSetGameMode,
    forceMaxBots,
    onSetMaxBots,
    onAddBot,
    onStartGame,
    onLeave,
    onOpenSettings,
    onShareInvite,
    voice,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const [copied, setCopied] = useState(false);
    const [shared, setShared] = useState(false);
    const timers = useRef([]);

    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    // Seats show the avatar each player picked, so load them for this room.
    useAvatars(players.map(p => p.name));

    const flash = (setter) => {
        setter(true);
        timers.current.push(setTimeout(() => setter(false), 1600));
    };

    const copyCode = () => {
        try { navigator.clipboard?.writeText(roomId); } catch { /* ignore */ }
        flash(setCopied);
    };

    const shareInvite = () => {
        onShareInvite?.();
        flash(setShared);
    };

    const filledCount = players.length;
    const canStart = isHost && filledCount >= 1;
    const anim = (delay) => (rm ? undefined : { animation: `cddToast .4s ${delay} ease-out both` });

    const shortSelected = (gameMode || 'standard') === GAME_MODES.SHORT.id;
    const longSelected = (gameMode || 'standard') === GAME_MODES.STANDARD.id;

    const seats = [];
    players.forEach((p, i) => {
        seats.push({
            key: p.id || p.name,
            filled: true,
            name: p.name,
            isYou: p.id === myPlayerId,
            animal: getAvatarEmoji(p.name),
            tile: getAvatarTile(p.name),
            host: p.name === hostUsername,
            delay: `${(i * 0.07).toFixed(2)}s`,
        });
    });
    for (let i = filledCount; i < 4; i++) {
        seats.push({ key: `empty-${i}`, filled: false, delay: `${(i * 0.07).toFixed(2)}s` });
    }

    const statusLine = canStart
        ? (filledCount === 4 ? 'Room is full — ready when you are!' : 'Empty seats will be filled with bots.')
        : (isHost
            ? 'Add players or bots to start.'
            : `Waiting for host (${hostUsername}) to start…`);

    return (
        <div
            className="absolute inset-0 z-40 overflow-y-auto font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div
                className="absolute pointer-events-none"
                style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }}
            />
            <SuitWatermark suit="S" size={150} rotate={-14} style={{ top: 120, left: -46 }} />
            <SuitWatermark suit="H" size={165} rotate={12} opacity={0.03} style={{ top: 460, right: -52 }} />

            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[18px] pb-safe-6 pt-[18px] md:max-w-[880px] md:px-8">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <img src={logoImage} alt="Chor Dai Dee" style={{ width: 36, height: 36, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                        <div>
                            <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 15, letterSpacing: '.2px', lineHeight: 1.1 }}>Room {roomId}</div>
                            <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 600 }}>Waiting for players</div>
                        </div>
                    </div>
                    <button
                        onClick={onOpenSettings}
                        aria-label="Settings"
                        style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 14, cursor: 'pointer' }}
                    >⚙</button>
                </div>

                {/* Room code */}
                <div className="mt-6 flex justify-center">
                    <button
                        onClick={copyCode}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))', border: `1px solid ${acc}66`, borderRadius: 14, padding: '9px 18px', cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}
                    >
                        <span style={{ color: 'rgba(244,245,247,.55)', fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>CODE</span>
                        <span style={{ color: acc, fontWeight: 800, fontSize: 22, letterSpacing: 6 }}>{roomId}</span>
                        <span style={{ color: 'rgba(244,245,247,.65)', fontSize: 12, fontWeight: 700 }}>{copied ? '✓ Copied' : '⧉ Copy'}</span>
                    </button>
                </div>

                {/* Seats */}
                <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                    {seats.map((st) => (
                        <div
                            key={st.key}
                            style={{
                                background: st.filled ? 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))' : 'rgba(0,0,0,.22)',
                                border: st.filled ? `1px solid ${acc}55` : '1px solid rgba(255,255,255,.08)',
                                borderRadius: 18,
                                padding: '16px 12px 14px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 8,
                                boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
                                minHeight: 118,
                                boxSizing: 'border-box',
                                justifyContent: 'center',
                                ...anim(st.delay),
                            }}
                        >
                            {st.filled ? (
                                <>
                                    <div style={{ width: 52, height: 52, borderRadius: 16, background: st.tile, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{st.animal}</div>
                                    <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                                        {st.name}{st.isYou ? ' (You)' : ''}
                                        {st.host && (
                                            <span style={{ background: accGrad, color: '#0b0d10', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 6px', borderRadius: 6 }}>HOST</span>
                                        )}
                                    </div>
                                    <div style={{ color: acc, fontSize: 11, fontWeight: 800, letterSpacing: 1.5 }}>READY</div>
                                </>
                            ) : (
                                <>
                                    <div style={{ width: 52, height: 52, borderRadius: 16, border: '2px dashed rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'rgba(255,255,255,.4)', ...(rm ? {} : { animation: 'cddBreathe 2s ease-in-out infinite' }) }}>?</div>
                                    <div style={{ color: 'rgba(244,245,247,.5)', fontWeight: 600, fontSize: 12 }}>Open seat</div>
                                    {isHost && onAddBot && (
                                        <button
                                            onClick={onAddBot}
                                            style={{ padding: '5px 12px', borderRadius: 9, border: `1px solid ${acc}66`, background: 'rgba(0,0,0,.35)', color: acc, fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                                        >+ Add bot</button>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {/* Game settings */}
                <div
                    className="mt-4"
                    style={{ background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))', border: '1px solid rgba(255,255,255,.1)', borderRadius: 18, padding: 16, boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)' }}
                >
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 12 }}>GAME SETTINGS</div>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 13 }}>Game length</div>
                            <div className="flex gap-[6px]">
                                <SegButton
                                    label={`Short · ${GAME_MODES.SHORT.pointThreshold}`}
                                    selected={shortSelected}
                                    disabled={!isHost}
                                    accGrad={accGrad}
                                    acc={acc}
                                    onClick={() => isHost && onSetGameMode?.(GAME_MODES.SHORT.id)}
                                />
                                <SegButton
                                    label={`Long · ${GAME_MODES.STANDARD.pointThreshold}`}
                                    selected={longSelected}
                                    disabled={!isHost}
                                    accGrad={accGrad}
                                    acc={acc}
                                    onClick={() => isHost && onSetGameMode?.(GAME_MODES.STANDARD.id)}
                                />
                            </div>
                        </div>
                        {/* Only the host can change who may join. */}
                        {isHost && onSetPrivacy && (
                            <div className="flex items-center justify-between">
                                <div>
                                    <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 13 }}>Room privacy</div>
                                    <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>
                                        {isPrivate ? 'Only people with the code' : 'Anyone can join'}
                                    </div>
                                </div>
                                <div className="flex gap-[6px]">
                                    <SegButton
                                        label="Public"
                                        selected={!isPrivate}
                                        accGrad={accGrad}
                                        acc={acc}
                                        onClick={() => onSetPrivacy(false)}
                                    />
                                    <SegButton
                                        label="Private"
                                        selected={!!isPrivate}
                                        accGrad={accGrad}
                                        acc={acc}
                                        onClick={() => onSetPrivacy(true)}
                                    />
                                </div>
                            </div>
                        )}

                        {voice && (
                            <div className="flex items-center justify-between gap-3">
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 13 }}>Voice chat</div>
                                    <div style={{ color: voice.enabled && voice.connected ? acc : 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>
                                        {voice.enabled
                                            ? (voice.connected ? 'Connected' : 'Connecting…')
                                            : voice.userCount > 0
                                                ? `${voice.userCount} already talking`
                                                : 'Talk to the table while you play'}
                                    </div>
                                </div>
                                <div className="flex gap-[6px]" style={{ flexShrink: 0 }}>
                                    {voice.enabled ? (
                                        <>
                                            <SegButton
                                                label={voice.isMuted ? '🔇 Muted' : '🔊 Mic on'}
                                                selected={!voice.isMuted}
                                                accGrad={accGrad}
                                                acc={acc}
                                                onClick={voice.onToggleMute}
                                            />
                                            <SegButton
                                                label={voice.isDeafened ? '🔕 Deafened' : '🔔 Audio on'}
                                                selected={!voice.isDeafened}
                                                accGrad={accGrad}
                                                acc={acc}
                                                onClick={voice.onToggleDeafen}
                                            />
                                        </>
                                    ) : (
                                        <SegButton
                                            label="🎤 Join voice"
                                            selected
                                            accGrad={accGrad}
                                            acc={acc}
                                            onClick={voice.onJoin}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Advanced, and deliberately quiet: bots normally
                            calibrate to the table, which is the right default
                            for almost everyone. This is the escape hatch for
                            players who have outgrown it and want a fixed,
                            known-strongest opponent — so it reads as a footnote
                            to the settings rather than a headline choice. */}
                        {isHost && onSetMaxBots && (
                            <div
                                className="flex items-center justify-between gap-3"
                                style={{ marginTop: 2, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,.07)' }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ color: 'rgba(244,245,247,.62)', fontWeight: 700, fontSize: 12 }}>
                                        Max difficulty bots
                                    </div>
                                    <div style={{ color: 'rgba(244,245,247,.38)', fontSize: 11, fontWeight: 600 }}>
                                        {forceMaxBots
                                            ? 'Always the strongest bots'
                                            : 'Off — bots match the table'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => onSetMaxBots(!forceMaxBots)}
                                    role="switch"
                                    aria-checked={!!forceMaxBots}
                                    aria-label="Max difficulty bots"
                                    style={{
                                        flexShrink: 0, width: 44, height: 26, borderRadius: 999, cursor: 'pointer',
                                        border: `1px solid ${forceMaxBots ? acc : 'rgba(255,255,255,.18)'}`,
                                        background: forceMaxBots ? `${acc}33` : 'rgba(0,0,0,.38)',
                                        padding: 0, position: 'relative',
                                        transition: rm ? 'none' : 'background .18s ease, border-color .18s ease',
                                    }}
                                >
                                    <span style={{
                                        position: 'absolute', top: 2, left: forceMaxBots ? 20 : 2,
                                        width: 20, height: 20, borderRadius: 999,
                                        background: forceMaxBots ? acc : 'rgba(244,245,247,.5)',
                                        transition: rm ? 'none' : 'left .18s ease, background .18s ease',
                                    }} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom actions */}
                <div className="mt-auto flex flex-col gap-[10px] pt-6">
                    <div style={{ textAlign: 'center', color: 'rgba(244,245,247,.6)', fontSize: 13, fontWeight: 600 }}>{statusLine}</div>
                    {canStart ? (
                        <button
                            onClick={onStartGame}
                            style={{ display: 'block', textAlign: 'center', padding: '16px 0', borderRadius: 14, border: 'none', background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 17, boxShadow: `0 10px 24px ${soft},inset 0 1px 0 rgba(255,255,255,.3)`, cursor: 'pointer', fontFamily: "'Outfit',sans-serif", ...(rm ? {} : { animation: 'cddPulse 1.6s ease-in-out infinite' }) }}
                        >Start game</button>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '16px 0', borderRadius: 14, background: 'rgba(0,0,0,.35)', color: 'rgba(244,245,247,.45)', fontWeight: 800, fontSize: 17, border: '1px solid rgba(255,255,255,.08)' }}>Start game</div>
                    )}
                    <button
                        onClick={shareInvite}
                        style={{ padding: '12px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                    >{shared ? '✓ Invite link copied' : '↗ Share invite link'}</button>
                    <button
                        onClick={onLeave}
                        style={{ padding: '10px 0', borderRadius: 14, border: 'none', background: 'transparent', color: 'rgba(244,245,247,.55)', fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    >Leave room</button>
                </div>
            </div>
        </div>
    );
}

function SegButton({ label, selected, disabled, accGrad, acc, onClick }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                padding: '6px 13px',
                borderRadius: 9,
                border: `1px solid ${selected ? acc : 'rgba(255,255,255,.14)'}`,
                background: selected ? accGrad : 'rgba(0,0,0,.35)',
                color: selected ? '#0b0d10' : 'rgba(244,245,247,.6)',
                fontFamily: "'Outfit',sans-serif",
                fontWeight: 700,
                fontSize: 12,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled && !selected ? 0.55 : 1,
            }}
        >{label}</button>
    );
}

export default WaitingRoomV2;
