import React, { memo } from 'react';
import { useVoiceAudio } from '../contexts/VoiceContext';
import VoiceIndicator from './VoiceIndicator';

const SelfPlayerAvatar = ({ user, isMyTurn, cardCount, playerRating }) => {
    // ⚡ Bolt Optimization: Consume high-frequency audio context directly here
    // instead of in the parent GameRoom, preventing massive re-renders.
    const { audioLevels } = useVoiceAudio();
    const audioLevel = audioLevels?.[user?.username] || 0;
    const isSpeaking = audioLevel > 0.05;

    return (
        <div className="hidden md:flex flex-col items-center mb-[0.5vmax]">
            <div className="relative">
                <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                    ${isSpeaking
                        ? 'border-green-400 bg-green-400 text-white animate-pulse'
                        : isMyTurn
                            ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse'
                            : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                    {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
                </div>
                <VoiceIndicator
                    isActive={isSpeaking}
                    level={audioLevel}
                />
            </div>
            <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                {user?.username || 'You'}
                {playerRating !== undefined && (
                    <span className="text-yellow-200"> ({playerRating})</span>
                )}
            </div>
            <div className="text-yellow-300 text-[0.7vmax]">{cardCount} Cards</div>
        </div>
    );
};

export default memo(SelfPlayerAvatar);
