import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';

// Persistent scoreboard rail for the desktop table. On mobile the same numbers
// live behind the HUD's Info toggle (ScoreStrip); here there is room to keep
// them on screen, with each player's rating and remaining cards alongside.
function ScorePanel({ players, myPlayerId, currentTurn, pointThreshold, acc }) {
    if (!players || players.length === 0) return null;

    const ranked = [...players].sort((a, b) => a.cumulativeScore - b.cumulativeScore);
    const threshold = pointThreshold || 100;

    return (
        <aside
            style={{
                display: 'flex', flexDirection: 'column', minHeight: 0,
                background: 'linear-gradient(180deg,rgba(0,0,0,.42),rgba(0,0,0,.26))',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 20,
                boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
            }}
        >
            <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, padding: '14px 16px 10px' }}>
                SCORES
            </div>

            <div className="scrollbar-thin" style={{ overflowY: 'auto', padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
                {ranked.map((p, i) => {
                    const isMe = p.id === myPlayerId;
                    const isTurn = p.id === currentTurn;
                    // Colour the score by how close it is to ending the game.
                    const scoreColor = p.cumulativeScore >= threshold * 0.8
                        ? '#ff8d96'
                        : p.cumulativeScore >= threshold * 0.5 ? '#ffab6b' : '#6ee7a8';
                    return (
                        <div
                            key={p.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                background: isMe ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                                border: `1px solid ${isTurn ? `${acc}77` : 'rgba(255,255,255,.08)'}`,
                                borderRadius: 14, padding: '9px 11px',
                            }}
                        >
                            <div style={{ width: 20, textAlign: 'center', color: i === 0 ? acc : 'rgba(244,245,247,.4)', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                                {i + 1}
                            </div>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: getAvatarTile(p.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, opacity: p.isDisconnected ? 0.5 : 1 }}>
                                {getAvatarEmoji(p.name)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="truncate" style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 12 }}>
                                    {p.name}{isMe ? ' (You)' : ''}
                                </div>
                                <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 600 }}>
                                    {p.cardCount} {p.cardCount === 1 ? 'card' : 'cards'}
                                    {p.rating !== undefined && ` · ${p.rating}`}
                                    {p.isDisconnected && ' · DC'}
                                </div>
                            </div>
                            <div style={{ color: scoreColor, fontWeight: 800, fontSize: 17, flexShrink: 0 }}>
                                {p.cumulativeScore}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '12px 14px 14px' }}>
                Lowest score wins · game ends at {threshold}
            </div>
        </aside>
    );
}

export default ScorePanel;
