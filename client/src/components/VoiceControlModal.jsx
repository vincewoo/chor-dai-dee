import { motion, AnimatePresence } from 'framer-motion';
import useVoiceParticipants from '../hooks/useVoiceParticipants';

const VoiceControlModal = ({
  isOpen,
  onClose,
  voiceEnabled,
  isVoiceConnected,
  isMuted,
  isDeafened,
  forcedMute = false,
  onToggleVoice,
  onToggleMute,
  onToggleDeafen,
  onVolumeChange,
  players = [],
  peers = [],
  playerVolumes = {},
  username
}) => {
  // Includes spectators, who are peers without a seat
  const voiceParticipants = useVoiceParticipants(players, peers, username);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop to catch clicks and dim the table behind the popover */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/30"
            onClick={onClose}
          />

          {/* Floating modal - anchored under the mic button in the top HUD */}
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-16 right-4 z-[301] bg-gray-800/95 backdrop-blur-sm rounded-xl shadow-xl p-4 w-72 border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold text-white">Voice Chat</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700"
                aria-label="Close voice control"
              >
                ×
              </button>
            </div>

            {/* Voice Enable/Disable Toggle */}
            <div className="mb-4">
              <button
                onClick={onToggleVoice}
                className={`
                  w-full py-2.5 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm
                  ${voiceEnabled
                    ? isVoiceConnected
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                    : 'bg-gray-600 hover:bg-gray-500 text-white'
                  }
                `}
              >
                <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={voiceEnabled
                      ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    }
                  />
                </svg>
                {voiceEnabled
                  ? isVoiceConnected
                    ? 'Voice Connected'
                    : 'Connecting...'
                  : 'Join Voice Chat'
                }
              </button>
            </div>

            {/* Controls (only when voice is enabled) */}
            {voiceEnabled && isVoiceConnected && (
              <>
                {/* Mute/Deafen buttons */}
                <div className="flex gap-2 mb-4">
                  {/* Mute button */}
                  <button
                    onClick={onToggleMute}
                    disabled={forcedMute}
                    title={forcedMute ? 'The host has muted spectators' : undefined}
                    className={`
                      flex-1 py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 text-sm
                      ${forcedMute
                        ? 'bg-red-900 text-red-200 cursor-not-allowed'
                        : isMuted
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-gray-600 hover:bg-gray-500 text-white'
                      }
                    `}
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {isMuted ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      )}
                    </svg>
                    {forcedMute ? 'Muted by host' : isMuted ? 'Unmute' : 'Mute'}
                  </button>

                  {/* Deafen button */}
                  <button
                    onClick={onToggleDeafen}
                    className={`
                      flex-1 py-2 px-3 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 text-sm
                      ${isDeafened
                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                        : 'bg-gray-600 hover:bg-gray-500 text-white'
                      }
                    `}
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {isDeafened ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                        />
                      )}
                    </svg>
                    {isDeafened ? 'Undeafen' : 'Deafen'}
                  </button>
                </div>

                {/* Volume Controls */}
                {peers.length > 0 && (
                  <div className="border-t border-gray-700 pt-3">
                    <h3 className="text-white font-medium text-sm mb-2">Player Volumes</h3>
                    <div className="space-y-3 max-h-40 overflow-y-auto">
                      {voiceParticipants
                        .map(player => {
                          // playerVolumes stores values as 0-1 decimals, convert to 0-100 for display
                          const volumePercent = Math.round((playerVolumes[player.name] ?? 1) * 100);
                          return (
                            <div key={player.id} className="flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-300 text-xs truncate">
                                  {player.isSpectator && <span title="Spectator">👁 </span>}
                                  {player.name}
                                </span>
                                <span className="text-gray-400 text-xs tabular-nums">
                                  {volumePercent}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={volumePercent}
                                onChange={(e) => onVolumeChange(player.name, parseInt(e.target.value))}
                                onInput={(e) => onVolumeChange(player.name, parseInt(e.target.value))}
                                className="w-full accent-green-500 h-1"
                                style={{ touchAction: 'manipulation' }}
                                aria-label={`Volume for ${player.name}`}
                              />
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Permission Error Note */}
            {!voiceEnabled && (
              <p className="text-gray-400 text-xs text-center">
                Click to enable voice chat. You'll be asked to allow microphone access.
              </p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default VoiceControlModal;
