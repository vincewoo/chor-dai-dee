import { AnimatePresence, motion } from 'framer-motion';
import PileCardGlyph from './PileCardGlyph';
import { getAvatarEmoji } from '../../utils/avatars';
import { describeHand } from '../../theme/tableTheme';

// Bottom sheet showing every play/pass this round, grouped by trick (latest first).
function RoundLogSheet({ open, log, acc, fourColor, rm, onClose }) {
    // Reverse to show most recent first; compute trick-head dividers.
    const rows = [...log].reverse();

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(8,9,12,.62)' }}
                    />
                    <motion.div
                        initial={rm ? false : { y: 60, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 60, opacity: 0 }}
                        transition={{ duration: rm ? 0 : 0.28, ease: 'easeOut' }}
                        style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 520, zIndex: 95,
                            background: 'linear-gradient(180deg,rgba(24,27,33,.97),rgba(13,15,19,.98))',
                            border: '1px solid rgba(255,255,255,.12)', borderBottom: 'none',
                            borderRadius: '24px 24px 0 0', boxShadow: '0 -18px 44px rgba(0,0,0,.55)',
                            display: 'flex', flexDirection: 'column',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 10px' }}>
                            <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 16 }}>Played this round</div>
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#f4f5f7', fontSize: 13, cursor: 'pointer' }}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="scrollbar-thin" style={{ overflowY: 'auto', padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {rows.length === 0 && (
                                <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 13, textAlign: 'center', padding: '18px 0' }}>No plays yet.</div>
                            )}
                            {rows.map((e, i) => {
                                const showHead = i === 0 || rows[i - 1].trick !== e.trick;
                                return (
                                    <div key={e.key || `${e.trick}-${e.playOrder}`}>
                                        {showHead && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                                                <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.1)' }} />
                                                <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>TRICK {e.trick}</div>
                                                <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.1)' }} />
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '8px 12px' }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(145deg,#ffffff,#dfe5ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                                                {getAvatarEmoji(e.name)}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 12 }}>{e.name}</div>
                                                <div style={{ color: e.isPass ? 'rgba(244,245,247,.4)' : acc, fontWeight: 600, fontSize: 11 }}>
                                                    {e.isPass ? 'Passed' : describeHand(e.handType, e.cards)}
                                                </div>
                                            </div>
                                            {!e.isPass && (
                                                <div style={{ display: 'flex' }}>
                                                    {e.cards.map((c, j) => (
                                                        <PileCardGlyph
                                                            key={`${c.rank}-${c.suit}`}
                                                            rank={c.rank}
                                                            suit={c.suit}
                                                            fourColor={fourColor}
                                                            size="log"
                                                            style={{ marginLeft: j === 0 ? 0 : -10 }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default RoundLogSheet;
