import { useState } from 'react';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { ALERT_RED, isLowCards } from '../../theme/tableTheme';
import { publicRankLabel } from '../../constants/publicRank';

// The desktop scoreboard, as a corner panel rather than a rail.
//
// It replaced a 244px column down the left of the table, which was most of a
// card's width of felt spent on four numbers that change once a round. Collapsed
// it shows only what changes: rank, who, and score. Hovering (or clicking, for
// a touch-capable desktop) expands it with the three things that decide *how*
// to play the rest of the round — cards left, who is a bot, and how many points
// each player has before the game ends.
function ScoreCorner({ players, myPlayerId, currentTurn, pointThreshold, acc, side = 'left', top = 62, inset = 18 }) {
    const [expanded, setExpanded] = useState(false);

    if (!players || players.length === 0) return null;

    const ranked = [...players].sort((a, b) => a.cumulativeScore - b.cumulativeScore);
    const threshold = pointThreshold || 100;

    return (
        <div style={{ position: 'absolute', top, zIndex: 20, ...(side === 'left' ? { left: inset } : { right: inset }) }}>
            <aside
                aria-label="Scores"
                onMouseEnter={() => setExpanded(true)}
                onMouseLeave={() => setExpanded(false)}
                onClick={() => setExpanded(v => !v)}
                style={{
                    width: expanded ? 234 : 190,
                    // Collapsed, the panel sits on bare felt and can be as
                    // translucent as the rest of the table's chrome. Expanded it
                    // grows past the upper reserve and can overlay the top of a
                    // full 13-card fan, so it turns near-opaque: at 50% black a
                    // card back behind it read as a bright white shape *through*
                    // the scores. Reserving the expanded height instead would
                    // cost every viewport ~50px of pile band, and squeeze the
                    // side fans below the 19px step that keeps a spectator's
                    // ranks legible — a permanent price for a hover state.
                    background: expanded
                        ? 'linear-gradient(180deg,rgba(9,20,14,.96),rgba(5,12,9,.94))'
                        : 'linear-gradient(180deg,rgba(0,0,0,.5),rgba(0,0,0,.32))',
                    border: '1px solid rgba(255,255,255,.1)',
                    borderRadius: 14,
                    boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
                    padding: 6, display: 'flex', flexDirection: 'column', gap: 1,
                    transition: 'width .18s ease',
                }}
            >
                {ranked.map((p, i) => {
                    const isMe = p.id === myPlayerId;
                    const isTurn = p.id === currentTurn;
                    // Only an *opponent* running out is a warning; your own
                    // short hand is the thing you were playing for.
                    const lowCards = !isMe && isLowCards(p.cardCount);
                    const scoreColor = p.cumulativeScore >= threshold * 0.8
                        ? '#ff8d96'
                        : p.cumulativeScore >= threshold * 0.5 ? '#ffab6b' : '#6ee7a8';
                    return (
                        <div
                            key={p.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: expanded ? '6px 8px' : '3px 8px',
                                borderRadius: 9,
                                background: isTurn ? 'rgba(255,201,77,.14)' : (isMe ? 'rgba(255,255,255,.05)' : 'transparent'),
                                boxShadow: isTurn ? `inset 2px 0 0 ${acc}` : 'none',
                                transition: 'padding .18s ease',
                            }}
                        >
                            <div style={{ width: 10, textAlign: 'center', color: i === 0 ? acc : 'rgba(244,245,247,.38)', fontWeight: 800, fontSize: 10, flexShrink: 0 }}>
                                {i + 1}
                            </div>
                            <div style={{ width: 22, height: 22, borderRadius: 7, background: getAvatarTile(p.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, opacity: p.isDisconnected ? 0.5 : 1 }}>
                                {getAvatarEmoji(p.name)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: isMe ? '#f4f5f7' : 'rgba(244,245,247,.82)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {p.name}{isMe ? ' (You)' : ''}
                                </div>
                                {expanded && (
                                    <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 9.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                        <span style={lowCards ? { color: ALERT_RED, fontWeight: 800 } : undefined}>
                                            {p.cardCount} {p.cardCount === 1 ? 'card' : 'cards'}
                                        </span>
                                        {` · ${p.isBot ? 'Bot' : publicRankLabel(p.publicRank)}`}
                                        {` · ${Math.max(0, threshold - p.cumulativeScore)} to go`}
                                        {p.isDisconnected && ' · DC'}
                                    </div>
                                )}
                            </div>
                            <div style={{ color: scoreColor, fontWeight: 800, fontSize: 14, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                {p.cumulativeScore}
                            </div>
                        </div>
                    );
                })}

                <div style={{ color: 'rgba(244,245,247,.35)', fontSize: 9, fontWeight: 700, letterSpacing: 1, textAlign: 'center', padding: '5px 0 2px' }}>
                    {expanded ? `LOWEST SCORE WINS · ENDS AT ${threshold}` : `ENDS AT ${threshold}`}
                </div>
            </aside>
        </div>
    );
}

export default ScoreCorner;
