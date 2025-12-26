import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from './Card';
import CardCountIndicator from './CardCountIndicator';
import { AnimatePresence, motion } from 'framer-motion';
import { canBeatWithAnyHand } from '../utils/handChecker';
import HandHelper from './HandHelper';
import { useSuitColors } from '../contexts/SuitColorContext';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GAME_MODES } from '../constants/gameModes';
import logoImage from '../assets/chor-dai-dee-logo.png';

// Card sorting utilities
const SUITS_ORDER = ['D', 'C', 'H', 'S']; // Diamonds < Clubs < Hearts < Spades
const RANKS_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

const getCardValue = (card) => {
    const rankIndex = RANKS_ORDER.indexOf(card.rank);
    const suitIndex = SUITS_ORDER.indexOf(card.suit);
    return rankIndex * 4 + suitIndex;
};

const sortByRank = (cards) => {
    return [...cards].sort((a, b) => getCardValue(a) - getCardValue(b));
};

const sortBySuit = (cards) => {
    return [...cards].sort((a, b) => {
        const suitDiff = SUITS_ORDER.indexOf(a.suit) - SUITS_ORDER.indexOf(b.suit);
        if (suitDiff !== 0) return suitDiff;
        return RANKS_ORDER.indexOf(a.rank) - RANKS_ORDER.indexOf(b.rank);
    });
};

// Helper to create a stable key for a played hand (only changes when cards change)
const getPlayedHandKey = (lastPlayed) => {
    if (!lastPlayed) return null;
    if (lastPlayed.type === 'pass') return 'pass';
    return lastPlayed.cards?.map(c => `${c.rank}-${c.suit}`).join(',') || null;
};

// Sortable card wrapper component for drag-and-drop
const SortableCard = ({ card, isSelected, onClick, index, dynamicMargin }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: `${card.rank}-${card.suit}`,
        transition: {
            duration: 150,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        },
    });

    const defaultTransition = 'margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    const styleTransition = isDragging
        ? undefined
        : (transition ? `${transition}, ${defaultTransition}` : defaultTransition);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: styleTransition,
        zIndex: isDragging ? 50 : 'auto',
    };

    // Apply margin logic:
    // 1. First card: No left margin (save space)
    // 2. Other cards: Use dynamic overlap (mobile) or fixed overlap (desktop)

    if (index === 0) {
        style.marginLeft = '0';
    } else {
        // Subsequent cards: use overlap
        if (dynamicMargin !== undefined) {
            style.marginLeft = dynamicMargin;
        } else {
            style.marginLeft = '-45px';
        }
    }

    return (
        <div
            ref={setNodeRef}
            style={{...style, touchAction: 'none'}}
            data-card-id={`${card.rank}-${card.suit}`}
            className={`hover:ml-0 md:hover:-ml-[1.5vmax] ${index !== 0 ? 'md:-ml-[1.5vmax]' : ''} ${isDragging ? 'opacity-50' : ''}`}
            {...attributes}
            {...listeners}
        >
            <Card
                rank={card.rank}
                suit={card.suit}
                selected={isSelected}
                onClick={onClick}
                index={index}
                size="xlarge"
            />
        </div>
    );
};

// Played cards display component - extracted to prevent re-renders
const PlayedCards = ({ lastPlayed, position, isCurrentTurn = false, playerName = '', isMe = false, hasActiveHandOnTable = false }) => {
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
    // Only show turn indicator when it's their turn AND there's no active hand on the table (free control)
    const showTurnIndicator = !hasActiveHandOnTable && isCurrentTurn;
    const showPlayedCards = !!lastPlayed;

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
                // Turn indicator display
                <motion.div
                    key={`turn-${position}-${playerName}`}
                    className={basePositions[position]}
                    style={{ zIndex: 50 }}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                    <div className={`px-4 py-2 md:px-[1.5vmax] md:py-[0.5vmax] rounded-full font-bold text-lg md:text-[1.2vmax] shadow-lg ${
                        isMe ? 'bg-yellow-500 text-black animate-pulse' : 'bg-black/60 text-white'
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
                        <div className={`text-red-400 font-bold bg-black/50 rounded-lg ${
                            isSidePlayer
                                ? 'text-base md:text-[2vmax] px-3 py-1.5 md:px-[1.5vmax] md:py-[0.75vmax]'
                                : 'text-2xl md:text-[2vmax] px-4 md:px-[1.5vmax] py-2 md:py-[0.75vmax]'
                        }`}>
                            PASS
                        </div>
                    ) : (
                        lastPlayed.cards?.map((card) => (
                            <div key={`${card.rank}-${card.suit}`} className="-ml-4 md:-ml-[2vmax]">
                                <Card rank={card.rank} suit={card.suit} size={cardSize} />
                            </div>
                        ))
                    )}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
};

// Top Player Area - cards horizontal on left, avatar on right
const TopPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute top-[8px] md:top-[2vh] left-1/2 -translate-x-1/3 flex items-center gap-4 md:gap-[2vmax] transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Cards - horizontal (hidden on mobile) */}
                <div className="hidden md:flex -ml-4 md:-ml-[2vmax]">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div
                            key={i}
                            className="w-[18px] h-[26px] md:w-[3.3vmax] md:h-[4.5vmax] border-2 border-white rounded-xl shadow-sm -ml-3 md:-ml-[1.5vmax] relative overflow-hidden"
                            style={{
                                background: `
                                    repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
                                `
                            }}
                        >
                            <div className="absolute inset-[8%] border border-white rounded-lg" />
                        </div>
                    ))}
                </div>
                {/* Avatar */}
                <div className="flex flex-col items-center shrink-0 relative">
                    <div
                        className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}
                        ${isClickable ? 'cursor-pointer hover:ring-4 hover:ring-red-400' : ''}`}
                        onClick={() => isClickable && onPlayerClick && onPlayerClick(player)}
                        title={isClickable ? 'Click to kick player' : ''}
                    >
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-1 md:-top-[0.5vmax] -right-1 md:-right-[0.5vmax] bg-red-500 text-white text-[10px] md:text-[0.6vmax] px-1 md:px-[0.3vmax] rounded font-bold">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-2 md:px-[0.5vmax] py-0.5 md:py-[0.15vmax] rounded text-xs md:text-[0.8vmax] font-semibold shadow mt-1 md:mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Card count indicator - right side (mobile only) */}
                <CardCountIndicator cardCount={player.cardCount} className="md:hidden" />
            </div>
        </>
    );
};

// Left Player Area - cards vertical (rotated 90°), avatar at top
const LeftPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute left-[2px] md:left-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Avatar */}
                <div className="flex flex-col items-center mb-8 md:mb-[2.5vmax] relative">
                    <div
                        className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}
                        ${isClickable ? 'cursor-pointer hover:ring-4 hover:ring-red-400' : ''}`}
                        onClick={() => isClickable && onPlayerClick && onPlayerClick(player)}
                        title={isClickable ? 'Click to kick player' : ''}
                    >
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-1 md:-top-[0.5vmax] -right-1 md:-right-[0.5vmax] bg-red-500 text-white text-[10px] md:text-[0.6vmax] px-1 md:px-[0.3vmax] rounded font-bold">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-2 md:px-[0.5vmax] py-0.5 md:py-[0.15vmax] rounded text-xs md:text-[0.8vmax] font-semibold shadow mt-1 md:mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <CardCountIndicator cardCount={player.cardCount} className="md:hidden mt-1" />
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Cards - horizontal stack (hidden on mobile) */}
                <div className="hidden md:flex flex-col md:-mt-[1.5vmax] pt-4">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div
                            key={i}
                            className="w-[26px] h-[18px] md:w-[4.5vmax] md:h-[3.3vmax] border-2 border-white rounded-xl shadow-sm -mt-2.5 md:-mt-[1.2vmax] relative overflow-hidden"
                            style={{
                                background: `
                                    repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
                                `
                            }}
                        >
                            <div className="absolute inset-[8%] border border-white rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
};

// Right Player Area - cards vertical (rotated 90°), avatar at top
const RightPlayerArea = ({ player, isTurn, onPlayerClick, isClickable }) => {
    if (!player) return null;

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute right-[2px] md:right-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Avatar */}
                <div className="flex flex-col items-center mb-8 md:mb-[2.5vmax] relative">
                    <div
                        className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}
                        ${isClickable ? 'cursor-pointer hover:ring-4 hover:ring-red-400' : ''}`}
                        onClick={() => isClickable && onPlayerClick && onPlayerClick(player)}
                        title={isClickable ? 'Click to kick player' : ''}
                    >
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-1 md:-top-[0.5vmax] -right-1 md:-right-[0.5vmax] bg-red-500 text-white text-[10px] md:text-[0.6vmax] px-1 md:px-[0.3vmax] rounded font-bold">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-2 md:px-[0.5vmax] py-0.5 md:py-[0.15vmax] rounded text-xs md:text-[0.8vmax] font-semibold shadow mt-1 md:mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <CardCountIndicator cardCount={player.cardCount} className="md:hidden mt-1" />
                    <div className="hidden md:block text-yellow-300 md:text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Cards - horizontal stack (hidden on mobile) */}
                <div className="hidden md:flex flex-col md:-mt-[1.5vmax] pt-4">
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div
                            key={i}
                            className="w-[26px] h-[18px] md:w-[4.5vmax] md:h-[3.3vmax] border-2 border-white rounded-xl shadow-sm -mt-2.5 md:-mt-[1.2vmax] relative overflow-hidden"
                            style={{
                                background: `
                                    repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                                    linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
                                `
                            }}
                        >
                            <div className="absolute inset-[8%] border border-white rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
};

const GameRoom = ({ user, socket }) => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const { fourColorMode, toggleFourColorMode } = useSuitColors();
    const { autoPass, toggleAutoPass } = useUserPreferences();
    const handContainerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);
    // Track our actual player ID (may differ from socket.id due to reconnection timing)
    const [myPlayerId, setMyPlayerId] = useState(socket.id);
    // Determine desktop mode for dynamic card spacing
    // Initialize with a safe check for SSR (though this is a client app)
    const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);

    useEffect(() => {
        const media = window.matchMedia('(min-width: 768px)');

        const listener = (e) => setIsDesktop(e.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, []);

    // Measure container width for dynamic spacing
    useEffect(() => {
        if (!handContainerRef.current) return;

        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(handContainerRef.current);
        return () => observer.disconnect();
    }, []);

    // Configure drag-and-drop sensors with hybrid input handling
    // Mouse: Instant drag (distance constraint)
    // Touch: Balanced settings for both taps and drags
    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 150, // Reduced from 250ms for better touch responsiveness
                tolerance: 8, // Increased from 5px to allow natural finger wobble during taps
            },
        })
    );

    const [isDragging, setIsDragging] = useState(false);
    const [gameState, setGameState] = useState(null);
    const [myHand, setMyHand] = useState([]);
    const [selectedCards, setSelectedCards] = useState([]);
    const [error, setError] = useState('');
    const [roundResult, setRoundResult] = useState(null);
    const [gameOver, setGameOver] = useState(null);
    const autoPassTriggered = useRef(false);
    const [notification, setNotification] = useState(null);
    const [sortMode, setSortMode] = useState('rank'); // 'rank' or 'suit'
    const [isCustomOrder, setIsCustomOrder] = useState(false); // Track if hand is manually arranged
    const [customHandOrder, setCustomHandOrder] = useState(null); // Store custom card order
    const [showSettings, setShowSettings] = useState(false); // Settings modal
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false); // Leave confirmation modal
    const [showKickConfirm, setShowKickConfirm] = useState(false); // Kick confirmation modal
    const [playerToKick, setPlayerToKick] = useState(null); // Player being kicked

    // Track touch interactions for swipe selection
    const touchStartRef = useRef(null);

    // Sorted hand based on current sort mode
    const sortedHand = useMemo(() => {
        // Use custom order if in custom mode
        if (isCustomOrder && customHandOrder) {
            return customHandOrder;
        }
        // Otherwise apply current sort mode
        if (sortMode === 'suit') {
            return sortBySuit(myHand);
        }
        return sortByRank(myHand);
    }, [myHand, sortMode, isCustomOrder, customHandOrder]);

    // Calculate dynamic overlap
    const dynamicOverlap = useMemo(() => {
        const cardCount = sortedHand.length;

        // Calculate estimated card width based on device type
        // Mobile (default): 60px (matches 'xlarge' size for mobile)
        // Desktop: 5.5vmax (matches 'xlarge' md size)
        let cardWidth = 63;
        if (isDesktop && typeof window !== 'undefined') {
            const vmax = Math.max(window.innerWidth, window.innerHeight);
            cardWidth = vmax * 0.055;
        }

        if (cardCount <= 1 || containerWidth === 0) return `-${cardWidth * 0.6}px`; // Default fallback

        // containerWidth already accounts for padding (contentRect.width)
        // Available width for overlaps = Container Width - One Full Card
        const availableWidthForOverlaps = containerWidth - cardWidth;

        // If we have N cards, we have N-1 overlaps
        const calculatedOverlap = (availableWidthForOverlaps / (cardCount - 1)) - cardWidth;

        // Clamp the overlap relative to card size
        // Max compression: Different for mobile vs desktop
        // Mobile: 70% overlap (30% visible = ~19px for better touch targets, prevents overflow on small screens)
        // Desktop: 85% overlap (15% visible = fine for mouse precision)
        const minOverlap = isDesktop ? -(cardWidth * 0.85) : -(cardWidth * 0.70);
        // Max spread: 20% overlap (80% visible) - increased visibility from previous fixed value
        const maxOverlap = -(cardWidth * 0.2);

        const clamped = Math.max(minOverlap, Math.min(maxOverlap, calculatedOverlap));
        return `${clamped}px`;
    }, [sortedHand.length, containerWidth, isDesktop]);

    useEffect(() => {
        // Join room first (handles reconnection if needed), then request state
        socket.emit('join_room', { roomId, username: user?.username });

        // Set a timeout to detect if room doesn't exist (server restarted)
        const roomLoadTimeout = setTimeout(() => {
            if (!gameState) {
                // Room doesn't exist, redirect to lobby
                console.warn('Room not found, redirecting to lobby');
                navigate('/lobby');
            }
        }, 3000); // Wait 3 seconds for room state

        // Track if we were reconnected to prevent duplicate get_room_state call
        let wasReconnected = false;

        // Handler for reconnection
        const handleReconnect = ({ roomId: reconnectedRoomId, playerId, gameState: reconnectedGameState }) => {
            console.log(`Reconnected to room ${reconnectedRoomId} with playerId ${playerId}`, reconnectedGameState);
            wasReconnected = true;
            setMyPlayerId(playerId); // Update our player ID
            setGameState(reconnectedGameState);
            clearTimeout(roomLoadTimeout);
            // If we were reconnected to a different room, navigate to it
            if (reconnectedRoomId !== roomId) {
                console.log(`Redirecting from ${roomId} to ${reconnectedRoomId}`);
                navigate(`/game/${reconnectedRoomId}`, { replace: true });
            }
        };

        socket.on('reconnected', handleReconnect);

        // Also handle the case where we're already in the room (fast refresh)
        socket.on('joined_room', ({ roomId: joinedRoomId, playerId }) => {
            console.log(`Joined room ${joinedRoomId} (fast reconnect) with playerId ${playerId}`);
            wasReconnected = true;
            if (playerId) setMyPlayerId(playerId); // Update our player ID
            clearTimeout(roomLoadTimeout);
            // Don't need to set game state here, room_update will handle it
        });

        // Small delay to allow reconnection to complete before requesting state
        setTimeout(() => {
            // Only request room state if we weren't reconnected
            if (!wasReconnected) {
                socket.emit('get_room_state', { roomId });
            }
        }, 100);

        socket.on('room_update', (state) => {
            setGameState(state);
            clearTimeout(roomLoadTimeout); // Room exists, clear timeout
        });

        socket.on('game_started', (state) => {
            setGameState(state);
            setRoundResult(null);
            setGameOver(null);
            clearTimeout(roomLoadTimeout); // Room exists, clear timeout
        });

        socket.on('hand_update', (hand) => {
            setMyHand(hand);
            setSelectedCards([]);
            setIsCustomOrder(false); // Reset custom order on new hand
            setCustomHandOrder(null);
        });

        socket.on('game_update', (state) => {
            setGameState(state);
            clearTimeout(roomLoadTimeout); // Room exists, clear timeout
        });

        socket.on('round_over', (data) => {
            setRoundResult(data);
        });

        socket.on('game_over', (data) => {
            setGameOver(data);
        });

        socket.on('dragon_win', (data) => {
            // Dragon win is treated like game_over but with special messaging
            setGameOver({ ...data, isDragonWin: true });
        });

        socket.on('error', (err) => {
            setError(err);
            setTimeout(() => setError(''), 3000);
            // If error is "Room not found", redirect to lobby
            if (err && err.toLowerCase().includes('room not found')) {
                setTimeout(() => navigate('/lobby'), 1500);
            }
        });

        socket.on('player_disconnected', ({ playerName, replacedWithBot, botName }) => {
            const message = replacedWithBot
                ? `${playerName} left and was replaced by ${botName}`
                : `${playerName} disconnected`;
            setNotification({ type: 'warning', message });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_reconnected', ({ playerName }) => {
            setNotification({ type: 'success', message: `${playerName} reconnected!` });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_joined_in_progress', ({ playerName, replacedBot }) => {
            setNotification({ type: 'success', message: `${playerName} joined and replaced ${replacedBot}!` });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_kicked', ({ playerName, replacedWithBot, botName }) => {
            const message = replacedWithBot
                ? `${playerName} was kicked and replaced by ${botName}`
                : `${playerName} was kicked from the room`;
            setNotification({ type: 'warning', message });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('kicked_from_room', ({ message }) => {
            setNotification({ type: 'warning', message });
            setTimeout(() => {
                navigate('/lobby');
            }, 2000);
        });

        socket.on('mid_game_join_info', ({ message, joinedAtRound, inheritedScore }) => {
            setNotification({
                type: 'info',
                message: `${message} (Round ${joinedAtRound}, inherited ${inheritedScore} points)`
            });
            setTimeout(() => setNotification(null), 5000);
        });

        return () => {
            clearTimeout(roomLoadTimeout); // Clean up timeout on unmount
            socket.off('room_update');
            socket.off('game_started');
            socket.off('hand_update');
            socket.off('game_update');
            socket.off('round_over');
            socket.off('game_over');
            socket.off('dragon_win');
            socket.off('error');
            socket.off('player_disconnected');
            socket.off('player_reconnected');
            socket.off('player_joined_in_progress');
            socket.off('player_kicked');
            socket.off('kicked_from_room');
            socket.off('mid_game_join_info');
            socket.off('reconnected', handleReconnect);
            socket.off('joined_room');
        };
    }, [socket, navigate]);

    // Auto-pass effect: check if we should auto-pass when it becomes our turn
    useEffect(() => {
        if (!autoPass || !gameState || gameState.gameState !== 'playing') return;

        const isMyTurn = gameState.currentTurn === myPlayerId;
        const hasLastPlayedHand = !!gameState.lastPlayedHand;

        // Only auto-pass if it's our turn and there's a hand to beat
        if (isMyTurn && hasLastPlayedHand && !autoPassTriggered.current) {
            // Check if we can beat the hand
            const canBeat = canBeatWithAnyHand(myHand, gameState.lastPlayedHand);

            if (!canBeat) {
                // Small delay to give visual feedback before auto-passing
                autoPassTriggered.current = true;
                const timer = setTimeout(() => {
                    socket.emit('pass_turn', { roomId });
                    autoPassTriggered.current = false;
                }, 500);
                return () => clearTimeout(timer);
            }
        }

        // Reset triggered flag when it's no longer our turn
        if (!isMyTurn) {
            autoPassTriggered.current = false;
        }
    }, [autoPass, gameState, myHand, myPlayerId, socket, roomId]);

    const startGame = () => {
        socket.emit('start_game', { roomId });
    };

    const nextRound = () => {
        setRoundResult(null);
        socket.emit('next_round', { roomId });
    };

    const toggleCard = useCallback((card) => {
        setSelectedCards(prevSelected => {
            const isSelected = prevSelected.some(c => c.rank === card.rank && c.suit === card.suit);
            if (isSelected) {
                return prevSelected.filter(c => !(c.rank === card.rank && c.suit === card.suit));
            } else {
                return [...prevSelected, card];
            }
        });
    }, []);

    // Swipe Selection Logic
    const handleTouchStart = (e) => {
        // Prevent default to stop scrolling if needed, but usually we want to allow scrolling if not swiping on cards
        // e.preventDefault();

        // Find the card we started on
        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        const cardElement = element?.closest('[data-card-id]');

        if (cardElement) {
            const cardId = cardElement.getAttribute('data-card-id');
            const [rank, suit] = cardId.split('-');

            // Determine if we are "selecting" or "deselecting" based on the start card
            const isSelected = selectedCards.some(c => c.rank === rank && c.suit === suit);
            touchStartRef.current = {
                mode: isSelected ? 'deselect' : 'select',
                lastToggled: cardId, // Initialize as last toggled to prevent re-toggle if we stay on it
                startCardId: cardId,
                startCardProcessed: false
            };

            // NOTE: We do NOT toggle immediately here.
            // If it's a tap, the click handler on the Card component will handle it.
            // If it's a swipe, handleTouchMove will handle it when moving off the start card.
        } else {
            touchStartRef.current = null;
        }
    };

    const handleTouchMove = (e) => {
        // Abort if no touch session or if a drag-and-drop operation is active
        if (!touchStartRef.current || isDragging) return;

        // e.preventDefault(); // Stop scrolling while painting selection

        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        const cardElement = element?.closest('[data-card-id]');

        if (cardElement) {
            const cardId = cardElement.getAttribute('data-card-id');

            // Check if we need to process the start card (first move off it)
            if (!touchStartRef.current.startCardProcessed && cardId !== touchStartRef.current.startCardId) {
                // We have moved off the start card to a NEW card.
                // Now we must toggle the start card to confirm the action on it (swipe start).
                const [startRank, startSuit] = touchStartRef.current.startCardId.split('-');
                toggleCard({ rank: startRank, suit: startSuit });
                touchStartRef.current.startCardProcessed = true;
            }

            // If we moved to a new card (different from last toggled)
            if (cardId !== touchStartRef.current.lastToggled) {
                const [rank, suit] = cardId.split('-');
                const isSelected = selectedCards.some(c => c.rank === rank && c.suit === suit);
                const { mode } = touchStartRef.current;

                // Apply the action if it matches our mode (only select unselected, or deselect selected)
                if ((mode === 'select' && !isSelected) || (mode === 'deselect' && isSelected)) {
                    toggleCard({ rank, suit });
                    touchStartRef.current.lastToggled = cardId;
                }
            }
        }
    };

    const handleTouchEnd = () => {
        touchStartRef.current = null;
    };

    // Helper function to reorder selected cards as a group
    const reorderSelectedCards = (hand, selectedCards, overCardId, isDraggingRight) => {
        const selectedSet = new Set(selectedCards.map(c => `${c.rank}-${c.suit}`));

        // Remove selected cards while preserving their order
        const selectedInOrder = [];
        const remaining = hand.filter(card => {
            const key = `${card.rank}-${card.suit}`;
            if (selectedSet.has(key)) {
                selectedInOrder.push(card);
                return false;
            }
            return true;
        });

        // Find the position to insert in the remaining array
        const insertIndex = remaining.findIndex(card => `${card.rank}-${card.suit}` === overCardId);

        // If not found (shouldn't happen), append to end
        if (insertIndex === -1) {
            return [...remaining, ...selectedInOrder];
        }

        // Insert selected cards at the correct position based on drag direction
        // When dragging right: insert AFTER the target card
        // When dragging left: insert BEFORE the target card
        const result = [...remaining];
        const finalIndex = isDraggingRight ? insertIndex + 1 : insertIndex;
        result.splice(finalIndex, 0, ...selectedInOrder);
        return result;
    };

    const handleDragStart = () => {
        setIsDragging(true);
    };

    // Handle drag end event
    const handleDragEnd = (event) => {
        setIsDragging(false);
        const { active, over } = event;

        if (!over || active.id === over.id) return;

        const currentHand = isCustomOrder && customHandOrder ? customHandOrder : sortedHand;
        const oldIndex = currentHand.findIndex(card => `${card.rank}-${card.suit}` === active.id);
        const newIndex = currentHand.findIndex(card => `${card.rank}-${card.suit}` === over.id);

        if (oldIndex === -1 || newIndex === -1) return;

        const draggedCard = currentHand[oldIndex];
        const isDraggingSelected = selectedCards.some(
            c => c.rank === draggedCard.rank && c.suit === draggedCard.suit
        );

        let reorderedHand;

        if (isDraggingSelected && selectedCards.length > 1) {
            // Check if dropping over another selected card (part of the group)
            const isOverSelected = selectedCards.some(
                c => `${c.rank}-${c.suit}` === over.id
            );

            if (isOverSelected) {
                // Dropping within the same selected group - no change
                return;
            }

            // Determine drag direction: dragging right means newIndex > oldIndex
            const isDraggingRight = newIndex > oldIndex;

            // Group drag: move all selected cards to where we dropped
            reorderedHand = reorderSelectedCards(currentHand, selectedCards, over.id, isDraggingRight);
        } else {
            // Single drag: move one card
            reorderedHand = [...currentHand];
            const [removed] = reorderedHand.splice(oldIndex, 1);
            reorderedHand.splice(newIndex, 0, removed);
        }

        setIsCustomOrder(true);
        setCustomHandOrder(reorderedHand);
    };

    // Helper to check if it's a player's turn
    const isPlayersTurn = (player) => {
        return gameState.gameState === 'playing' && player && player.id === gameState.currentTurn;
    };

    // Callback for HandHelper to set selected cards
    const handleSelectCards = useCallback((cards) => {
        setSelectedCards(cards);
    }, []);

    // Handle sort button click
    const handleSortClick = () => {
        if (isCustomOrder) {
            // Reset to sorted mode
            setIsCustomOrder(false);
            setCustomHandOrder(null);
        } else {
            // Toggle between rank and suit
            setSortMode(sortMode === 'rank' ? 'suit' : 'rank');
        }
    };

    const playCards = () => {
        if (selectedCards.length === 0) return;

        // Optimistic update: immediately remove cards from hand for better responsiveness
        const newHand = myHand.filter(card =>
            !selectedCards.some(sc => sc.rank === card.rank && sc.suit === card.suit)
        );
        setMyHand(newHand);
        setSelectedCards([]);

        socket.emit('play_card', { roomId, cards: selectedCards });
    };

    const passTurn = () => {
        socket.emit('pass_turn', { roomId });
    };

    const leaveRoom = () => {
        socket.emit('leave_room', { roomId });
        navigate('/lobby');
    };

    const handleLeaveClick = () => {
        // Show confirmation modal
        setShowLeaveConfirm(true);
    };

    const confirmLeave = () => {
        setShowLeaveConfirm(false);
        leaveRoom();
    };

    const cancelLeave = () => {
        setShowLeaveConfirm(false);
    };

    const handlePlayerClick = (player) => {
        // Only host can kick players
        const hostPlayer = gameState.players.find(p => p.name === gameState.hostUsername);
        const isHost = hostPlayer?.id === myPlayerId;

        // Can't kick yourself, bots, or if you're not the host
        if (!isHost || player.isBot || player.id === myPlayerId) {
            return;
        }

        // Show kick confirmation
        setPlayerToKick(player);
        setShowKickConfirm(true);
    };

    const confirmKick = () => {
        if (playerToKick) {
            socket.emit('kick_player', { roomId, kickedPlayerId: playerToKick.id });
        }
        setShowKickConfirm(false);
        setPlayerToKick(null);
    };

    const cancelKick = () => {
        setShowKickConfirm(false);
        setPlayerToKick(null);
    };

    if (!gameState) return (
        <div className="h-screen w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            <img
                src={logoImage}
                alt="Chor Dai Dee Logo"
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] md:w-[30%] opacity-[0.15] pointer-events-none z-0"
            />
            <div className="text-white text-center text-xl font-bold relative z-10">Loading...</div>
        </div>
    );

    const myIndex = gameState?.players ? gameState.players.findIndex(p => p.id === myPlayerId) : -1;
    const isMyTurn = gameState.currentTurn === myPlayerId;

    // Helper to get relative player positions (Bottom=0, Right=1, Top=2, Left=3)
    const getRelativePlayer = (offset) => {
        if (!gameState) return null;
        if (myIndex === -1) return gameState.players[offset]; // Spectator view
        const idx = (myIndex + offset) % 4;
        return gameState.players[idx];
    };

    // Check if current user is host
    const hostPlayer = gameState?.players?.find(p => p.name === gameState.hostUsername);
    const isHost = hostPlayer?.id === myPlayerId;

    // Helper to determine if a player can be kicked
    const canKickPlayer = (player) => {
        return isHost && player && !player.isBot && player.id !== myPlayerId;
    };

    return (
        <div className="h-screen w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            {/* Game Logo - Background */}
            <img
                src={logoImage}
                alt="Chor Dai Dee Logo"
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] md:w-[30%] opacity-[0.15] pointer-events-none z-0"
            />

            {/* Top Bar */}
            <div className="absolute top-[1vh] left-[1vw] text-white z-10">
                <h1 className="text-xl md:text-[1.5vmax] font-bold drop-shadow-md">Room: {roomId}</h1>
                {gameState.gameMode && (
                    <div className="text-xs md:text-[0.8vmax] text-green-300">
                        {GAME_MODES[gameState.gameMode.toUpperCase()]?.name || 'Standard Game'}
                    </div>
                )}
                {gameState.roundNumber > 0 && (
                    <div className="text-sm md:text-[0.9vmax] text-yellow-300">Round {gameState.roundNumber}</div>
                )}
                <div className="flex gap-2 mt-1">
                    <button onClick={handleLeaveClick} className="text-xs md:text-[0.7vmax] underline text-gray-300 hover:text-white">Leave</button>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="text-xs md:text-[0.7vmax] px-2 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                        title="Game Settings"
                    >
                        ⚙️ Settings
                    </button>
                </div>
            </div>

            {/* Scoreboard - hidden on mobile */}
            {gameState.gameState === 'playing' && gameState.roundNumber > 0 && (
                <div className="hidden md:block absolute top-[1vh] right-[1vw] bg-black/60 rounded-lg p-3 md:p-[0.75vmax] text-white text-sm md:text-[0.9vmax] z-10">
                    <div className="font-bold mb-2 md:mb-[0.5vmax] text-yellow-400">Scores</div>
                    {gameState.players
                        .slice()
                        .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
                        .map(p => (
                        <div key={p.id} className="flex justify-between gap-4 md:gap-[1vmax]">
                            <span className={p.id === myPlayerId ? 'text-yellow-300' : ''}>{p.name}</span>
                            <span className={p.cumulativeScore >= 80 ? 'text-red-400' : p.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-green-400'}>
                                {p.cumulativeScore}
                            </span>
                        </div>
                    ))}
                    <div className="text-xs md:text-[0.7vmax] text-gray-400 mt-2 md:mt-[0.5vmax] border-t border-white/20 pt-1 md:pt-[0.25vmax]">
                        First to {gameState.pointThreshold || 100} loses
                    </div>
                </div>
            )}

            {/* Error Toast */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute top-[5vh] bg-red-600 text-white px-4 md:px-[1.5vmax] py-2 md:py-[0.5vmax] rounded shadow-xl z-50 font-bold text-base md:text-[1vmax]"
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Notification Toast */}
            <AnimatePresence>
                {notification && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`absolute top-[8vh] left-1/2 -translate-x-1/2 px-4 md:px-[1.5vmax] py-2 md:py-[0.5vmax] rounded shadow-xl z-50 font-bold text-base md:text-[1vmax] ${
                            notification.type === 'warning' ? 'bg-yellow-600 text-white' : 'bg-green-600 text-white'
                        }`}
                    >
                        {notification.message}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Round Over Modal */}
            {roundResult && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center text-white p-8">
                    <h2 className="text-5xl font-bold text-yellow-400 mb-2">Round {roundResult.roundNumber} Complete!</h2>
                    <div className="text-xl mb-4 text-green-300">Round Winner: {roundResult.roundWinner.name}</div>

                    <div className="bg-white/10 rounded-lg p-6 mb-6 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4 border-b pb-2">Round Scores</h3>
                        <div className="grid grid-cols-4 gap-2 text-sm font-semibold mb-2 text-gray-400">
                            <span>Player</span>
                            <span className="text-center">Cards</span>
                            <span className="text-center">Round</span>
                            <span className="text-center">Total</span>
                        </div>
                        {roundResult.scores && roundResult.scores.map(s => (
                            <div key={s.name} className="grid grid-cols-4 gap-2 mb-2 items-center">
                                <span className={s.isRoundWinner ? 'text-green-400 font-bold' : ''}>
                                    {s.name} {s.isBot ? '(Bot)' : ''}
                                </span>
                                <span className="text-center text-gray-400">{s.cardsLeft}</span>
                                <span className={`text-center ${s.roundPoints === 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    +{s.roundPoints}
                                </span>
                                <span className={`text-center font-bold ${s.cumulativeScore >= 80 ? 'text-red-500' : s.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-white'}`}>
                                    {s.cumulativeScore}
                                </span>
                            </div>
                        ))}
                        <div className="mt-4 pt-2 border-t border-white/20 text-sm text-gray-400">
                            First to 100 points loses. Lowest score wins!
                        </div>
                    </div>

                    <button onClick={nextRound} className="bg-green-600 px-8 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105 text-xl">
                        Next Round
                    </button>
                </div>
            )}

            {/* Game Over Modal */}
            {gameOver && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center text-white p-8">
                    <h2 className="text-6xl font-bold text-yellow-400 mb-4 animate-bounce">
                        {gameOver.isDragonWin ? '🐉 DRAGON! 🐉' : 'Game Over!'}
                    </h2>
                    <div className="text-2xl mb-2 text-green-300">Winner: {gameOver.winner.name}</div>
                    {gameOver.isDragonWin ? (
                        <div className="text-lg mb-4 text-yellow-300 font-bold">
                            Won with a DRAGON (13-card Straight)!
                        </div>
                    ) : (
                        <div className="text-lg mb-4 text-gray-400">Completed in {gameOver.roundNumber} rounds</div>
                    )}

                    <div className="bg-white/10 rounded-lg p-6 mb-8 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4 border-b pb-2">Final Scores</h3>
                        {gameOver.scores && gameOver.scores
                            .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
                            .map((s, idx) => (
                            <div key={s.name} className={`flex justify-between mb-2 ${idx === 0 ? 'text-green-400 font-bold text-lg' : ''}`}>
                                <span>
                                    {idx === 0 && '🏆 '}
                                    {s.name} {s.isBot ? '(Bot)' : ''}
                                </span>
                                <span className={s.cumulativeScore >= 100 ? 'text-red-500' : ''}>
                                    {s.cumulativeScore} pts
                                </span>
                            </div>
                        ))}
                    </div>

                    <button onClick={() => navigate('/lobby')} className="bg-green-600 px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105">
                        Back to Lobby
                    </button>
                </div>
            )}

            {/* Waiting State */}
            {gameState.gameState === 'waiting' && (
                <div className="absolute inset-0 z-40 bg-green-800 flex flex-col items-center justify-center text-white px-4">
                    <div className="text-sm md:text-[1vmax] text-green-300 mb-2 md:mb-[0.5vmax]">Room Code</div>
                    <h1 className="text-5xl md:text-[3vmax] font-bold mb-6 md:mb-[2vmax] tracking-widest">{roomId}</h1>
                    <h2 className="text-xl md:text-[1.5vmax] mb-6 md:mb-[1.5vmax]">Waiting for Players...</h2>
                    <div className="flex flex-wrap justify-center gap-3 md:gap-[1vmax] mb-8 md:mb-[2vmax]">
                        {gameState.players.map(p => (
                            <div key={p.id} className="bg-white text-black px-4 py-3 md:p-[1vmax] rounded shadow-lg min-w-[80px] md:min-w-[6vmax] text-center font-bold text-base md:text-[1vmax]">
                                {p.name}
                            </div>
                        ))}
                        {Array.from({ length: 4 - gameState.players.length }).map((_, i) => (
                            <div key={i} className="bg-white/20 px-4 py-3 md:p-[1vmax] rounded border-2 border-dashed border-white min-w-[80px] md:min-w-[6vmax] text-center text-base md:text-[1vmax]">Empty</div>
                        ))}
                    </div>

                    {/* Game Mode Selector - Only host (first player) can change */}
                    <div className="mb-6 md:mb-[2vmax] w-full max-w-2xl">
                        <div className="text-sm md:text-[1vmax] text-green-300 mb-3 md:mb-[0.75vmax] text-center">Game Mode</div>
                        <div className="flex flex-col md:flex-row gap-3 md:gap-[1vmax] md:justify-center">
                            {Object.values(GAME_MODES).map(mode => {
                                const hostPlayer = gameState.players.find(p => p.name === gameState.hostUsername);
                                const isHost = hostPlayer?.id === myPlayerId;
                                const isSelected = gameState.gameMode === mode.id;
                                return (
                                    <button
                                        key={mode.id}
                                        onClick={() => isHost && socket.emit('set_game_mode', { gameMode: mode.id })}
                                        disabled={!isHost}
                                        className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${
                                            isSelected
                                                ? 'bg-yellow-500 text-black shadow-lg'
                                                : isHost
                                                    ? 'bg-white/20 text-white hover:bg-white/30 cursor-pointer'
                                                    : 'bg-white/10 text-white/50 cursor-not-allowed'
                                        }`}
                                    >
                                        <div className="font-bold whitespace-nowrap">{mode.name}</div>
                                        <div className="text-sm md:text-[0.7vmax] opacity-80 whitespace-nowrap">{mode.description} • {mode.pointThreshold} pts</div>
                                    </button>
                                );
                            })}
                        </div>
                        {(() => {
                            const hostPlayer = gameState.players.find(p => p.name === gameState.hostUsername);
                            return hostPlayer?.id !== myPlayerId && (
                                <div className="text-sm md:text-[0.8vmax] text-yellow-300 mt-3 md:mt-[0.5vmax] text-center">
                                    Only the room host can change the game mode
                                </div>
                            );
                        })()}
                    </div>

                    {/* Room Privacy Settings - Only host can change */}
                    {(() => {
                        const hostPlayer = gameState.players.find(p => p.name === gameState.hostUsername);
                        const isHost = hostPlayer?.id === myPlayerId;
                        return isHost && (
                            <div className="mb-6 md:mb-[2vmax] w-full max-w-2xl">
                                <div className="text-sm md:text-[1vmax] text-green-300 mb-3 md:mb-[0.75vmax] text-center">Room Privacy</div>
                                <div className="flex flex-col md:flex-row gap-3 md:gap-[1vmax] md:justify-center">
                                    <button
                                        onClick={() => {
                                            if (!gameState.isPrivate) {
                                                const password = prompt('Set a password for the room (optional, leave empty for no password):');
                                                socket.emit('set_privacy', { isPrivate: true, password: password || undefined });
                                            } else {
                                                socket.emit('set_privacy', { isPrivate: false, password: undefined });
                                            }
                                        }}
                                        className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${
                                            !gameState.isPrivate
                                                ? 'bg-green-500 text-white shadow-lg'
                                                : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer'
                                        }`}
                                    >
                                        <div className="font-bold">Public Room</div>
                                        <div className="text-sm md:text-[0.7vmax] opacity-80">Anyone can join</div>
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (!gameState.isPrivate) {
                                                const password = prompt('Set a password for the room (optional, leave empty for no password):');
                                                socket.emit('set_privacy', { isPrivate: true, password: password || undefined });
                                            } else {
                                                socket.emit('set_privacy', { isPrivate: false, password: undefined });
                                            }
                                        }}
                                        className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${
                                            gameState.isPrivate
                                                ? 'bg-orange-500 text-white shadow-lg'
                                                : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer'
                                        }`}
                                    >
                                        <div className="font-bold">Private Room {gameState.hasPassword && '🔒'}</div>
                                        <div className="text-sm md:text-[0.7vmax] opacity-80">Only by room code</div>
                                    </button>
                                </div>
                            </div>
                        );
                    })()}

                    {(() => {
                        const hostPlayer = gameState.players.find(p => p.name === gameState.hostUsername);
                        const isHost = hostPlayer?.id === myPlayerId;
                        return isHost ? (
                            <button onClick={startGame} className="bg-yellow-500 text-black px-8 py-3 md:px-[2vmax] md:py-[0.75vmax] rounded-full font-bold text-lg md:text-[1.2vmax] hover:bg-yellow-400 shadow-lg transform transition hover:scale-105 mb-4 md:mb-[1vmax]">
                                Start Game (Fill with Bots)
                            </button>
                        ) : (
                            <div className="text-sm md:text-[0.8vmax] text-yellow-300 mb-4 md:mb-[1vmax] text-center">
                                Waiting for host to start the game...
                            </div>
                        );
                    })()}
                    <button onClick={handleLeaveClick} className="text-green-300 hover:text-white underline text-base md:text-[0.9vmax]">
                        Leave Room
                    </button>
                </div>
            )}

            {/* Game Table Layout */}

            {/* Top Player (Offset 2) */}
            <TopPlayerArea
                player={getRelativePlayer(2)}
                isTurn={gameState.currentTurn === getRelativePlayer(2)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(2))}
            />

            {/* Left Player (Offset 3) */}
            <LeftPlayerArea
                player={getRelativePlayer(3)}
                isTurn={gameState.currentTurn === getRelativePlayer(3)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(3))}
            />

            {/* Right Player (Offset 1) */}
            <RightPlayerArea
                player={getRelativePlayer(1)}
                isTurn={gameState.currentTurn === getRelativePlayer(1)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(1))}
            />

            {/* All played cards - rendered together for proper z-index stacking */}
            <PlayedCards
                lastPlayed={getRelativePlayer(2)?.lastPlayed}
                position="top"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(2))}
                playerName={getRelativePlayer(2)?.name}
                isMe={getRelativePlayer(2)?.id === myPlayerId}
                hasActiveHandOnTable={!!gameState.lastPlayedHand}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(3)?.lastPlayed}
                position="left"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(3))}
                playerName={getRelativePlayer(3)?.name}
                isMe={getRelativePlayer(3)?.id === myPlayerId}
                hasActiveHandOnTable={!!gameState.lastPlayedHand}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(1)?.lastPlayed}
                position="right"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(1))}
                playerName={getRelativePlayer(1)?.name}
                isMe={getRelativePlayer(1)?.id === myPlayerId}
                hasActiveHandOnTable={!!gameState.lastPlayedHand}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(0)?.lastPlayed}
                position="bottom"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(0))}
                playerName={getRelativePlayer(0)?.name}
                isMe={true}
                hasActiveHandOnTable={!!gameState.lastPlayedHand}
            />

            {/* Bottom: My Hand & Controls */}
            <div className="absolute bottom-[2vh] left-1/2 -translate-x-1/2 flex flex-col items-center w-full md:w-[90vw] px-1 md:px-0">
                {/* Hand Helper Buttons - Mobile only, full width */}
                <div className="md:hidden w-full mb-2 mt-14">
                    {gameState.gameState === 'playing' && (
                        <HandHelper
                            playerHand={myHand}
                            lastPlayedHand={gameState.lastPlayedHand}
                            onSelectCards={handleSelectCards}
                            isMyTurn={isMyTurn}
                            selectedCards={selectedCards}
                        />
                    )}
                </div>

                {/* Hand Helper Buttons - Desktop only */}
                <div className="hidden md:flex items-center gap-[1vmax] mb-[0.75vmax]">
                    {gameState.gameState === 'playing' && (
                        <HandHelper
                            playerHand={myHand}
                            lastPlayedHand={gameState.lastPlayedHand}
                            onSelectCards={handleSelectCards}
                            isMyTurn={isMyTurn}
                            selectedCards={selectedCards}
                        />
                    )}
                </div>

                {/* Controls Row with Avatar (Mobile) */}
                <div className="flex items-start justify-between gap-2 md:gap-[1vmax] mb-2 md:mb-[0.75vmax] w-full">
                    <div className="flex items-center gap-2 flex-wrap justify-center flex-1 md:gap-[1vmax]">
                        <button
                            onClick={playCards}
                            disabled={!isMyTurn || selectedCards.length === 0}
                            className={`px-4 md:px-[1.5vmax] py-2.5 md:py-[0.5vmax] rounded-full font-bold shadow-lg transition-all transform text-base md:text-[1vmax]
                                ${isMyTurn && selectedCards.length > 0 ? 'bg-yellow-500 text-black hover:scale-105 active:scale-95' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Play
                        </button>
                        <button
                            onClick={passTurn}
                            disabled={!isMyTurn || !gameState.lastPlayedHand}
                            className={`px-4 md:px-[1.5vmax] py-2.5 md:py-[0.5vmax] rounded-full font-bold shadow-lg transition-all transform text-base md:text-[1vmax]
                                ${isMyTurn && gameState.lastPlayedHand ? 'bg-yellow-600 text-white hover:scale-105 active:scale-95' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Pass
                        </button>
                        <button
                            onClick={handleSortClick}
                            className={`
                                px-3 md:px-[1vmax] py-2 md:py-[0.5vmax] rounded-full font-bold shadow-lg
                                transition transform hover:scale-105 text-sm md:text-[0.85vmax]
                                ${isCustomOrder
                                    ? 'bg-orange-500 text-white hover:bg-orange-400 ring-2 ring-orange-300'
                                    : 'bg-purple-600 text-white hover:bg-purple-500'
                                }
                            `}
                            title={
                                isCustomOrder
                                    ? 'Custom order - Click to resort'
                                    : `Currently sorting by ${sortMode}. Click to sort by ${sortMode === 'rank' ? 'suit' : 'rank'}.`
                            }
                        >
                            {isCustomOrder
                                ? '🔀 Custom'
                                : `Sort: ${sortMode === 'rank' ? '🔢 Rank' : '♠ Suit'}`
                            }
                        </button>
                    </div>

                    {/* Avatar - Mobile only, in flex layout */}
                    <div className="md:hidden flex flex-col items-center shrink-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-4 shadow-lg
                            ${isMyTurn ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse' : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                            {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
                        </div>
                        <div className="text-white bg-black/50 px-2 py-0.5 rounded text-xs font-semibold shadow mt-1 whitespace-nowrap">
                            {user?.username || 'You'}
                            {myIndex !== -1 && gameState.players[myIndex].rating !== undefined && (
                                <span className="text-yellow-200"> ({gameState.players[myIndex].rating})</span>
                            )}
                        </div>
                        <div className="text-yellow-300 text-xs">{myHand.length} Cards</div>
                    </div>
                </div>

                {/* My Hand and Avatar Row - Desktop layout */}
                <div className="flex items-end gap-[1vmax] w-full md:w-auto overflow-visible">
                    {/* Cards */}
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={sortedHand.map(card => `${card.rank}-${card.suit}`)}
                            strategy={horizontalListSortingStrategy}
                        >
                            <div
                                ref={handContainerRef}
                                className="flex justify-center transition-all duration-300 hover:gap-2 md:hover:gap-[0.5vmax] w-full"
                                onTouchStart={handleTouchStart}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                                style={{
                                    touchAction: 'pan-y',
                                    // Shift RIGHT on mobile when we have many cards to show first card better
                                    transform: sortedHand.length >= 10 && dynamicOverlap ? 'translateX(8px)' : 'none'
                                }}
                            >
                                {sortedHand.map((card, index) => {
                                    const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                                    return (
                                        <SortableCard
                                            key={`${card.rank}-${card.suit}`}
                                            card={card}
                                            isSelected={isSelected}
                                            onClick={() => toggleCard(card)}
                                            index={index}
                                            dynamicMargin={dynamicOverlap}
                                        />
                                    );
                                })}
                            </div>
                        </SortableContext>
                    </DndContext>

                    {/* Avatar - Right side (Desktop only) */}
                    <div className="hidden md:flex flex-col items-center mb-[0.5vmax]">
                        <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                            ${isMyTurn ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse' : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                            {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
                        </div>
                        <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                            {user?.username || 'You'}
                            {myIndex !== -1 && gameState.players[myIndex].rating !== undefined && (
                                <span className="text-yellow-200"> ({gameState.players[myIndex].rating})</span>
                            )}
                        </div>
                        <div className="text-yellow-300 text-[0.7vmax]">{myHand.length} Cards</div>
                    </div>
                </div>
            </div>

            {/* Settings Modal */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[200] bg-black/70 flex items-center justify-center"
                        onClick={() => setShowSettings(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center mb-6 md:mb-[1.5vmax]">
                                <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white">Settings</h2>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="text-gray-400 hover:text-white text-3xl md:text-[2vmax] font-bold leading-none"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="space-y-4 md:space-y-[1vmax]">
                                {/* Auto-Pass Setting */}
                                <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                                    <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                        <label className="text-white font-semibold text-lg md:text-[1.2vmax]">
                                            Auto-Pass
                                        </label>
                                        <button
                                            onClick={toggleAutoPass}
                                            className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]
                                                ${autoPass ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                        >
                                            {autoPass ? 'ON' : 'OFF'}
                                        </button>
                                    </div>
                                    <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                        Automatically pass when you have no cards that can beat the played hand
                                    </p>
                                </div>

                                {/* 4-Color Setting */}
                                <div className="bg-gray-700 rounded-lg p-4 md:p-[1vmax]">
                                    <div className="flex items-center justify-between mb-2 md:mb-[0.5vmax]">
                                        <label className="text-white font-semibold text-lg md:text-[1.2vmax]">
                                            4-Color Suits
                                        </label>
                                        <button
                                            onClick={toggleFourColorMode}
                                            className={`px-4 md:px-[1.2vmax] py-2 md:py-[0.6vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]
                                                ${fourColorMode ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                                        >
                                            {fourColorMode ? 'ON' : 'OFF'}
                                        </button>
                                    </div>
                                    <p className="text-gray-300 text-sm md:text-[0.85vmax]">
                                        Use 4-color suits for better visibility (blue diamonds, green clubs)
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 md:mt-[1.5vmax] flex justify-end">
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-6 md:px-[2vmax] py-2 md:py-[0.6vmax] rounded-lg font-bold shadow-lg transition transform hover:scale-105 text-base md:text-[1vmax]"
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Leave Confirmation Modal */}
            <AnimatePresence>
                {showLeaveConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[200] bg-black/80 flex items-center justify-center"
                        onClick={cancelLeave}
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white mb-4">Leave Room?</h2>

                            <div className="text-gray-300 mb-6 space-y-2">
                                {gameState?.hostUsername === user?.username ? (
                                    <>
                                        <p className="font-semibold text-yellow-400">You are the room host!</p>
                                        <p>If you leave:</p>
                                        <ul className="list-disc ml-5 space-y-1">
                                            <li>You will be replaced with a bot</li>
                                            <li>Host will transfer to another player</li>
                                            <li>You will NOT be able to rejoin this game</li>
                                        </ul>
                                    </>
                                ) : (
                                    <>
                                        <p>If you leave:</p>
                                        <ul className="list-disc ml-5 space-y-1">
                                            <li>You will be replaced with a bot</li>
                                            <li>You will NOT be able to rejoin this game</li>
                                        </ul>
                                    </>
                                )}
                                <p className="text-sm text-gray-400 mt-3">
                                    Note: Closing the browser or disconnecting accidentally will let you rejoin.
                                </p>
                            </div>

                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={cancelLeave}
                                    className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition"
                                >
                                    Stay
                                </button>
                                <button
                                    onClick={confirmLeave}
                                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                                >
                                    Leave Room
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Kick Player Confirmation Modal */}
            <AnimatePresence>
                {showKickConfirm && playerToKick && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[200] bg-black/80 flex items-center justify-center"
                        onClick={cancelKick}
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="bg-gray-800 rounded-xl shadow-2xl p-8 md:p-[2vmax] max-w-md w-full mx-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h2 className="text-2xl md:text-[1.8vmax] font-bold text-white mb-4">Kick Player?</h2>

                            <div className="text-gray-300 mb-6 space-y-2">
                                <p>
                                    Are you sure you want to kick <span className="font-bold text-yellow-400">{playerToKick.name}</span>?
                                </p>
                                <ul className="list-disc ml-5 space-y-1 mt-3">
                                    {gameState?.gameState === 'playing' || gameState?.gameState === 'round_over' ? (
                                        <>
                                            <li>They will be replaced with a bot</li>
                                            <li>They will NOT be able to rejoin this game</li>
                                        </>
                                    ) : (
                                        <li>They will be removed from the room</li>
                                    )}
                                </ul>
                            </div>

                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={cancelKick}
                                    className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmKick}
                                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                                >
                                    Kick Player
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default GameRoom;
