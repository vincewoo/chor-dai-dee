import logoImage from '../../assets/chor-dai-dee-logo.webp';
import { GAME_MODES } from '../../constants/gameModes';

// Top HUD bar: logo + room/round on the left, Info toggle + gear on the right.
//
// `showInfo` is off on the desktop table, where the corner scoreboard already
// carries everything the Info layer revealed — scores always, and cards left,
// rank and points-to-threshold when it is expanded.
function HudBar({ roomId, gameMode, roundNumber, infoOn, onToggleInfo, showInfo = true, onOpenSettings, isGuest, onCreateAccount, acc, voiceControl, spectatorCount = 0, onOpenSpectators, practiceMode = false }) {
    const modeName = gameMode ? (GAME_MODES[gameMode.toUpperCase()]?.name || 'Standard Game') : '';
    const subtitle = [modeName, roundNumber > 0 ? `Round ${roundNumber}` : null].filter(Boolean).join(' · ');

    return (
        <div style={{ position: 'absolute', top: 18, left: 18, right: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <img src={logoImage} alt="Chor Dai Dee" style={{ width: 36, height: 36, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 15, letterSpacing: '.2px', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {practiceMode ? 'Practice Mode' : `Room ${roomId}`}
                    </div>
                    {isGuest ? (
                        <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Guest{subtitle ? ` · ${subtitle}` : ''} ·{' '}
                            <button
                                onClick={onCreateAccount}
                                style={{ background: 'none', border: 'none', padding: 0, color: acc, fontWeight: 700, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                Save
                            </button>
                        </div>
                    ) : subtitle && (
                        <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 11, fontWeight: 600 }}>{subtitle}</div>
                    )}
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {voiceControl}
                {onOpenSpectators && (
                    <button
                        onClick={onOpenSpectators}
                        aria-label={`${spectatorCount} watching`}
                        style={{
                            height: 32, padding: '0 10px', borderRadius: 10,
                            border: '1px solid rgba(255,255,255,.14)', background: 'rgba(0,0,0,.38)',
                            color: '#f4f5f7', fontFamily: "'Outfit',sans-serif",
                            fontWeight: 700, fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        👁 {spectatorCount}
                    </button>
                )}
                {showInfo && (
                    <button
                        onClick={onToggleInfo}
                        aria-pressed={infoOn}
                        style={{
                            height: 32, padding: '0 12px', borderRadius: 10,
                            border: `1px solid ${infoOn ? acc : 'rgba(255,255,255,.14)'}`,
                            background: infoOn ? acc : 'rgba(0,0,0,.38)',
                            color: infoOn ? '#0b0d10' : '#f4f5f7',
                            fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        Info
                    </button>
                )}
                <button
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    style={{
                        width: 32, height: 32, borderRadius: 10,
                        border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)',
                        color: '#f4f5f7', fontSize: 14, cursor: 'pointer',
                    }}
                >
                    ⚙
                </button>
            </div>
        </div>
    );
}

export default HudBar;
