import { AnimatePresence, motion } from 'framer-motion';
import { ACCENTS, ACCENT_KEYS } from '../../theme/tableTheme';

/**
 * Settings Modal - Game settings like Auto-Pass and 4-Color mode,
 * plus the v2 mobile table theme (surface / accent / reduced motion).
 */
const SettingsModal = ({
    show,
    onClose,
    autoPass,
    toggleAutoPass,
    fourColorMode,
    toggleFourColorMode,
    // v2 table theme (optional)
    tableTheme,
    setTableTheme,
    accentColor,
    setAccentColor,
    reducedMotion,
    toggleReducedMotion,
    onLeave
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
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
            >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center mb-6 md:mb-[1.5vmax]">
                        <h2 id="settings-title" className="text-2xl md:text-[1.8vmax] font-bold text-white">Settings</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-3xl md:text-[2vmax] font-bold leading-none focus-visible:ring-2 focus-visible:ring-white rounded"
                            aria-label="Close settings"
                        >
                            ×
                        </button>
                    </div>

                    <div className="space-y-4 md:space-y-[1vmax]">
                        {/* Auto-Pass Setting */}
                        <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                            <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                <label
                                    id="auto-pass-label"
                                    className="text-white font-semibold text-lg md:text-[1.2vmax]"
                                >
                                    Auto-Pass
                                </label>
                                <button
                                    role="switch"
                                    aria-checked={autoPass}
                                    aria-labelledby="auto-pass-label"
                                    onClick={toggleAutoPass}
                                    className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-500 focus-visible:outline-none
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
                                <label
                                    id="four-color-label"
                                    className="text-white font-semibold text-lg md:text-[1.2vmax]"
                                >
                                    4-Color Suits
                                </label>
                                <button
                                    role="switch"
                                    aria-checked={fourColorMode}
                                    aria-labelledby="four-color-label"
                                    onClick={toggleFourColorMode}
                                    className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:outline-none
                                        ${fourColorMode ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                >
                                    {fourColorMode ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                Use 4-color suits for better visibility (blue diamonds, green clubs)
                            </p>
                        </div>

                        {/* Table Theme (mobile) */}
                        {setTableTheme && (
                            <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-white font-semibold text-lg md:text-[1.2vmax]">Table Theme</span>
                                    <span className="text-gray-400 text-xs">mobile</span>
                                </div>

                                {/* Surface */}
                                <div className="flex items-center gap-2 mb-3" role="group" aria-label="Table surface">
                                    {['felt', 'ink'].map(s => (
                                        <button
                                            key={s}
                                            onClick={() => setTableTheme(s)}
                                            aria-pressed={tableTheme === s}
                                            className={`flex-1 py-2 rounded-lg font-semibold text-sm capitalize transition
                                                ${tableTheme === s
                                                    ? 'bg-white/90 text-gray-900'
                                                    : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>

                                {/* Accent */}
                                <div className="flex items-center gap-3 mb-3" role="group" aria-label="Accent color">
                                    {ACCENT_KEYS.map(key => (
                                        <button
                                            key={key}
                                            onClick={() => setAccentColor(key)}
                                            aria-label={`${key} accent`}
                                            aria-pressed={accentColor === key}
                                            className="w-9 h-9 rounded-full transition transform hover:scale-110"
                                            style={{
                                                background: `linear-gradient(135deg,${ACCENTS[key].acc},${ACCENTS[key].dark})`,
                                                boxShadow: accentColor === key
                                                    ? `0 0 0 2px #1f2937, 0 0 0 4px ${ACCENTS[key].acc}`
                                                    : 'none'
                                            }}
                                        />
                                    ))}
                                </div>

                                {/* Reduced motion */}
                                <div className="flex items-center justify-between">
                                    <label id="reduced-motion-label" className="text-white font-semibold text-base md:text-[1vmax]">
                                        Reduced Motion
                                    </label>
                                    <button
                                        role="switch"
                                        aria-checked={!!reducedMotion}
                                        aria-labelledby="reduced-motion-label"
                                        onClick={toggleReducedMotion}
                                        className={`px-4 py-2 rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base
                                            ${reducedMotion ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                    >
                                        {reducedMotion ? 'ON' : 'OFF'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-6 md:mt-[1.5vmax] flex justify-between items-center gap-3">
                        {onLeave ? (
                            <button
                                onClick={onLeave}
                                className="bg-red-600/80 hover:bg-red-600 text-white px-5 py-2 rounded-lg font-bold shadow-lg transition text-base"
                            >
                                Leave Room
                            </button>
                        ) : <span />}
                        <button
                            onClick={onClose}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 md:px-[2vmax] py-2 md:py-[0.6vmax] rounded-lg font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-white"
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
