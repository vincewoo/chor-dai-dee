import { useVoiceAudio } from '../contexts/VoiceContext';
import VoiceIndicator from './VoiceIndicator';

const SelfPlayerAvatar = ({ user, isTurn }) => {
    const { audioLevels } = useVoiceAudio();
    const level = audioLevels?.[user?.username] || 0;
    const isSpeaking = level > 0.05;

    return (
        <div className="relative">
            <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                ${isSpeaking
                    ? 'border-green-400 bg-green-400 text-white animate-pulse'
                    : isTurn
                        ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse'
                        : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
            </div>
            <VoiceIndicator
                isActive={isSpeaking}
                level={level}
            />
        </div>
    );
};

export default SelfPlayerAvatar;
