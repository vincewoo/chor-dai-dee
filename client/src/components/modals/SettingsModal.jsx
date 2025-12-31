import { AnimatePresence, motion } from 'framer-motion';

/**
 * Settings Modal - Game settings like Auto-Pass and 4-Color mode
 */
const SettingsModal = ({
    show,
    onClose,
    autoPass,
    toggleAutoPass,
    fourColorMode,
    toggleFourColorMode
}) => {
    if (!show) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[200] bg-black/70 flex items-center justify-center"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center mb-6 md:mb-[1.5vmax]">
                        <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white">Settings</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-3xl md:text-[2vmax] font-bold leading-none"
                        >
                            ×
                        </button>
                    </div>

                    <div className="space-y-4 md:space-y-[1vmax]">
                        {/* Auto-Pass Setting */}
                        <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                            <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                <label className="text-white font-semibold text-lg md:text-[1.2vmax]">
                                    Auto-Pass
                                </label>
                                <button
                                    onClick={toggleAutoPass}
                                    className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]
                                        ${autoPass ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                >
                                    {autoPass ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                Automatically pass when you have no cards that can beat the played hand
                            </p>
                        </div>

                        {/* 4-Color Setting */}
                        <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                            <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                <label className="text-white font-semibold text-lg md:text-[1.2vmax]">
                                    4-Color Suits
                                </label>
                                <button
                                    onClick={toggleFourColorMode}
                                    className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]
                                        ${fourColorMode ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                >
                                    {fourColorMode ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                Use 4-color suits for better visibility (blue diamonds, green clubs)
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 md:mt-[1.5vmax] flex justify-end">
                        <button
                            onClick={onClose}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 md:px-[2vmax] py-2 md:py-[0.6vmax] rounded-lg font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default SettingsModal;
