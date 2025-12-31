import { AnimatePresence, motion } from 'framer-motion';

/**
 * Leave Confirmation Modal - Warns user about leaving mid-game
 */
const LeaveConfirmModal = ({
    show,
    isHost,
    onConfirm,
    onCancel
}) => {
    if (!show) return null;

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
                    <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white mb-4">Leave Room?</h2>

                    <div className="text-gray-300 mb-6 space-y-2">
                        {isHost ? (
                            <>
                                <p className="font-semibold text-yellow-400">You are the room host!</p>
                                <p>If you leave:</p>
                                <ul className="list-disc ml-5 space-y-1">
                                    <li>You will be replaced with a bot</li>
                                    <li>Host will transfer to another player</li>
                                    <li>You will NOT be able to rejoin this game</li>
                                </ul>
                            </>
                        ) : (
                            <>
                                <p>If you leave:</p>
                                <ul className="list-disc ml-5 space-y-1">
                                    <li>You will be replaced with a bot</li>
                                    <li>You will NOT be able to rejoin this game</li>
                                </ul>
                            </>
                        )}
                        <p className="text-sm text-gray-400 mt-3">
                            Note: Closing the browser or disconnecting accidentally will let you rejoin.
                        </p>
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition"
                        >
                            Stay
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                        >
                            Leave Room
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default LeaveConfirmModal;
