import { AnimatePresence, motion } from 'framer-motion';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { ALERT_RED, isLowCards, isPass } from '../../theme/tableTheme';
import VoiceIndicator from '../VoiceIndicator';
import {
    DEFAULT_BOT_DIFFICULTY,
    botDifficultyLabel
} from '../../constants/botDifficulty';

// Seat metrics per size. 'sm' is the original mobile seat; 'lg' gives the
// desktop table a badge that reads at arm's length.
const SIZES = {
    sm: { tile: 38, emoji: 22, radius: 12, name: 13, rating: 11, count: 11, gap: 9, padY: 6, padX: 14 },
    lg: { tile: 50, emoji: 29, radius: 15, name: 16, rating: 13, count: 13, gap: 11, padY: 8, padX: 16 },
};

// A two-card glyph with the opponent's remaining card count. Below the low-card
// threshold the row becomes an alert chip: warm red, heavier number, and the
// word LEFT so a glance can't read the count as a score.
function CountGlyph({ count, acc, align = 'left', fontSize = 11, low = false }) {
    const tint = low ? ALERT_RED : acc;
    const glyph = (
        <div style={{ position: 'relative', width: 15, height: 17 }}>
            <div style={{ position: 'absolute', left: 0, top: 2, width: 10, height: 14, borderRadius: 3, background: tint, opacity: 0.35, transform: 'rotate(-10deg)' }} />
            <div style={{ position: 'absolute', left: 4, top: 0, width: 10, height: 14, borderRadius: 3, background: tint }} />
        </div>
    );
    const num = (
        <span style={{
            color: low ? '#ffe0e3' : 'rgba(244,245,247,.7)',
            fontSize: low ? fontSize + 1 : fontSize,
            fontWeight: low ? 900 : 700,
        }}>
            {count}
        </span>
    );
    const tag = low ? (
        <span style={{ color: ALERT_RED, fontSize: fontSize - 2, fontWeight: 800, letterSpacing: 0.7 }}>LEFT</span>
    ) : null;
    // inline-flex so the chip hugs its contents; the name block's text-align
    // is what pushes it to the correct edge on a right-hand seat.
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2,
            ...(low ? {
                background: 'rgba(255,141,150,.16)',
                border: `1px solid ${ALERT_RED}66`,
                borderRadius: 8, padding: '0px 6px',
            } : null),
        }}>
            {/* The glyph stays on the avatar's side of the row, but the number
                always precedes the word so it reads "2 LEFT" either way. */}
            {align === 'right' ? <>{num}{tag}{glyph}</> : <>{glyph}{num}{tag}</>}
        </div>
    );
}

// One opponent seat badge. `position` controls which side of the badge the
// avatar sits on ('top' | 'left' | 'right'); `placement` positions the whole
// cluster and defaults to the mobile layout. `size` picks the metrics above.
function OpponentSeat({
    player, position, isTurn, infoOn, acc, rm,
    onPlayerClick, isClickable, hint = null,
    placement, size = 'sm',
}) {
    if (!player) return null;

    const m = SIZES[size] || SIZES.sm;

    const rightAligned = position === 'right';
    const passed = isPass(player.lastPlayed);
    const lowCards = isLowCards(player.cardCount);
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
            <VoiceIndicator userId={player.name} />
        </div>
    );

    // Weakened bots say so. A competitive bot is the default and carries no
    // badge, so a table nobody has reconfigured is unchanged.
    const botTierLabel = player.isBot &&
        player.botDifficulty &&
        player.botDifficulty !== DEFAULT_BOT_DIFFICULTY
        ? botDifficultyLabel(player.botDifficulty)
        : null;

    const nameBlock = (
        <div style={{ textAlign: rightAligned ? 'right' : 'left', minWidth: 0 }}>
            <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: m.name, lineHeight: 1.15 }}>
                {player.name}
                {infoOn && player.rating !== undefined && (
                    <span style={{ color: acc, fontWeight: 600, fontSize: m.rating }}> · {player.rating}</span>
                )}
                {player.isDisconnected && (
                    <span style={{ color: ALERT_RED, fontWeight: 800, fontSize: 10, marginLeft: 4 }}>DC</span>
                )}
                {/* Only for a bot playing below full strength, so a default
                    table looks exactly as it did before tiers existed. */}
                {botTierLabel && (
                    <span style={{ color: 'rgba(244,245,247,.45)', fontWeight: 700, fontSize: 9, marginLeft: 4 }}>
                        {botTierLabel.toUpperCase()}
                    </span>
                )}
            </div>
            <CountGlyph
                count={player.cardCount}
                acc={acc}
                align={rightAligned ? 'right' : 'left'}
                fontSize={m.count}
                low={lowCards}
            />
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
                    // A seat about to go out is warmed and ringed so it reads
                    // from the corner of the eye, without shouting over the
                    // accent glow that marks whose turn it is.
                    background: lowCards
                        ? 'linear-gradient(160deg,rgba(84,20,28,.62),rgba(0,0,0,.34))'
                        : 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))',
                    boxShadow: lowCards
                        ? '0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.09),0 0 0 3px rgba(255,141,150,.2)'
                        : '0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.09)',
                    animation: lowCards && !rm ? 'cddAlertRing 2.4s ease-in-out infinite' : 'none',
                    borderRadius: 14,
                    padding: rightAligned
                        ? `${m.padY}px ${m.padY}px ${m.padY}px ${m.padX}px`
                        : `${m.padY}px ${m.padX}px ${m.padY}px ${m.padY}px`,
                    border: `1px solid ${lowCards ? 'rgba(255,141,150,.55)' : 'rgba(255,255,255,.1)'}`,
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
