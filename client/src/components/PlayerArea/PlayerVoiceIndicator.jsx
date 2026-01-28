import { memo } from 'react';
import { useVoiceAudio } from '../../contexts/VoiceContext';
import VoiceIndicator from '../VoiceIndicator';

/**
 * ⚡ Bolt Optimization: Isolated component for voice indicators.
 * Consumes high-frequency audio levels from context so parent components don't re-render.
 */
const PlayerVoiceIndicator = ({ playerName }) => {
    const { audioLevels } = useVoiceAudio();
    const level = audioLevels?.[playerName] || 0;
    const isActive = level > 0.05;

    return (
        <VoiceIndicator
            isActive={isActive}
            level={level}
        />
    );
};

export default memo(PlayerVoiceIndicator);
