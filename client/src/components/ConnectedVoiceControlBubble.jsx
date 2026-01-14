import React from 'react';
import { useVoiceAudio } from '../contexts/VoiceContext';
import VoiceControlBubble from './VoiceControlBubble';

const ConnectedVoiceControlBubble = ({ username, voiceState, players, size = 'mobile' }) => {
    const { audioLevels } = useVoiceAudio();
    const audioLevel = audioLevels?.[username] || 0;

    return (
        <VoiceControlBubble
            username={username}
            voiceEnabled={voiceState?.voiceEnabled || false}
            isVoiceConnected={voiceState?.isVoiceConnected || false}
            isMuted={voiceState?.isMuted || false}
            isDeafened={voiceState?.isDeafened || false}
            audioLevel={audioLevel}
            onToggleVoice={voiceState?.handleVoiceToggle}
            onToggleMute={voiceState?.toggleMute}
            onToggleDeafen={voiceState?.toggleDeafen}
            onVolumeChange={voiceState?.handleVolumeChange}
            players={players}
            peers={voiceState?.peers || []}
            playerVolumes={voiceState?.playerVolumes || {}}
            size={size}
        />
    );
};

export default ConnectedVoiceControlBubble;
