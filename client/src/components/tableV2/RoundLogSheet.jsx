import { AnimatePresence, motion } from 'framer-motion';
import RoundLogRows from './RoundLogRows';

// Bottom sheet showing every play/pass this round, grouped by trick (latest
// first). The rows themselves come from RoundLogRows, shared with the desktop
// RoundLogPanel.
function RoundLogSheet({ open, log, acc, fourColor, pusoyMode, rm, onClose }) {
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
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 16 }}>Played this round</div>
                                <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 11, fontWeight: 600 }}>newest first</div>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#f4f5f7', fontSize: 13, cursor: 'pointer' }}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="scrollbar-thin" style={{ overflowY: 'auto', padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <RoundLogRows log={log} acc={acc} fourColor={fourColor} pusoyMode={pusoyMode} />
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default RoundLogSheet;
