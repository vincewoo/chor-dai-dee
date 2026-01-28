import { memo } from 'react';
import CardCountIndicator from '../CardCountIndicator';
import { FaceDownCardHorizontal, FaceDownCardVertical } from './FaceDownCard';
import PlayerVoiceIndicator from './PlayerVoiceIndicator';

// ⚡ Bolt Optimization: Memoized sub-components to prevent re-renders of static UI
// when high-frequency props (like voiceAudioLevels) update in the parent.

/**
 * Player avatar component - shared between all player areas
 */
const PlayerAvatarBase = ({ player, isTurn, isClickable, onPlayerClick }) => {
    const isDisconnected = player.isDisconnected;

    return (
        <div className="relative">
            <div
                className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}
                ${isClickable ? 'cursor-pointer hover:ring-4 hover:ring-red-400' : ''}`}
                onClick={() => isClickable && onPlayerClick && onPlayerClick(player)}
                title={isClickable ? 'Click to kick player' : ''}
            >
                {player.name.substring(0, 2).toUpperCase()}
            </div>
            <PlayerVoiceIndicator playerName={player.name} />
        </div>
    );
};

const PlayerAvatar = memo(PlayerAvatarBase, (prevProps, nextProps) => {
    // ⚡ Bolt Optimization: Custom comparison to prevent re-renders
    // Voice level updates are now handled internally by PlayerVoiceIndicator via context

    // Check if critical props changed
    return (
        prevProps.player === nextProps.player &&
        prevProps.isTurn === nextProps.isTurn &&
        prevProps.isClickable === nextProps.isClickable &&
        prevProps.onPlayerClick === nextProps.onPlayerClick
    );
});

/**
 * Disconnected badge component
 */
const DisconnectedBadge = memo(() => (
    <div className="absolute -top-1 md:-top-[0.5vmax] -right-1 md:-right-[0.5vmax] bg-red-500 text-white text-[10px] md:text-[0.6vmax] px-1 md:px-[0.3vmax] rounded font-bold">
        DC
    </div>
));

/**
 * Player name label component
 */
const PlayerNameLabel = memo(({ player }) => (
    <div className="text-white bg-black/50 px-2 md:px-[0.5vmax] py-0.5 md:py-[0.15vmax] rounded text-xs md:text-[0.8vmax] font-semibold shadow mt-1 md:mt-[0.25vmax]">
        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
    </div>
), (prev, next) => prev.player === next.player && prev.player.rating === next.player.rating && prev.player.name === next.player.name);

/**
 * Top Player Area - cards horizontal on left, avatar on right
 */
export const TopPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute top-[8px] md:top-[2vh] left-1/2 -translate-x-1/3 flex items-center gap-4 md:gap-[2vmax] transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Cards - horizontal (hidden on mobile) */}
                <div className="hidden md:flex -ml-4 md:-ml-[2vmax]">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <FaceDownCardHorizontal key={i} index={i} />
                    ))}
                </div>
                {/* Avatar */}
                <div className="flex flex-col items-center shrink-0 relative">
                    <PlayerAvatar
                        player={player}
                        isTurn={isTurn}
                        isClickable={isClickable}
                        onPlayerClick={onPlayerClick}
                    />
                    {isDisconnected && <DisconnectedBadge />}
                    <PlayerNameLabel player={player} />
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Card count indicator - right side (mobile only) */}
                <CardCountIndicator cardCount={player.cardCount} className="md:hidden" />
            </div>
        </>
    );
};

/**
 * Left Player Area - cards vertical (rotated 90°), avatar at top
 */
export const LeftPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute left-[2px] md:left-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Avatar */}
                <div className="flex flex-col items-center mb-8 md:mb-[2.5vmax] relative">
                    <PlayerAvatar
                        player={player}
                        isTurn={isTurn}
                        isClickable={isClickable}
                        onPlayerClick={onPlayerClick}
                    />
                    {isDisconnected && <DisconnectedBadge />}
                    <PlayerNameLabel player={player} />
                    <CardCountIndicator cardCount={player.cardCount} className="md:hidden mt-1" />
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Cards - horizontal stack (hidden on mobile) */}
                <div className="hidden md:flex flex-col md:-mt-[1.5vmax] pt-4">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <FaceDownCardVertical key={i} index={i} />
                    ))}
                </div>
            </div>
        </>
    );
};

/**
 * Right Player Area - cards vertical (rotated 90°), avatar at top
 */
export const RightPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute right-[2px] md:right-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Avatar */}
                <div className="flex flex-col items-center mb-8 md:mb-[2.5vmax] relative">
                    <PlayerAvatar
                        player={player}
                        isTurn={isTurn}
                        isClickable={isClickable}
                        onPlayerClick={onPlayerClick}
                    />
                    {isDisconnected && <DisconnectedBadge />}
                    <PlayerNameLabel player={player} />
                    <CardCountIndicator cardCount={player.cardCount} className="md:hidden mt-1" />
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Cards - horizontal stack (hidden on mobile) */}
                <div className="hidden md:flex flex-col md:-mt-[1.5vmax] pt-4">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <FaceDownCardVertical key={i} index={i} />
                    ))}
                </div>
            </div>
        </>
    );
};
