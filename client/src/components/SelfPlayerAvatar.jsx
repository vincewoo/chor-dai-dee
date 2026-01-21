import React from 'react';
import { useVoiceAudio } from '../contexts/VoiceContext';
import VoiceIndicator from './VoiceIndicator';

// ⚡ Bolt Optimization: Consumes VoiceAudioContext directly to prevent
// GameRoom from re-rendering on every audio level update.
const SelfPlayerAvatar = ({ user, isMyTurn, rating, cardCount }) => {
    const { audioLevels } = useVoiceAudio();
    const username = user?.username;

    // Safety check
    if (!username) return null;

    const isActive = audioLevels && audioLevels[username] > 0.05;
    const level = audioLevels?.[username] || 0;

    return (
        <div className="hidden md:flex flex-col items-center mb-[0.5vmax]">
            <div className="relative">
                <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                    ${isActive
                        ? 'border-green-400 bg-green-400 text-white animate-pulse'
                        : isMyTurn
                            ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse'
                            : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                    {username.substring(0, 2).toUpperCase() || 'ME'}
                </div>
                <VoiceIndicator
                    isActive={isActive}
                    level={level}
                />
            </div>
            <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                {username || 'You'}
                {rating !== undefined && (
                    <span className="text-yellow-200"> ({rating})</span>
                )}
            </div>
            <div className="text-yellow-300 text-[0.7vmax]">{cardCount} Cards</div>
        </div>
    );
};

export default SelfPlayerAvatar;
