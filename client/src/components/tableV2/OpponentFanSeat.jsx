import { AnimatePresence, motion } from 'framer-motion';
import PileCardGlyph from './PileCardGlyph';
import CardBackGlyph from './CardBackGlyph';
import VoiceIndicator from '../VoiceIndicator';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { ALERT_RED, isLowCards, isPass } from '../../theme/tableTheme';
import { FAN_SCALE, fanLayout, fanSize, SIDE_STEP_MAX } from './fanGeometry';

// An opponent seat on the desktop table: their hand drawn as a fan of real
// cards, with a nameplate beside it (side seats) or under it (top seat).
//
// The desktop counterpart to OpponentSeat, which keeps the phone's count badge.
// The fan *is* the count here — one card per card held, no number — so "two
// cards left" is read as a shape rather than parsed as a digit. Everything the
// badge still needs to say (whose turn, who passed, who is about to go out,
// who is disconnected) stays on the nameplate.
//
// `cards` is the seat's actual hand, which only a spectator is ever sent; a
// player at the table passes null and gets backs.
function OpponentFanSeat({
    player, position, placement, cards = null, sideStep = SIDE_STEP_MAX,
    isTurn, acc, rm, fourColor, pusoyMode,
    onPlayerClick, isClickable, hint = null,
}) {
    if (!player) return null;

    const faceUp = Array.isArray(cards) && cards.length > 0;
    const count = faceUp ? cards.length : (player.cardCount || 0);
    const passed = isPass(player.lastPlayed);
    const lowCards = isLowCards(player.cardCount);

    const step = position === 'top' ? undefined : sideStep;
    const box = fanSize(position, count, step);
    const boxes = fanLayout(position, count, step);

    const fan = (
        <div
            style={{
                position: 'relative', flexShrink: 0,
                width: box.width, height: box.height,
                // A seat that has passed is out of this trick, so its fan drops
                // back to match the PASSED chip rather than competing with the
                // seats still in play.
                filter: passed ? 'grayscale(.8) brightness(.6)' : 'none',
                opacity: passed ? 0.78 : 1,
                transition: rm ? 'none' : 'filter .25s ease, opacity .25s ease',
            }}
        >
            {boxes.map((b, i) => (
                <div
                    key={faceUp ? `${cards[i].rank}-${cards[i].suit}` : i}
                    style={{
                        position: 'absolute',
                        left: b.left, top: b.top, zIndex: b.zIndex,
                        transform: `rotate(${b.rotate}deg)`,
                    }}
                >
                    {faceUp ? (
                        <PileCardGlyph
                            rank={cards[i].rank}
                            suit={cards[i].suit}
                            fourColor={fourColor}
                            pusoyMode={pusoyMode}
                            size="pile"
                            scale={FAN_SCALE}
                            style={{ boxShadow: '0 7px 16px rgba(0,0,0,.45)' }}
                        />
                    ) : (
                        <CardBackGlyph />
                    )}
                </div>
            ))}
        </div>
    );

    const plate = (
        <div
            onClick={isClickable ? () => onPlayerClick(player) : undefined}
            style={{
                display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
                // Same alert treatment as the phone seat: an opponent about to
                // go out changes how everyone else should be playing.
                background: lowCards
                    ? 'linear-gradient(160deg,rgba(84,20,28,.62),rgba(0,0,0,.34))'
                    : 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))',
                boxShadow: lowCards
                    ? '0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.09),0 0 0 3px rgba(255,141,150,.2)'
                    : '0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.09)',
                animation: lowCards && !rm ? 'cddAlertRing 2.4s ease-in-out infinite' : 'none',
                border: `1px solid ${lowCards ? 'rgba(255,141,150,.55)' : 'rgba(255,255,255,.1)'}`,
                borderRadius: 13, padding: '6px 14px 6px 6px',
                cursor: isClickable ? 'pointer' : 'default',
            }}
        >
            <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                    width: 34, height: 34, borderRadius: 11, background: getAvatarTile(player.name),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                    animation: isTurn && !rm ? 'cddGlow 1.2s ease-in-out infinite' : 'none',
                    opacity: player.isDisconnected ? 0.5 : 1,
                }}>
                    {getAvatarEmoji(player.name)}
                </div>
                <VoiceIndicator userId={player.name} />
            </div>

            <div style={{ minWidth: 0 }}>
                <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 14, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
                    {player.name}
                    {player.isDisconnected && (
                        <span style={{ color: ALERT_RED, fontWeight: 800, fontSize: 10, marginLeft: 4 }}>DC</span>
                    )}
                </div>
                {hint && (
                    <div style={{ color: acc, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginTop: 1 }}>
                        {hint}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {passed && (
                    <motion.div
                        initial={rm ? false : { opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: rm ? 0 : 0.25 }}
                        style={{
                            background: 'rgba(0,0,0,.5)', color: 'rgba(244,245,247,.75)',
                            fontWeight: 800, fontSize: 9, letterSpacing: 2,
                            padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap',
                        }}
                    >
                        PASSED
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    return (
        <div style={{ position: 'absolute', zIndex: 10, display: 'flex', ...placement }}>
            {fan}
            {plate}
        </div>
    );
}

export default OpponentFanSeat;
