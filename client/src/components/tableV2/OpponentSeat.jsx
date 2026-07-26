import { AnimatePresence, motion } from 'framer-motion';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { isPass } from '../../theme/tableTheme';
import VoiceIndicator from '../VoiceIndicator';

// Seat metrics per size. 'sm' is the original mobile seat; 'lg' gives the
// desktop table a badge that reads at arm's length.
const SIZES = {
    sm: { tile: 38, emoji: 22, radius: 12, name: 13, rating: 11, count: 11, gap: 9, padY: 6, padX: 14 },
    lg: { tile: 50, emoji: 29, radius: 15, name: 16, rating: 13, count: 13, gap: 11, padY: 8, padX: 16 },
};

// A two-card glyph with the opponent's remaining card count.
function CountGlyph({ count, acc, align = 'left', fontSize = 11 }) {
    const glyph = (
        <div style={{ position: 'relative', width: 15, height: 17 }}>
            <div style={{ position: 'absolute', left: 0, top: 2, width: 10, height: 14, borderRadius: 3, background: acc, opacity: 0.35, transform: 'rotate(-10deg)' }} />
            <div style={{ position: 'absolute', left: 4, top: 0, width: 10, height: 14, borderRadius: 3, background: acc }} />
        </div>
    );
    const num = <span style={{ color: 'rgba(244,245,247,.7)', fontSize, fontWeight: 700 }}>{count}</span>;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
            {align === 'right' ? <>{num}{glyph}</> : <>{glyph}{num}</>}
        </div>
    );
}

// One opponent seat badge. `position` controls which side of the badge the
// avatar sits on ('top' | 'left' | 'right'); `placement` positions the whole
// cluster and defaults to the mobile layout. `size` picks the metrics above.
function OpponentSeat({
    player, position, isTurn, infoOn, acc, rm,
    onPlayerClick, isClickable, voiceLevel = 0, hint = null,
    placement, size = 'sm',
}) {
    if (!player) return null;

    const m = SIZES[size] || SIZES.sm;

    const rightAligned = position === 'right';
    const passed = isPass(player.lastPlayed);
    const emoji = getAvatarEmoji(player.name);
    const tile = getAvatarTile(player.name);

    // Position of the whole seat cluster. Defaults to the mobile placement.
    const wrapperStyle = placement || (
        position === 'top'
            ? { top: 96, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' }
            : position === 'left'
                ? { top: 178, left: 12, alignItems: 'flex-start' }
                : { top: 178, right: 12, alignItems: 'flex-end' }
    );

    const avatarTile = (
        <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
                width: m.tile, height: m.tile, borderRadius: m.radius,
                background: tile,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: m.emoji,
                animation: isTurn && !rm ? 'cddGlow 1.2s ease-in-out infinite' : 'none',
                opacity: player.isDisconnected ? 0.5 : 1,
            }}>
                {emoji}
            </div>
            <VoiceIndicator isActive={voiceLevel > 0.05} level={voiceLevel} />
        </div>
    );

    const nameBlock = (
        <div style={{ textAlign: rightAligned ? 'right' : 'left', minWidth: 0 }}>
            <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: m.name, lineHeight: 1.15 }}>
                {player.name}
                {infoOn && player.rating !== undefined && (
                    <span style={{ color: acc, fontWeight: 600, fontSize: m.rating }}> · {player.rating}</span>
                )}
                {player.isDisconnected && (
                    <span style={{ color: '#ff8d96', fontWeight: 800, fontSize: 10, marginLeft: 4 }}>DC</span>
                )}
            </div>
            <CountGlyph count={player.cardCount} acc={acc} align={rightAligned ? 'right' : 'left'} fontSize={m.count} />
            {hint && (
                <div style={{ color: acc, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginTop: 1 }}>
                    {hint}
                </div>
            )}
        </div>
    );

    const passChip = (
        <AnimatePresence>
            {passed && (
                <motion.div
                    initial={rm ? false : { opacity: 0, y: 6, scale: 0.85 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: rm ? 0 : 0.25 }}
                    style={{
                        marginLeft: position === 'left' ? 8 : 0,
                        marginRight: position === 'right' ? 8 : 0,
                        background: 'rgba(0,0,0,.5)', color: 'rgba(244,245,247,.75)',
                        fontWeight: 800, fontSize: 10, letterSpacing: 2, padding: '3px 10px', borderRadius: 8,
                    }}
                >
                    PASSED
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <div style={{ position: 'absolute', zIndex: 10, display: 'flex', flexDirection: 'column', gap: 5, ...wrapperStyle }}>
            <div
                onClick={isClickable ? () => onPlayerClick(player) : undefined}
                style={{
                    display: 'flex', alignItems: 'center', gap: m.gap,
                    background: 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))',
                    boxShadow: '0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.09)',
                    borderRadius: 14,
                    padding: rightAligned
                        ? `${m.padY}px ${m.padY}px ${m.padY}px ${m.padX}px`
                        : `${m.padY}px ${m.padX}px ${m.padY}px ${m.padY}px`,
                    border: '1px solid rgba(255,255,255,.1)',
                    cursor: isClickable ? 'pointer' : 'default',
                }}
            >
                {rightAligned ? <>{nameBlock}{avatarTile}</> : <>{avatarTile}{nameBlock}</>}
            </div>
            {passChip}
        </div>
    );
}

export default OpponentSeat;
