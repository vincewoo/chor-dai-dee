import { AnimatePresence, motion } from 'framer-motion';

/**
 * Mobile Scoreboard Overlay - Shows scores in a modal for mobile view
 */
const MobileScoreboard = ({
    show,
    players,
    myPlayerId,
    pointThreshold,
    onClose
}) => {
    if (!show) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="md:hidden fixed inset-0 bg-black/70 flex items-center justify-center"
                style={{ zIndex: 200 }}
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-gray-800 rounded-lg p-4 min-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="font-bold mb-3 text-yellow-400 text-lg text-center">Scores</div>
                    {players
                        .slice()
                        .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
                        .map(p => (
                            <div key={p.id} className="flex justify-between gap-6 text-white py-1">
                                <span className={p.id === myPlayerId ? 'text-yellow-300 font-medium' : ''}>{p.name}</span>
                                <span className={p.cumulativeScore >= 80 ? 'text-red-400' : p.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-green-400'}>
                                    {p.cumulativeScore}
                                </span>
                            </div>
                        ))}
                    <div className="text-xs text-gray-400 mt-3 border-t border-white/20 pt-2 text-center">
                        First to {pointThreshold || 100} loses
                    </div>
                    <button
                        onClick={onClose}
                        className="mt-3 w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                    >
                        Close
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default MobileScoreboard;
