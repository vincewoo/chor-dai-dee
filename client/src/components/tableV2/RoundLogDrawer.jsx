import { AnimatePresence, motion } from 'framer-motion';
import RoundLogRows from './RoundLogRows';

// The round log as a slide-in panel from the right, opened by clicking the
// pile. The desktop counterpart to the phone's RoundLogSheet: the same rows
// (RoundLogRows), arriving from the side rather than from the bottom, because
// on a wide screen the log is beside the table rather than under it.
//
// It replaced a permanent 304px rail. The log is a thing you consult a few
// times a round, so it now costs nothing until you ask for it and the felt it
// used to occupy went to the pile.
function RoundLogDrawer({ open, log, acc, fourColor, pusoyMode, rm, onClose, partial = false }) {
    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: rm ? 0 : 0.28 }}
                        onClick={onClose}
                        style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(8,9,12,.55)' }}
                    />
                    <motion.aside
                        initial={rm ? false : { x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ duration: rm ? 0 : 0.3, ease: [0.2, 0.8, 0.3, 1] }}
                        style={{
                            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(380px,86%)', zIndex: 95,
                            background: 'linear-gradient(180deg,rgba(24,27,33,.97),rgba(13,15,19,.98))',
                            borderLeft: '1px solid rgba(255,255,255,.12)',
                            boxShadow: '-18px 0 44px rgba(0,0,0,.55)',
                            display: 'flex', flexDirection: 'column',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 12px', flexShrink: 0 }}>
                            <div>
                                <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 16 }}>Played this round</div>
                                <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                                    {log.length} {log.length === 1 ? 'play' : 'plays'} · newest first
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#f4f5f7', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
                            >
                                ✕
                            </button>
                        </div>
                        <div
                            className="scrollbar-thin"
                            style={{ overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}
                        >
                            <RoundLogRows log={log} acc={acc} fourColor={fourColor} pusoyMode={pusoyMode} partial={partial} emptyText="Nothing played yet this round." />
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}

export default RoundLogDrawer;
