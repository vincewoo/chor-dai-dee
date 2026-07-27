import { AnimatePresence, motion } from 'framer-motion';
import { ACCENTS, ACCENT_KEYS } from '../../theme/tableTheme';
import { playSound } from '../../utils/sounds';

/**
 * Settings Modal - Game settings like Auto-Pass and 4-Color mode,
 * plus the v2 mobile table theme (surface / accent / reduced motion).
 */
const SettingsModal = ({
    show,
    onClose,
    autoPass,
    toggleAutoPass,
    coachEnabled,
    toggleCoach,
    fourColorMode,
    toggleFourColorMode,
    pusoyMode,
    togglePusoyMode,
    // v2 table theme (optional)
    tableTheme,
    setTableTheme,
    accentColor,
    setAccentColor,
    reducedMotion,
    toggleReducedMotion,
    // sound (optional)
    soundEnabled,
    toggleSound,
    soundVolume,
    setSoundVolume,
    onLeave
}) => {
    if (!show) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
                onClick={onClose}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
            >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    // The panel is a fixed header + scrolling body + fixed
                    // footer, capped at the overlay's height. The settings list
                    // is long enough to overflow a phone on its own, and did:
                    // as one growing block it simply ran off the bottom of the
                    // screen, taking Close and Leave Room with it.
                    className="bg-gray-800 rounded-xl shadow-2xl max-w-md w-full flex flex-col max-h-full overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex shrink-0 justify-between items-center px-8 md:px-[2vmax] pt-8 md:pt-[2vmax] pb-4 md:pb-[1vmax]">
                        <h2 id="settings-title" className="text-2xl md:text-[1.8vmax] font-bold text-white">Settings</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-3xl md:text-[2vmax] font-bold leading-none focus-visible:ring-2 focus-visible:ring-white rounded"
                            aria-label="Close settings"
                        >
                            ×
                        </button>
                    </div>

                    {/* `min-h-0` is what actually lets this scroll: a flex child
                        defaults to min-height:auto and would just grow instead. */}
                    <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto overscroll-contain px-8 md:px-[2vmax] py-1 space-y-4 md:space-y-[1vmax]">
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

                        {/* Coach — adds the owl button to the Pass/Play row */}
                        {toggleCoach && (
                            <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                                <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                    <label
                                        id="coach-label"
                                        className="text-white font-semibold text-lg md:text-[1.2vmax]"
                                    >
                                        🦉 Coach
                                    </label>
                                    <button
                                        role="switch"
                                        aria-checked={!!coachEnabled}
                                        aria-labelledby="coach-label"
                                        onClick={toggleCoach}
                                        className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-500 focus-visible:outline-none
                                            ${coachEnabled ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                    >
                                        {coachEnabled ? 'ON' : 'OFF'}
                                    </button>
                                </div>
                                <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                    Adds an owl beside Pass and Play. Tap it on your turn and it picks
                                    your best move — selecting the cards for you — and says why.
                                    It also speaks up when you misplay a hand.
                                </p>
                            </div>
                        )}

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

                        {/* Pusoy Dos Suit Lens (display only) */}
                        <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                            <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                <label
                                    id="pusoy-mode-label"
                                    className="text-white font-semibold text-lg md:text-[1.2vmax]"
                                >
                                    Pusoy Dos Suits
                                </label>
                                <button
                                    role="switch"
                                    aria-checked={!!pusoyMode}
                                    aria-labelledby="pusoy-mode-label"
                                    onClick={togglePusoyMode}
                                    className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:outline-none
                                        ${pusoyMode ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                >
                                    {pusoyMode ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                Display suits in Filipino Pusoy Dos order: ♣ lowest, then ♠, ♥, ♦ highest.
                                Changes only what you see — the game rules and every other player's view are unchanged.
                            </p>
                        </div>

                        {/* Sound Effects */}
                        {toggleSound && (
                            <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                                <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                    <label
                                        id="sound-label"
                                        className="text-white font-semibold text-lg md:text-[1.2vmax]"
                                    >
                                        Sound Effects
                                    </label>
                                    <button
                                        role="switch"
                                        aria-checked={!!soundEnabled}
                                        aria-labelledby="sound-label"
                                        onClick={toggleSound}
                                        className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-500 focus-visible:outline-none
                                            ${soundEnabled ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                    >
                                        {soundEnabled ? 'ON' : 'OFF'}
                                    </button>
                                </div>
                                <p className="text-gray-300 text-sm md:text-[0.85vmax] mb-3">
                                    Card shuffles, plays, and win chimes
                                </p>

                                {setSoundVolume && (
                                    <div className="flex items-center gap-3">
                                        <label htmlFor="sound-volume" className="text-gray-300 text-sm shrink-0">
                                            Volume
                                        </label>
                                        <input
                                            id="sound-volume"
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            value={soundVolume ?? 0.6}
                                            disabled={!soundEnabled}
                                            onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                                            // Preview the new level once the user settles on it.
                                            onPointerUp={() => playSound('play')}
                                            onKeyUp={() => playSound('play')}
                                            className={`flex-1 accent-green-500 ${soundEnabled ? '' : 'opacity-40'}`}
                                        />
                                        <span className="text-gray-300 text-sm w-10 text-right tabular-nums">
                                            {Math.round((soundVolume ?? 0.6) * 100)}%
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

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

                    <div className="flex shrink-0 justify-between items-center gap-3 px-8 md:px-[2vmax] pb-8 md:pb-[2vmax] pt-4 md:pt-[1vmax] border-t border-white/10">
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
