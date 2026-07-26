import { useEffect, useCallback, useRef } from 'react';
import { useVoice } from '../contexts/VoiceContext';

const VoiceChat = ({
  roomId,
  username,
  onVoiceStateChange
}) => {
  const {
    voiceEnabled,
    isVoiceConnected,
    isMuted,
    isDeafened,
    forcedMute,
    peers,
    permissionError,
    playerVolumes,
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleMute,
    toggleDeafen,
    setPlayerVolume
  } = useVoice();

  // Store stable callback refs to avoid infinite loops
  const callbacksRef = useRef({});

  // Handle voice toggle
  const handleVoiceToggle = useCallback(async () => {
    if (!voiceEnabled) {
      await joinVoiceRoom(roomId, username);
    } else {
      leaveVoiceRoom();
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
        forcedMute,
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
    forcedMute,
    JSON.stringify(peers),
    JSON.stringify(playerVolumes),
    permissionError
  ]);

  // No UI of its own: the v2 tables render VoiceControlBubble in the HUD and
  // VoiceIndicator on each seat. This component exists to own the WebRTC
  // lifecycle for the room and to publish voice state upward.
  return null;
};

export default VoiceChat;
