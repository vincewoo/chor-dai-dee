import { useState } from 'react';
import VoiceControlModal from './VoiceControlModal';

const MicIcon = ({ muted, deafened, size }) => {
  const iconSize = size === 'desktop' ? 'w-[1.5vmax] h-[1.5vmax]' : size === 'hud' ? 'w-4 h-4' : 'w-5 h-5';

  if (muted) {
    // Muted mic with X
    return (
      <svg aria-hidden="true" className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4l16 16" className="text-red-300" />
      </svg>
    );
  }

  if (deafened) {
    // Deafened - headphones with X
    return (
      <svg aria-hidden="true" className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4l16 16" className="text-orange-300" />
      </svg>
    );
  }

  // Normal mic icon
  return (
    <svg aria-hidden="true" className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
  );
};

const VoiceControlBubble = ({
  username,
  voiceEnabled,
  isVoiceConnected,
  isMuted,
  isDeafened,
  audioLevel = 0,
  onToggleVoice,
  onToggleMute,
  onToggleDeafen,
  onVolumeChange,
  players,
  peers,
  playerVolumes,
  size = 'mobile' // 'mobile' or 'desktop'
}) => {
  const [showModal, setShowModal] = useState(false);

  const isSpeaking = voiceEnabled && isVoiceConnected && audioLevel > 0.05;

  // Check if other players have voice active (to prompt user to join)
  const othersInVoice = !voiceEnabled && peers && peers.length > 0;

  // Determine bubble color based on state
  const getBubbleClasses = () => {
    if (isSpeaking && !isMuted) {
      // Speaking - green with pulse
      return 'border-green-400 bg-green-500 text-white';
    }
    if (voiceEnabled && isVoiceConnected) {
      if (isMuted) {
        // Muted - red
        return 'border-red-400 bg-red-500 text-white';
      }
      if (isDeafened) {
        // Deafened - orange
        return 'border-orange-400 bg-orange-500 text-white';
      }
      // Voice on but not speaking - subtle green
      return 'border-green-600 bg-green-700 text-white';
    }
    if (voiceEnabled && !isVoiceConnected) {
      // Connecting - yellow
      return 'border-yellow-400 bg-yellow-500 text-black';
    }
    // Voice off - grey background
    return 'border-gray-500 bg-gray-600 text-gray-300';
  };

  // Size classes
  const sizeClasses = size === 'desktop'
    ? 'w-[4vmax] h-[4vmax] text-[1.2vmax]'
    : size === 'hud'
    ? 'w-8 h-8 text-sm border-2'
    : 'w-10 h-10 text-sm';

  // Mic icon for all states

  return (
    <>
      <div className="flex flex-col items-center shrink-0 relative">
        {/* Main bubble */}
        <div className="relative">
          <button
            onClick={() => setShowModal(true)}
            className={`
              ${sizeClasses} rounded-full flex items-center justify-center font-bold
              ${size === 'hud' ? '' : 'border-4'} shadow-lg cursor-pointer transition-all hover:scale-105
              ${getBubbleClasses()}
            `}
            title={voiceEnabled ? 'Voice Controls' : 'Enable Voice Chat'}
            aria-label={
              !voiceEnabled ? 'Enable Voice Chat' :
              !isVoiceConnected ? 'Connecting to Voice Chat' :
              isMuted ? 'Voice Controls (Muted)' :
              isDeafened ? 'Voice Controls (Deafened)' :
              'Voice Controls'
            }
          >
            <MicIcon
              size={size}
              muted={voiceEnabled && isVoiceConnected && isMuted}
              deafened={voiceEnabled && isVoiceConnected && isDeafened && !isMuted}
            />
          </button>

          {/* Speaking pulse ring - only when actively speaking */}
          {isSpeaking && !isMuted && (
            <div
              className="absolute inset-0 rounded-full bg-green-400 -z-10 animate-ping"
              style={{ animationDuration: '1s' }}
            />
          )}

          {/* Slow green pulse - others are in voice, prompting user to join */}
          {othersInVoice && (
            <div
              className="absolute inset-0 rounded-full bg-green-400 -z-10 animate-pulse"
              style={{ animationDuration: '2s' }}
            />
          )}

          {/* Audio level bars */}
          {voiceEnabled && isVoiceConnected && !isMuted && (
            <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 flex gap-0.5">
              {[0.15, 0.35, 0.55].map((threshold, index) => (
                <div
                  key={index}
                  className={`w-1 rounded-full transition-all duration-100 ${
                    audioLevel > threshold ? 'bg-green-400' : 'bg-gray-500'
                  }`}
                  style={{ height: audioLevel > threshold ? '6px' : '3px' }}
                />
              ))}
            </div>
          )}

          {/* Connection status indicator */}
          {voiceEnabled && !isVoiceConnected && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
          )}
        </div>
      </div>

      {/* Voice Control Modal */}
      <VoiceControlModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        voiceEnabled={voiceEnabled}
        isVoiceConnected={isVoiceConnected}
        isMuted={isMuted}
        isDeafened={isDeafened}
        onToggleVoice={onToggleVoice}
        onToggleMute={onToggleMute}
        onToggleDeafen={onToggleDeafen}
        onVolumeChange={onVolumeChange}
        players={players}
        peers={peers}
        playerVolumes={playerVolumes}
        username={username}
      />
    </>
  );
};

export default VoiceControlBubble;
