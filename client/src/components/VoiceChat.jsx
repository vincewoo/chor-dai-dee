import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoice, useVoiceAudio } from '../contexts/VoiceContext';
import { AnimatePresence, motion } from 'framer-motion';

const VoiceChat = ({
  roomId,
  username,
  players,
  onVoiceStateChange
}) => {
  const [showVolumeControls, setShowVolumeControls] = useState(false);

  const {
    voiceEnabled,
    isVoiceConnected,
    isMuted,
    isDeafened,
    peers,
    // audioLevels, // ⚡ Bolt Optimization: Moved to separate hook
    permissionError,
    playerVolumes,
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleMute,
    toggleDeafen,
    setPlayerVolume
  } = useVoice();

  // ⚡ Bolt Optimization: Consume high-frequency updates from separate context
  const { audioLevels } = useVoiceAudio();

  // Store stable callback refs to avoid infinite loops
  const callbacksRef = useRef({});

  // Handle voice toggle
  const handleVoiceToggle = useCallback(async () => {
    if (!voiceEnabled) {
      await joinVoiceRoom(roomId, username);
    } else {
      leaveVoiceRoom();
      setShowVolumeControls(false);
    }
  }, [voiceEnabled, roomId, username, joinVoiceRoom, leaveVoiceRoom]);

  // Handle volume change for a player
  const handleVolumeChange = useCallback((playerId, volume) => {
    const normalizedVolume = typeof volume === 'string' ? parseInt(volume) : volume;
    setPlayerVolume(playerId, normalizedVolume / 100);
  }, [setPlayerVolume]);

  // Update callbacks ref
  useEffect(() => {
    callbacksRef.current = {
      handleVoiceToggle,
      toggleMute,
      toggleDeafen,
      handleVolumeChange
    };
  }, [handleVoiceToggle, toggleMute, toggleDeafen, handleVolumeChange]);

  // Expose voice state to parent component for the mobile bubble
  useEffect(() => {
    if (onVoiceStateChange) {
      onVoiceStateChange({
        voiceEnabled,
        isVoiceConnected,
        isMuted,
        isDeafened,
        peers,
        playerVolumes,
        permissionError,
        handleVoiceToggle: () => callbacksRef.current.handleVoiceToggle?.(),
        toggleMute: () => callbacksRef.current.toggleMute?.(),
        toggleDeafen: () => callbacksRef.current.toggleDeafen?.(),
        handleVolumeChange: (playerId, vol) => callbacksRef.current.handleVolumeChange?.(playerId, vol)
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    voiceEnabled,
    isVoiceConnected,
    isMuted,
    isDeafened,
    JSON.stringify(peers),
    JSON.stringify(playerVolumes),
    permissionError
  ]);

  // Get speaking indicator size based on audio level
  const getSpeakingIndicator = (level) => {
    if (!level || level < 0.05) return null;
    const scale = 1 + (level * 0.5);
    return scale;
  };

  return (
    <>
      {/* Voice Control Panel - Desktop only (hidden on mobile) */}
      <div className="hidden md:flex fixed bottom-4 left-4 z-40 items-center gap-2">
        {/* Main Voice Toggle */}
        <button
          onClick={handleVoiceToggle}
          className={`
            px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2
            ${voiceEnabled
              ? isVoiceConnected
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white'
            }
          `}
          title={voiceEnabled ? 'Disable Voice Chat' : 'Enable Voice Chat'}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
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
              ? 'Voice On'
              : 'Connecting...'
            : 'Voice Off'
          }
        </button>

        {/* Mute Button (when voice is enabled) */}
        {voiceEnabled && isVoiceConnected && (
          <>
            <button
              onClick={toggleMute}
              className={`
                p-2 rounded-lg transition-all
                ${isMuted
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-gray-700 hover:bg-gray-600'
                } text-white
              `}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isMuted ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2 2m0-2l-2 2"
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
            </button>

            {/* Deafen Button */}
            <button
              onClick={toggleDeafen}
              className={`
                p-2 rounded-lg transition-all
                ${isDeafened
                  ? 'bg-orange-600 hover:bg-orange-700'
                  : 'bg-gray-700 hover:bg-gray-600'
                } text-white
              `}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
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
            </button>

            {/* Volume Controls Button */}
            <button
              onClick={() => setShowVolumeControls(!showVolumeControls)}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
              title="Volume Controls"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
            </button>
          </>
        )}

        {/* Permission Error */}
        {permissionError && (
          <div className="px-3 py-1 bg-red-600 text-white rounded-lg text-sm">
            Microphone permission denied
          </div>
        )}
      </div>

      {/* Volume Control Panel - Desktop only */}
      <AnimatePresence>
        {showVolumeControls && voiceEnabled && isVoiceConnected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="hidden md:block fixed bottom-20 left-4 bg-gray-800 rounded-lg p-4 z-40 shadow-xl"
          >
            <h3 className="text-white font-semibold mb-3">Volume Controls</h3>
            <div className="space-y-2">
              {players
                .filter(p => p.name !== username && peers.includes(p.name))
                .map(player => (
                  <div key={player.id} className="flex items-center gap-3">
                    <span className="text-gray-300 w-24 text-sm">{player.name}</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={(playerVolumes[player.name] ?? 1) * 100}
                      onChange={(e) => handleVolumeChange(player.name, e.target.value)}
                      className="w-32"
                    />
                    <span className="text-gray-400 text-xs w-10">
                      {Math.round((playerVolumes[player.name] ?? 1) * 100)}%
                    </span>
                  </div>
                ))}
              {peers.length === 0 && (
                <div className="text-gray-400 text-sm">No other players in voice</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speaking Indicators (rendered by parent component) */}
      {voiceEnabled && isVoiceConnected && (
        <div className="voice-indicators">
          {Object.entries(audioLevels).map(([userId, level]) => {
            const scale = getSpeakingIndicator(level);
            if (!scale) return null;

            return (
              <div
                key={userId}
                className="speaking-indicator"
                data-user-id={userId}
                data-scale={scale}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

export default VoiceChat;
