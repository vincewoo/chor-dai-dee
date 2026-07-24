import { motion } from 'framer-motion';

// Info-layer score chips (one per player, self first), shown under the HUD.
function ScoreStrip({ players, acc, rm }) {
    if (!players || players.length === 0) return null;
    return (
        <motion.div
            initial={rm ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: rm ? 0 : 0.25 }}
            style={{
                position: 'absolute', top: 60, left: 18, right: 18, zIndex: 20,
                display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap',
            }}
        >
            {players.map(p => (
                <div key={p.id} style={{
                    background: 'rgba(0,0,0,.42)', border: '1px solid rgba(255,255,255,.14)',
                    borderRadius: 10, padding: '4px 10px', color: '#f4f5f7', fontSize: 11, fontWeight: 600,
                }}>
                    {p.name} <span style={{ color: acc, fontWeight: 800 }}>{p.cumulativeScore}</span>
                </div>
            ))}
        </motion.div>
    );
}

export default ScoreStrip;
