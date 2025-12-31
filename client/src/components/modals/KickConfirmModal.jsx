import { AnimatePresence, motion } from 'framer-motion';

/**
 * Kick Player Confirmation Modal - Confirms kicking a player
 */
const KickConfirmModal = ({
    show,
    playerToKick,
    isGameInProgress,
    onConfirm,
    onCancel
}) => {
    if (!show || !playerToKick) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[200] bg-black/80 flex items-center justify-center"
                onClick={onCancel}
            >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white mb-4">Kick Player?</h2>

                    <div className="text-gray-300 mb-6 space-y-2">
                        <p>
                            Are you sure you want to kick <span className="font-bold text-yellow-400">{playerToKick.name}</span>?
                        </p>
                        <ul className="list-disc ml-5 space-y-1 mt-3">
                            {isGameInProgress ? (
                                <>
                                    <li>They will be replaced with a bot</li>
                                    <li>They will NOT be able to rejoin this game</li>
                                </>
                            ) : (
                                <li>They will be removed from the room</li>
                            )}
                        </ul>
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                        >
                            Kick Player
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default KickConfirmModal;
