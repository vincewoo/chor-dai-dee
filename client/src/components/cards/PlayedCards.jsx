import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import Card from '../Card';
import { getPlayedHandKey } from '../../utils/cardUtils';
import { arePlayedCardsPropsEqual } from '../../utils/memoUtils';

/**
 * Played cards display component - shows cards played in the center area
 * Handles both card displays and turn indicators with animations
 */
const PlayedCards = ({ lastPlayed, position, isCurrentTurn = false, playerName = '', isMe = false, trickWinPending = false, isDesktop }) => {
    // Mobile: position near avatars; Desktop: original positions
    // Bottom position adjusted higher to be visible above controls
    // Add vertical offset for side players
    // z-index is calculated dynamically based on timestamp (later plays = higher z-index)
    const basePositions = {
        top: "absolute top-[90px] md:top-[18vh] left-1/2 -translate-x-1/2",
        left: "absolute left-[40px] md:left-[12vw] top-[calc(50%-185px)] md:top-[calc(50vh+45px)]",
        right: "absolute right-[20px] md:right-[12vw] top-[calc(50%-175px)] md:top-[calc(50vh+35px)]",
        bottom: "absolute bottom-[35vh] md:bottom-[32vh] left-1/2 -translate-x-1/2"
    };

    const rotationDeg = position === 'left' ? 90 : position === 'right' ? -90 : 0;

    // Use large size cards on mobile for side players (double the normal size)
    const isSidePlayer = position === 'top' || position === 'left' || position === 'right';
    const cardSize = 'large'; // Use large for all on mobile

    // Determine what to display
    // Show turn indicator whenever it's their turn, UNLESS a trick win is pending (we want to show the winning cards)
    // Don't show stale "PASS" when it's currently their turn
    const showTurnIndicator = isCurrentTurn && !trickWinPending;
    // Don't show played cards if it's their turn and the last thing they played was "PASS"
    // (this happens when they get control after everyone else passes)
    const showPlayedCards = !!lastPlayed && !(isCurrentTurn && lastPlayed?.type === 'pass' && !trickWinPending);

    // Calculate z-index based on play order: later plays appear on top
    // Use playOrder if available, otherwise fall back to position-based z-index
    const getZIndex = () => {
        if (lastPlayed?.playOrder !== undefined) {
            // Use play order directly (simple incrementing counter)
            return 100 + lastPlayed.playOrder;
        }
        // Fallback to position-based z-index
        return position === 'bottom' ? 40 : position === 'left' || position === 'right' ? 30 : 20;
    };

    // Return null if nothing to show
    if (!showTurnIndicator && !showPlayedCards) {
        return null;
    }

    return (
        <AnimatePresence>
            {showTurnIndicator ? (
                // Turn indicator display (prioritized over played cards unless trick win pending)
                <motion.div
                    key={`turn-${position}-${playerName}`}
                    className={basePositions[position]}
                    style={{ zIndex: 150 }}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                    <div className={`px-4 py-2 md:px-[1.5vmax] md:py-[0.5vmax] rounded-full font-bold text-lg md:text-[1.2vmax] ${isMe
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-black animate-pulse shadow-lg shadow-orange-400/60 border-2 border-amber-300'
                        : 'bg-black/60 text-white shadow-lg'
                        }`}>
                        {isMe ? "Your Turn!" : `${playerName}'s Turn`}
                    </div>
                </motion.div>
            ) : showPlayedCards ? (
                // Played cards display (existing logic with enhancements)
                // Apply z-index directly to motion.div for proper stacking
                <motion.div
                    key={`played-${position}-${getPlayedHandKey(lastPlayed)}`}
                    className={basePositions[position]}
                    style={{
                        zIndex: getZIndex()
                    }}
                    initial={{ opacity: 0 }}
                    animate={{
                        opacity: 1
                    }}
                    exit={{ opacity: 0 }}
                    transition={{
                        duration: 0.2
                    }}
                >
                    <div
                        className="flex -ml-2 md:-ml-[1vmax]"
                        style={{
                            transform: `rotate(${isSidePlayer ? 0 : rotationDeg}deg)`,
                            gap: '-8px md:-1vmax'
                        }}
                    >
                        {lastPlayed.type === 'pass' ? (
                            <div className={`text-red-400 font-bold bg-black/50 rounded-lg ${isSidePlayer
                                ? 'text-base md:text-[2vmax] px-3 py-1.5 md:px-[1.5vmax] md:py-[0.75vmax]'
                                : 'text-2xl md:text-[2vmax] px-4 md:px-[1.5vmax] py-2 md:py-[0.75vmax]'
                                }`}>
                                PASS
                            </div>
                        ) : (
                            lastPlayed.cards?.map((card) => (
                                <div key={`${card.rank}-${card.suit}`} className="-ml-4 md:-ml-[2vmax]">
                                    <Card
                                        rank={card.rank}
                                        suit={card.suit}
                                        size={cardSize}
                                        isDesktop={isDesktop}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
};

export default memo(PlayedCards, arePlayedCardsPropsEqual);
