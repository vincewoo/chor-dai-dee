import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSpectator from '../hooks/useSpectator';
import Card from './Card';
import CardCountIndicator from './CardCountIndicator';
import { AnimatePresence, motion } from 'framer-motion';
import { canBeatWithAnyHand } from '../utils/handChecker';
import { sortByRank, sortBySuit } from '../utils/cardUtils';
import HandHelper from './HandHelper';
import ScoreDialog from './ScoreDialog';
import { useSuitColors } from '../contexts/SuitColorContext';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { GAME_MODES } from '../constants/gameModes';
import logoImage from '../assets/chor-dai-dee-logo.webp';
import Modal from './Modal';
import SpectatorPanel from './SpectatorPanel';
import VoiceChat from './VoiceChat';
import VoiceIndicator from './VoiceIndicator';
import VoiceControlBubble from './VoiceControlBubble';
import { useVoice } from '../contexts/VoiceContext';
import { SortableCard, PlayedCards } from './cards';
import { TopPlayerArea, LeftPlayerArea, RightPlayerArea } from './PlayerArea';
import { SettingsModal, LeaveConfirmModal, KickConfirmModal } from './modals';
import { RoundOverScreen, MobileScoreboard } from './overlays';
import { GameTableMobile, WaitingRoomV2, GameOverV2 } from './tableV2';
import useGameSounds from '../hooks/useGameSounds';
import { playSound } from '../utils/sounds';

const GameRoom = ({ user, socket }) => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const { fourColorMode, toggleFourColorMode } = useSuitColors();
    const {
        autoPass, toggleAutoPass,
        tableTheme, setTableTheme,
        accentColor, setAccentColor,
        reducedMotion, toggleReducedMotion,
        soundEnabled, toggleSound,
        soundVolume, setSoundVolume,
    } = useUserPreferences();
    const handContainerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);
    // Track our actual player ID (may differ from socket.id due to reconnection timing)
    const [myPlayerId, setMyPlayerId] = useState(socket.id);
    // Determine desktop mode for dynamic card spacing
    // Initialize with a safe check for SSR (though this is a client app)
    const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);

    useEffect(() => {
        // Initial value is set from the useState initializer; here we only
        // subscribe to viewport changes (avoids a synchronous set-in-effect).
        const media = window.matchMedia('(min-width: 768px)');
        const listener = (e) => setIsDesktop(e.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, []);

    // Measure container width for dynamic spacing
    // On mobile, use window width directly since we want cards to fill the screen
    useEffect(() => {
        const updateWidth = () => {
            if (!isDesktop) {
                // Mobile: use window width (cards should fill the screen)
                setContainerWidth(window.innerWidth);
            } else if (handContainerRef.current) {
                // Desktop: measure actual container
                setContainerWidth(handContainerRef.current.getBoundingClientRect().width);
            }
        };

        // Initial measurement
        updateWidth();

        // Listen for resize events
        window.addEventListener('resize', updateWidth);

        // Also use ResizeObserver for container changes (desktop)
        let observer;
        if (handContainerRef.current) {
            observer = new ResizeObserver(entries => {
                for (const entry of entries) {
                    if (isDesktop) {
                        setContainerWidth(entry.contentRect.width);
                    }
                }
            });
            observer.observe(handContainerRef.current);
        }

        return () => {
            window.removeEventListener('resize', updateWidth);
            if (observer) observer.disconnect();
        };
    }, [isDesktop]);

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
    const [showMobileScoreboard, setShowMobileScoreboard] = useState(false); // Mobile scoreboard overlay
    const [showSpectators, setShowSpectators] = useState(false); // Spectator roster panel
    const [voiceState, setVoiceState] = useState(null); // Voice state from VoiceChat component

    // Post-game state for rematch/lobby flow
    const [readyStatus, setReadyStatus] = useState(null); // { ready: [], notReady: [], host: 'username', allReady: bool }
    const [isReady, setIsReady] = useState(false); // Whether current player clicked Ready
    const [isSubmitting, setIsSubmitting] = useState(false); // Prevent double-submission of plays/passes

    // Spectator mode: read-only viewing with every hand face-up.
    const handleSpectateClosed = useCallback((reason) => {
        setNotification(reason || 'This game has ended');
        navigate('/lobby');
    }, [navigate]);

    const {
        spectateModeRef, isSpectator,
        spectatorHands, spectatorSeatId, setSpectatorSeatId,
        emitSpectateJoin, leaveSpectate,
    } = useSpectator(socket, roomId, handleSpectateClosed);

    // Sound effects driven by game state transitions
    useGameSounds({ gameState, roundResult, gameOver, myPlayerId });

    // Voice context for persistent voice across navigation
    const voiceContext = useVoice();
    // Use audio levels directly from context to avoid double renders
    const { audioLevels: voiceAudioLevels } = voiceContext;

    // Track voice user count for non-connected users to see who's in voice
    const [voiceUserCount, setVoiceUserCount] = useState(0);

    // Track touch interactions for swipe selection
    const touchStartRef = useRef(null);

    // The hand rendered in the bottom area. Players see their own; spectators see
    // the hand of whichever seat they're watching (seat 0, or their picked seat).
    const playersList = gameState?.players;
    const bottomHandSource = useMemo(() => {
        if (!isSpectator) return myHand;
        const players = playersList || [];
        if (!players.length) return [];
        const picked = spectatorSeatId ? players.findIndex(p => p.id === spectatorSeatId) : -1;
        const seat = players[picked !== -1 ? picked : 0];
        return spectatorHands[seat?.id] || [];
    }, [isSpectator, myHand, playersList, spectatorSeatId, spectatorHands]);

    // Sorted hand based on current sort mode
    const sortedHand = useMemo(() => {
        // Custom drag order only applies to your own hand - reordering a hand you
        // don't own is meaningless, and the spectator hand isn't draggable.
        if (!isSpectator && isCustomOrder && customHandOrder) {
            return customHandOrder;
        }
        // Otherwise apply current sort mode
        if (sortMode === 'suit') {
            return sortBySuit(bottomHandSource);
        }
        return sortByRank(bottomHandSource);
    }, [bottomHandSource, isSpectator, sortMode, isCustomOrder, customHandOrder]);

    // Calculate card dimensions and overlap dynamically
    // Mobile: Cards scale to fill container width with natural overlap
    // Desktop: Uses vmax sizing (unchanged behavior)
    const cardDimensions = useMemo(() => {
        const cardCount = sortedHand.length;

        // Desktop: use existing vmax sizing with dynamic overlap
        if (isDesktop) {
            const vmax = typeof window !== 'undefined'
                ? Math.max(window.innerWidth, window.innerHeight)
                : 1000;
            const cardWidth = vmax * 0.055; // 5.5vmax

            if (cardCount <= 1 || containerWidth === 0) {
                return { cardWidth, cardHeight: cardWidth * 1.5, margin: -(cardWidth * 0.6), useVmax: true };
            }

            const availableWidthForOverlaps = containerWidth - cardWidth;
            const calculatedOverlap = (availableWidthForOverlaps / (cardCount - 1)) - cardWidth;
            const minOverlap = -(cardWidth * 0.85);
            const maxOverlap = -(cardWidth * 0.2);
            const margin = Math.max(minOverlap, Math.min(maxOverlap, calculatedOverlap));

            return { cardWidth, cardHeight: cardWidth * 1.5, margin, useVmax: true };
        }

        // Mobile: consistent card sizing based on 13 cards filling the screen
        const ASPECT_RATIO = 1.53;
        const MIN_VISIBLE_RATIO = 0.35; // 35% visible (65% overlap) - for 13 cards
        const MAX_VISIBLE_RATIO = 0.50; // 50% visible (50% overlap) - max spread for fewer cards
        const MAX_CARDS = 13; // Always calculate card size as if we have 13 cards

        // Safe defaults
        if (containerWidth === 0 || cardCount === 0) {
            return { cardWidth: 64, cardHeight: 64 * ASPECT_RATIO, margin: -38 };
        }

        // Calculate card width based on 13 cards filling the container
        // This ensures consistent card size throughout the game
        const cardWidth = containerWidth / (1 + (MAX_CARDS - 1) * MIN_VISIBLE_RATIO);
        let cardHeight = cardWidth * ASPECT_RATIO;

        // Cap card height to prevent vertical overflow (max ~22% of viewport height)
        const maxCardHeight = (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.22;
        if (cardHeight > maxCardHeight) {
            cardHeight = maxCardHeight;
        }

        // Calculate margin dynamically based on card count
        // With 13 cards: use MIN_VISIBLE_RATIO (35% visible, 65% overlap) to fit
        // With fewer cards: spread up to MAX_VISIBLE_RATIO (50% visible, 50% overlap)
        const minMargin = -(cardWidth * (1 - MIN_VISIBLE_RATIO)); // 65% overlap (most compressed)
        const maxMargin = -(cardWidth * (1 - MAX_VISIBLE_RATIO)); // 50% overlap (most spread)

        // Calculate what margin we need to fit cards in container vs max spread
        // For 1 card, no margin needed
        let margin;
        if (cardCount === 1) {
            margin = 0;
        } else {
            // Calculate the margin that would make cards fit exactly in container
            // totalWidth = cardWidth + (cardCount - 1) * (cardWidth + margin)
            // containerWidth = cardWidth + (cardCount - 1) * visiblePart
            // visiblePart = cardWidth + margin
            // margin = (containerWidth - cardWidth) / (cardCount - 1) - cardWidth
            const fittingMargin = (containerWidth - cardWidth) / (cardCount - 1) - cardWidth;

            // Clamp between minMargin (most compressed) and maxMargin (most spread)
            margin = Math.max(minMargin, Math.min(maxMargin, fittingMargin));
        }

        return {
            cardWidth,
            cardHeight,
            margin,
        };
    }, [sortedHand.length, containerWidth, isDesktop]);

    useEffect(() => {
        // Spectators must never emit join_room - that would seat them (or bounce
        // them as 'Room full') and would evict them from any room they're watching.
        if (spectateModeRef.current) {
            emitSpectateJoin(user);
        } else {
            // Join room first (handles reconnection if needed), then request state
            socket.emit('join_room', { roomId, username: user?.username, isGuest: user?.isGuest });
        }

        // Set a timeout to detect if room doesn't exist (server restarted)
        const roomLoadTimeout = setTimeout(() => {
            if (!gameState) {
                // Room doesn't exist, redirect to lobby
                console.warn('Room not found, redirecting to lobby');
                voiceContext.leaveVoiceRoom();
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

        // Server confirmed we're watching (fresh navigate, reconnect, or the
        // post-hard-refresh get_room_state fallback that re-identifies us by name).
        const handleSpectatingRoom = ({ gameState: specGameState }) => {
            wasReconnected = true;
            setGameState(specGameState);
            clearTimeout(roomLoadTimeout);
        };
        socket.on('spectating_room', handleSpectatingRoom);

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
            setReadyStatus(null); // Reset post-game state
            setIsReady(false);
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
            setIsSubmitting(false); // Reset submission state on any game update
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
            playSound('error');
            setIsSubmitting(false); // Reset submission state on error
            setTimeout(() => setError(''), 3000);
            // If error is "Room not found", redirect to lobby
            if (err && err.toLowerCase().includes('room not found')) {
                setTimeout(() => {
                    voiceContext.leaveVoiceRoom();
                    navigate('/lobby');
                }, 1500);
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
                voiceContext.leaveVoiceRoom();
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

        // Post-game flow events
        socket.on('ready_status', (status) => {
            setReadyStatus(status);
        });

        socket.on('lobby_ready', ({ roomId: lobbyRoomId, players, hostUsername }) => {
            // Navigate to lobby with room context
            navigate('/lobby', { state: { roomId: lobbyRoomId, isRoomLobby: true, players, hostUsername } });
        });

        socket.on('game_cancelled', ({ reason }) => {
            setNotification({ type: 'warning', message: reason || 'Game cancelled' });
            setTimeout(() => {
                voiceContext.leaveVoiceRoom();
                navigate('/lobby');
            }, 2000);
        });

        socket.on('host_changed', ({ newHost }) => {
            setNotification({ type: 'info', message: `${newHost} is now the host` });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_left', ({ playerName }) => {
            setNotification({ type: 'info', message: `${playerName} left the room` });
            setTimeout(() => setNotification(null), 3000);
        });

        // Voice user count for non-connected users to see who's in voice
        socket.on('voice:user-count', ({ count }) => {
            setVoiceUserCount(count);
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
            socket.off('ready_status');
            socket.off('lobby_ready');
            socket.off('game_cancelled');
            socket.off('host_changed');
            socket.off('player_left');
            socket.off('voice:user-count');
            socket.off('spectating_room', handleSpectatingRoom);
        };
    }, [socket, navigate]);

    // Handle socket disconnect/reconnect events - critical for iOS Safari
    useEffect(() => {
        const handleDisconnect = (reason) => {
            console.log('Socket disconnected:', reason);
        };

        const handleConnect = () => {
            console.log('Socket connected, requesting room state...');
            // Re-join room and request fresh state after reconnection. Spectators
            // repeat spectate_room instead, which re-binds their new socket id.
            if (spectateModeRef.current) {
                emitSpectateJoin(user);
            } else {
                socket.emit('join_room', { roomId, username: user?.username, isGuest: user?.isGuest });
            }
        };

        socket.on('disconnect', handleDisconnect);
        socket.on('connect', handleConnect);

        return () => {
            socket.off('disconnect', handleDisconnect);
            socket.off('connect', handleConnect);
        };
    }, [socket, roomId, user?.username]);

    // Handle page visibility changes - critical for iOS Safari background/foreground
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('Page became visible, checking connection...');
                // When page becomes visible again, check if socket is connected
                if (!socket.connected) {
                    console.log('Socket disconnected while backgrounded, reconnecting...');
                    socket.connect();
                } else {
                    // Socket thinks it's connected, but iOS may have silently killed it
                    // Request fresh room state to ensure we're in sync
                    console.log('Refreshing room state after visibility change...');
                    if (spectateModeRef.current) {
                        emitSpectateJoin(user);
                    } else {
                        socket.emit('join_room', { roomId, username: user?.username, isGuest: user?.isGuest });
                    }
                }
            }
        };

        // Also handle iOS-specific events
        const handlePageShow = (event) => {
            // persisted = true means the page was restored from bfcache
            if (event.persisted) {
                console.log('Page restored from bfcache, reconnecting...');
                if (!socket.connected) {
                    socket.connect();
                } else {
                    socket.emit('join_room', { roomId, username: user?.username, isGuest: user?.isGuest });
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pageshow', handlePageShow);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pageshow', handlePageShow);
        };
    }, [socket, roomId, user?.username]);

    // The server sends a fresh gameState object on every play, pass and turn
    // change, so depending on `gameState` re-ran the auto-pass effect (and its hand
    // search) on every opponent action. Depend on the specific fields the effect
    // reads instead, so it only re-runs when something it cares about changes.
    const currentTurn = gameState?.currentTurn;
    const currentGameState = gameState?.gameState;
    const trickWinPending = gameState?.trickWinPending;
    const lastPlayedHand = gameState?.lastPlayedHand;
    const gamePlayers = gameState?.players;
    const hasOtherHumans = useMemo(
        () => (gamePlayers || []).some(p => !p.isBot && p.id !== myPlayerId),
        [gamePlayers, myPlayerId]
    );

    // Auto-pass effect: check if we should auto-pass when it becomes our turn
    useEffect(() => {
        if (!autoPass || currentGameState !== 'playing') return;

        // Don't auto-pass while a trick win is being displayed
        if (trickWinPending) return;

        const isMyTurn = currentTurn === myPlayerId;

        // Only auto-pass if it's our turn and there's a hand to beat
        if (isMyTurn && lastPlayedHand && !autoPassTriggered.current) {
            // Check if we can beat the hand
            const canBeat = canBeatWithAnyHand(myHand, lastPlayedHand);

            if (!canBeat) {
                autoPassTriggered.current = true;

                // Use randomized delay only when playing against humans
                // This prevents opponents from distinguishing auto-pass from manual pass
                // With only bots, use a short delay for better UX
                const delay = hasOtherHumans
                    ? 1000 + Math.random() * 2000  // 1-3 seconds for human opponents
                    : 300;                          // 300ms for bot-only games

                const timer = setTimeout(() => {
                    socket.emit('pass_turn', { roomId });
                    autoPassTriggered.current = false;
                }, delay);
                return () => clearTimeout(timer);
            }
        }

        // Reset triggered flag when it's no longer our turn
        if (!isMyTurn) {
            autoPassTriggered.current = false;
        }
    }, [autoPass, currentTurn, currentGameState, trickWinPending, lastPlayedHand, hasOtherHumans, myHand, myPlayerId, socket, roomId]);

    const startGame = () => {
        socket.emit('start_game', { roomId });
    };

    const nextRound = () => {
        setRoundResult(null);
        socket.emit('next_round', { roomId });
    };

    // Keeps the state updater pure — playing the sound inside it would double
    // up under StrictMode's double-invoked updaters.
    const selectedCardsRef = useRef(selectedCards);
    useEffect(() => {
        selectedCardsRef.current = selectedCards;
    }, [selectedCards]);

    const toggleCard = useCallback((card) => {
        const isSelected = selectedCardsRef.current.some(c => c.rank === card.rank && c.suit === card.suit);
        playSound(isSelected ? 'deselect' : 'select');
        setSelectedCards(prevSelected => {
            const wasSelected = prevSelected.some(c => c.rank === card.rank && c.suit === card.suit);
            if (wasSelected) {
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
        if (selectedCards.length === 0 || isSubmitting) return;
        setIsSubmitting(true);

        // Optimistic update: immediately remove cards from hand for better responsiveness
        const newHand = myHand.filter(card =>
            !selectedCards.some(sc => sc.rank === card.rank && sc.suit === card.suit)
        );
        setMyHand(newHand);
        const cardsToPlay = [...selectedCards];
        setSelectedCards([]);

        socket.emit('play_card', { roomId, cards: cardsToPlay });
    };

    const passTurn = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        socket.emit('pass_turn', { roomId });
    };

    const leaveRoom = () => {
        // Spectators were never seated, so leave_room doesn't apply to them.
        if (isSpectator) {
            leaveSpectate();
        } else {
            socket.emit('leave_room', { roomId });
        }
        voiceContext.leaveVoiceRoom();
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
        <div className="h-screen-safe mt-safe w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            <img
                src={logoImage}
                alt="Chor Dai Dee Logo"
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] md:w-[30%] opacity-[0.15] pointer-events-none z-0"
            />
            <div className="text-white text-center text-xl font-bold relative z-10">Loading...</div>
        </div>
    );

    const myIndex = gameState?.players ? gameState.players.findIndex(p => p.id === myPlayerId) : -1;
    const isMyTurn = !isSpectator && gameState.currentTurn === myPlayerId;

    // The seat the table is oriented around. Players see their own seat at the
    // bottom; spectators see the seat they picked (mobile) or seat 0 by default.
    // Single source of truth - CenterPile's fly-in math consumes this too, so the
    // two rotations can't drift.
    const seatCount = gameState?.players?.length || 0;
    let viewerIndex = myIndex;
    if (isSpectator) {
        const picked = spectatorSeatId
            ? gameState.players.findIndex(p => p.id === spectatorSeatId)
            : -1;
        viewerIndex = picked !== -1 ? picked : 0;
    }

    // Helper to get relative player positions (Bottom=0, Right=1, Top=2, Left=3)
    const getRelativePlayer = (offset) => {
        if (!seatCount) return null;
        const base = viewerIndex === -1 ? 0 : viewerIndex;
        return gameState.players[(base + offset) % seatCount];
    };

    // Check if current user is host
    const hostPlayer = gameState?.players?.find(p => p.name === gameState.hostUsername);
    const isHost = !isSpectator && hostPlayer?.id === myPlayerId;

    // Whose hand the bottom area is showing (labelled for spectators).
    const bottomSeatPlayer = getRelativePlayer(0);

    // Helper to determine if a player can be kicked
    const canKickPlayer = (player) => {
        return isHost && player && !player.isBot && player.id !== myPlayerId;
    };

    // Use the v2 mobile table for the in-game screen on narrow viewports.
    // The waiting room, game-over, modals, voice, and toasts stay shared.
    const useMobileV2 = !isDesktop && gameState.gameState !== 'waiting';

    return (
        <div className="h-screen-safe mt-safe w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            {/* Game Logo - Background */}
            <img
                src={logoImage}
                alt="Chor Dai Dee Logo"
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] md:w-[30%] opacity-[0.15] pointer-events-none z-0"
            />

            {/* Guest User Banner (legacy / desktop; the v2 mobile table shows guest status inline in the HudBar) */}
            {user?.isGuest && !useMobileV2 && (
                <div className="absolute top-[1vh] left-1/2 -translate-x-1/2 z-20 w-[90%] md:w-auto">
                    <div className="bg-blue-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg text-center">
                        <p className="text-xs md:text-sm font-medium">
                            Playing as Guest - Stats not saved • <button onClick={() => navigate('/')} className="underline hover:text-blue-200">Create Account</button>
                        </p>
                    </div>
                </div>
            )}

            {/* Voice Chat */}
            <VoiceChat
                socket={socket}
                roomId={roomId}
                username={user?.username}
                players={gameState?.players || []}
                onVoiceStateChange={setVoiceState}
            />
            {/* Top Bar (legacy / desktop; hidden when the v2 mobile table is active) */}
            {!useMobileV2 && (
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
                        {(gameState.spectators?.length > 0 || isSpectator) && (
                            <button
                                onClick={() => setShowSpectators(true)}
                                className="text-xs md:text-[0.7vmax] px-2 py-0.5 rounded bg-blue-700 text-blue-100 hover:bg-blue-600"
                                title="Spectators"
                            >
                                👁 {gameState.spectators?.length || 0} watching
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Mobile Scores button - top right corner (legacy; superseded by v2 Info toggle) */}
            {!useMobileV2 && gameState.gameState === 'playing' && gameState.roundNumber > 0 && (
                <button
                    onClick={() => setShowMobileScoreboard(true)}
                    className="md:hidden absolute top-[1vh] right-[1vw] text-xs px-3 py-1.5 rounded-lg bg-yellow-600 text-white hover:bg-yellow-500 font-semibold shadow-lg z-10"
                >
                    Scores
                </button>
            )}

            {/* Mobile Scoreboard Overlay */}
            <MobileScoreboard
                show={showMobileScoreboard}
                players={gameState.players}
                myPlayerId={myPlayerId}
                pointThreshold={gameState.pointThreshold}
                onClose={() => setShowMobileScoreboard(false)}
            />

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
                        className={`absolute top-[8vh] left-1/2 -translate-x-1/2 px-4 md:px-[1.5vmax] py-2 md:py-[0.5vmax] rounded shadow-xl z-[250] font-bold text-base md:text-[1vmax] ${notification.type === 'warning' ? 'bg-yellow-600 text-white' : 'bg-green-600 text-white'
                            }`}
                    >
                        {notification.message}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Round Over Modal (desktop; mobile v2 shows RoundCelebration instead) */}
            {!useMobileV2 && (
                <RoundOverScreen
                    roundResult={roundResult}
                    pointThreshold={gameState.pointThreshold}
                    onNextRound={nextRound}
                />
            )}

            {/* Game Over — shared post-game action buttons (host / non-host / solo) */}
            {gameOver && (() => {
                const gameOverActions = (() => {
                        const humanPlayers = gameState?.players?.filter(p => !p.isBot) || [];
                        const hasMultipleHumans = humanPlayers.length >= 2;
                        const isHost = user?.username === gameState?.hostUsername;

                        // Spectators have no seat, so no Ready/Rematch/host controls.
                        // They can keep watching a rematch or head back to the lobby.
                        if (isSpectator) {
                            return (
                                <div className="flex flex-col gap-3 items-center">
                                    <button
                                        onClick={() => {
                                            leaveSpectate();
                                            voiceContext.leaveVoiceRoom();
                                            navigate('/lobby');
                                        }}
                                        className="bg-green-600 px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105"
                                    >
                                        Back to Lobby
                                    </button>
                                    <div className="text-xs text-gray-400 mt-1">
                                        👁 Watching — stay to see a rematch
                                    </div>
                                </div>
                            );
                        }

                        if (!hasMultipleHumans) {
                            // Solo game - just show back to lobby
                            return (
                                <button
                                    onClick={() => {
                                        voiceContext.leaveVoiceRoom();
                                        navigate('/lobby');
                                    }}
                                    className="bg-green-600 px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105"
                                >
                                    Back to Lobby
                                </button>
                            );
                        }

                        if (isHost) {
                            // Host sees: Rematch, Back to Lobby, Leave
                            return (
                                <div className="flex flex-col gap-3 items-center">
                                    {/* Ready status display */}
                                    {readyStatus && (
                                        <div className="text-sm text-gray-300 mb-2">
                                            {readyStatus.allReady ? (
                                                <span className="text-green-400">All players ready!</span>
                                            ) : (
                                                <>
                                                    {readyStatus.ready.length > 0 && (
                                                        <span className="text-green-400">Ready: {readyStatus.ready.join(', ')}</span>
                                                    )}
                                                    {readyStatus.notReady.length > 0 && (
                                                        <span className="text-yellow-400 ml-2">Waiting: {readyStatus.notReady.join(', ')}</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex gap-3 flex-wrap justify-center">
                                        <button
                                            onClick={() => socket.emit('host_rematch', { roomId })}
                                            disabled={readyStatus && !readyStatus.allReady}
                                            className={`px-6 py-3 rounded-lg font-bold transition transform hover:scale-105 ${readyStatus && !readyStatus.allReady
                                                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                                                : 'bg-green-600 hover:bg-green-700'
                                                }`}
                                            title={readyStatus && !readyStatus.allReady ? 'Waiting for all players to be ready' : 'Start a new game immediately'}
                                        >
                                            Rematch
                                        </button>
                                        <button
                                            onClick={() => socket.emit('host_back_to_lobby', { roomId })}
                                            className="bg-blue-600 px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition transform hover:scale-105"
                                            title="Return everyone to the room lobby"
                                        >
                                            Back to Lobby
                                        </button>
                                        <button
                                            onClick={() => {
                                                socket.emit('leave_after_game', { roomId });
                                                voiceContext.leaveVoiceRoom();
                                                navigate('/lobby');
                                            }}
                                            className="bg-red-600 px-6 py-3 rounded-lg font-bold hover:bg-red-700 transition transform hover:scale-105"
                                            title="Leave and return to main lobby"
                                        >
                                            Leave
                                        </button>
                                    </div>
                                    <div className="text-xs text-gray-400 mt-2">
                                        You are the host
                                    </div>
                                </div>
                            );
                        } else {
                            // Non-host sees: Ready toggle, Leave
                            return (
                                <div className="flex flex-col gap-3 items-center">
                                    {/* Ready status display */}
                                    {readyStatus && (
                                        <div className="text-sm text-gray-300 mb-2">
                                            {readyStatus.ready.length > 0 && (
                                                <span className="text-green-400">Ready: {readyStatus.ready.join(', ')}</span>
                                            )}
                                            {readyStatus.notReady.length > 0 && (
                                                <span className="text-yellow-400 ml-2">Waiting: {readyStatus.notReady.join(', ')}</span>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                if (!isReady) {
                                                    setIsReady(true);
                                                    socket.emit('player_ready', { roomId });
                                                }
                                            }}
                                            disabled={isReady}
                                            className={`px-6 py-3 rounded-lg font-bold transition transform hover:scale-105 ${isReady
                                                ? 'bg-green-700 cursor-default'
                                                : 'bg-green-600 hover:bg-green-700'
                                                }`}
                                        >
                                            {isReady ? '✓ Ready' : 'Ready'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                socket.emit('leave_after_game', { roomId });
                                                voiceContext.leaveVoiceRoom();
                                                navigate('/lobby');
                                            }}
                                            className="bg-red-600 px-6 py-3 rounded-lg font-bold hover:bg-red-700 transition transform hover:scale-105"
                                        >
                                            Leave
                                        </button>
                                    </div>
                                    <div className="text-xs text-gray-400 mt-2">
                                        Waiting for host ({readyStatus?.host || gameState?.hostUsername}) to start
                                    </div>
                                </div>
                            );
                        }
                    })();

                // v2 mobile game-over screen; desktop keeps the legacy modal.
                if (!isDesktop) {
                    return (
                        <GameOverV2 gameOver={gameOver} myName={user?.username}>
                            {gameOverActions}
                        </GameOverV2>
                    );
                }

                return (
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

                        {gameOverActions}
                    </div>
                );
            })()}

            {/* Waiting State (v2 mobile) */}
            {gameState.gameState === 'waiting' && !isDesktop && (
                <WaitingRoomV2
                    roomId={roomId}
                    players={gameState.players}
                    myPlayerId={myPlayerId}
                    isHost={gameState.players.find(p => p.name === gameState.hostUsername)?.id === myPlayerId}
                    hostUsername={gameState.hostUsername}
                    gameMode={gameState.gameMode}
                    fourColorMode={fourColorMode}
                    onSetGameMode={(mode) => socket.emit('set_game_mode', { gameMode: mode })}
                    onToggleFourColor={toggleFourColorMode}
                    onStartGame={startGame}
                    onLeave={handleLeaveClick}
                    onOpenSettings={() => setShowSettings(true)}
                    onShareInvite={() => {
                        try { navigator.clipboard?.writeText(window.location.href); } catch { /* ignore */ }
                    }}
                />
            )}

            {/* Waiting State (legacy / desktop) */}
            {gameState.gameState === 'waiting' && isDesktop && (
                <div className="absolute inset-0 z-40 bg-green-800 overflow-y-auto">
                    <div className="min-h-full flex flex-col items-center justify-center text-white px-4 py-8">
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
                                            className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${isSelected
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
                                                socket.emit('set_privacy', { isPrivate: false });
                                            }}
                                            className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${!gameState.isPrivate
                                                ? 'bg-green-500 text-white shadow-lg'
                                                : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer'
                                                }`}
                                        >
                                            <div className="font-bold">Public Room</div>
                                            <div className="text-sm md:text-[0.7vmax] opacity-80">Anyone can join</div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                socket.emit('set_privacy', { isPrivate: true });
                                            }}
                                            className={`px-6 py-4 md:px-[1.5vmax] md:py-[1vmax] rounded-lg font-bold text-base md:text-[0.9vmax] transition md:min-w-[14vmax] ${gameState.isPrivate
                                                ? 'bg-orange-500 text-white shadow-lg'
                                                : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer'
                                                }`}
                                        >
                                            <div className="font-bold">Private Room</div>
                                            <div className="text-sm md:text-[0.7vmax] opacity-80">Only by room code</div>
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Voice Chat Controls in Waiting Room */}
                        <div className="mb-6 md:mb-[2vmax] w-full max-w-2xl">
                            <div className="text-sm md:text-[1vmax] text-green-300 mb-3 md:mb-[0.75vmax] text-center">Voice Chat</div>
                            <div className="flex flex-col items-center gap-3">
                                {voiceContext?.voiceEnabled ? (
                                    <div className="flex items-center gap-3 flex-wrap justify-center">
                                        <button
                                            onClick={() => voiceContext.toggleVoice()}
                                            className="px-4 py-2 rounded-lg font-bold bg-green-600 text-white hover:bg-green-700 transition flex items-center gap-2"
                                        >
                                            🎤 Voice On
                                        </button>
                                        <button
                                            onClick={() => voiceContext.toggleMute()}
                                            className={`px-4 py-2 rounded-lg font-bold transition flex items-center gap-2 ${voiceContext.isMuted
                                                ? 'bg-red-600 text-white hover:bg-red-700'
                                                : 'bg-gray-600 text-white hover:bg-gray-700'
                                                }`}
                                        >
                                            {voiceContext.isMuted ? '🔇 Muted' : '🔊 Mute'}
                                        </button>
                                        <button
                                            onClick={() => voiceContext.toggleDeafen()}
                                            className={`px-4 py-2 rounded-lg font-bold transition flex items-center gap-2 ${voiceContext.isDeafened
                                                ? 'bg-red-600 text-white hover:bg-red-700'
                                                : 'bg-gray-600 text-white hover:bg-gray-700'
                                                }`}
                                        >
                                            {voiceContext.isDeafened ? '🔕 Deafened' : '🔔 Deafen'}
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => voiceContext?.joinVoiceRoom(roomId, user?.username)}
                                        className={`px-6 py-3 rounded-lg font-bold transition flex items-center gap-2 ${voiceUserCount > 0
                                            ? 'bg-green-600 text-white hover:bg-green-700 animate-pulse'
                                            : 'bg-blue-600 text-white hover:bg-blue-700'
                                            }`}
                                        style={voiceUserCount > 0 ? { animationDuration: '2s' } : undefined}
                                    >
                                        🎤 {voiceUserCount > 0 ? `Join Voice (${voiceUserCount} in chat)` : 'Enable Voice Chat'}
                                    </button>
                                )}
                                {voiceContext?.voiceEnabled && voiceContext?.isVoiceConnected && (
                                    <div className="text-xs text-green-400">
                                        ✓ Connected to voice room
                                    </div>
                                )}
                            </div>
                        </div>

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
                        <button onClick={handleLeaveClick} className="text-green-300 hover:text-white underline text-base md:text-[0.9vmax] mb-4">
                            Leave Room
                        </button>
                    </div>
                </div>
            )}

            {/* Game Table Layout (legacy / desktop) */}
            {!useMobileV2 && (<>

            {/* Top Player (Offset 2) */}
            <TopPlayerArea
                player={getRelativePlayer(2)}
                isTurn={gameState.currentTurn === getRelativePlayer(2)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(2))}
                voiceAudioLevels={voiceAudioLevels}
                cards={isSpectator ? spectatorHands[getRelativePlayer(2)?.id] : null}
            />

            {/* Left Player (Offset 3) */}
            <LeftPlayerArea
                player={getRelativePlayer(3)}
                isTurn={gameState.currentTurn === getRelativePlayer(3)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(3))}
                voiceAudioLevels={voiceAudioLevels}
                cards={isSpectator ? spectatorHands[getRelativePlayer(3)?.id] : null}
            />

            {/* Right Player (Offset 1) */}
            <RightPlayerArea
                player={getRelativePlayer(1)}
                isTurn={gameState.currentTurn === getRelativePlayer(1)?.id}
                onPlayerClick={handlePlayerClick}
                isClickable={canKickPlayer(getRelativePlayer(1))}
                voiceAudioLevels={voiceAudioLevels}
                cards={isSpectator ? spectatorHands[getRelativePlayer(1)?.id] : null}
            />

            {/* All played cards - rendered together for proper z-index stacking */}
            <PlayedCards
                lastPlayed={getRelativePlayer(2)?.lastPlayed}
                position="top"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(2))}
                playerName={getRelativePlayer(2)?.name}
                isMe={getRelativePlayer(2)?.id === myPlayerId}
                trickWinPending={gameState.trickWinPending}
                isDesktop={isDesktop}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(3)?.lastPlayed}
                position="left"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(3))}
                playerName={getRelativePlayer(3)?.name}
                isMe={getRelativePlayer(3)?.id === myPlayerId}
                trickWinPending={gameState.trickWinPending}
                isDesktop={isDesktop}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(1)?.lastPlayed}
                position="right"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(1))}
                playerName={getRelativePlayer(1)?.name}
                isMe={getRelativePlayer(1)?.id === myPlayerId}
                trickWinPending={gameState.trickWinPending}
                isDesktop={isDesktop}
            />
            <PlayedCards
                lastPlayed={getRelativePlayer(0)?.lastPlayed}
                position="bottom"
                isCurrentTurn={isPlayersTurn(getRelativePlayer(0))}
                playerName={getRelativePlayer(0)?.name}
                // For a spectator the bottom seat is someone else, so it must
                // read "<name>'s Turn", never "Your Turn!".
                isMe={getRelativePlayer(0)?.id === myPlayerId}
                trickWinPending={gameState.trickWinPending}
                isDesktop={isDesktop}
            />

            {/* Bottom: My Hand & Controls - Anchored at bottom, flows upward */}
            <div className="absolute bottom-[0.5vh] left-1/2 -translate-x-1/2 flex flex-col items-center w-full md:w-[90vw] px-0 md:px-0">
                {/* Hand Helper Buttons - Mobile only, full width */}
                <div className="md:hidden w-full mb-1">
                    {gameState.gameState === 'playing' && !isSpectator && (
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
                    {gameState.gameState === 'playing' && !isSpectator && (
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
                <div className="relative flex items-start justify-center gap-2 md:gap-[1vmax] mb-1 md:mb-[0.75vmax] w-full">
                    <div className={`flex items-center gap-2 flex-wrap justify-center md:gap-[1vmax] ${isSpectator ? 'hidden' : ''}`}>
                        <button
                            onClick={playCards}
                            disabled={!isMyTurn || selectedCards.length === 0 || gameState.trickWinPending}
                            className={`px-4 md:px-[1.5vmax] py-2.5 md:py-[0.5vmax] rounded-full font-bold shadow-lg transition-all transform text-base md:text-[1vmax]
                                ${isMyTurn && selectedCards.length > 0 && !gameState.trickWinPending ? 'bg-yellow-500 text-black hover:scale-105 active:scale-95' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                            title={gameState.trickWinPending ? 'Waiting for trick to clear...' : ''}
                        >
                            Play
                        </button>
                        <button
                            onClick={passTurn}
                            disabled={!isMyTurn || !gameState.lastPlayedHand || gameState.trickWinPending}
                            className={`px-4 md:px-[1.5vmax] py-2.5 md:py-[0.5vmax] rounded-full font-bold shadow-lg transition-all transform text-base md:text-[1vmax]
                                ${isMyTurn && gameState.lastPlayedHand && !gameState.trickWinPending ? 'bg-yellow-600 text-white hover:scale-105 active:scale-95' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                            title={gameState.trickWinPending ? 'Waiting for trick to clear...' : ''}
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

                    {/* Voice Control Bubble - Mobile only, absolutely positioned */}
                    <div className="md:hidden absolute right-2 top-0">
                        <VoiceControlBubble
                            username={user?.username}
                            voiceEnabled={voiceState?.voiceEnabled || false}
                            isVoiceConnected={voiceState?.isVoiceConnected || false}
                            isMuted={voiceState?.isMuted || false}
                            isDeafened={voiceState?.isDeafened || false}
                            forcedMute={voiceState?.forcedMute || false}
                            audioLevel={voiceAudioLevels[user?.username] || 0}
                            onToggleVoice={voiceState?.handleVoiceToggle}
                            onToggleMute={voiceState?.toggleMute}
                            onToggleDeafen={voiceState?.toggleDeafen}
                            onVolumeChange={voiceState?.handleVolumeChange}
                            players={gameState?.players || []}
                            peers={voiceState?.peers || []}
                            playerVolumes={voiceState?.playerVolumes || {}}
                            size="mobile"
                        />
                    </div>
                </div>

                {/* Spectator caption: the bottom fan belongs to a player, not us */}
                {isSpectator && bottomSeatPlayer && (
                    <div className="mb-1 md:mb-[0.4vmax] text-center">
                        <span className="bg-black/50 text-white px-3 py-1 md:px-[0.8vmax] md:py-[0.2vmax] rounded-full text-xs md:text-[0.8vmax] font-semibold">
                            👁 Watching · {bottomSeatPlayer.name}&apos;s hand
                        </span>
                    </div>
                )}

                {/* My Hand and Avatar Row - Desktop layout */}
                <div className="flex items-end gap-[1vmax] w-full md:w-auto overflow-visible">
                    {/* Cards - wrapper needs w-full to expand DndContext */}
                    <div className="w-full md:w-auto">
                        {isSpectator ? (
                            // Read-only fan: no dnd-kit, no selection, no click affordance.
                            <div
                                className="flex justify-center w-full"
                                style={{ minHeight: cardDimensions.cardHeight ? `${cardDimensions.cardHeight}px` : undefined }}
                            >
                                {sortedHand.map((card, index) => (
                                    <div
                                        key={`${card.rank}-${card.suit}`}
                                        style={{ marginLeft: index === 0 ? 0 : cardDimensions.margin }}
                                    >
                                        <Card
                                            rank={card.rank}
                                            suit={card.suit}
                                            selected={false}
                                            readOnly
                                            index={index}
                                            dynamicWidth={cardDimensions.useVmax ? null : cardDimensions.cardWidth}
                                            dynamicHeight={cardDimensions.useVmax ? null : cardDimensions.cardHeight}
                                            isDesktop={isDesktop}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : (
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
                                    className="flex justify-center transition-all duration-300 md:hover:gap-[0.5vmax] w-full"
                                    onTouchStart={handleTouchStart}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={handleTouchEnd}
                                    style={{
                                        touchAction: 'pan-y',
                                        minHeight: cardDimensions.cardHeight ? `${cardDimensions.cardHeight}px` : undefined,
                                    }}
                                >
                                    {sortedHand.map((card, index) => {
                                        const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                                        return (
                                            <SortableCard
                                                key={`${card.rank}-${card.suit}`}
                                                card={card}
                                                isSelected={isSelected}
                                                onToggle={toggleCard}
                                                index={index}
                                                dynamicMargin={cardDimensions.margin}
                                                dynamicWidth={cardDimensions.useVmax ? null : cardDimensions.cardWidth}
                                                dynamicHeight={cardDimensions.useVmax ? null : cardDimensions.cardHeight}
                                                isDesktop={isDesktop}
                                            />
                                        );
                                    })}
                                </div>
                            </SortableContext>
                        </DndContext>
                        )}
                    </div>

                    {/* Avatar - Right side (Desktop only). Spectators have no seat. */}
                    <div className={`${isSpectator ? 'hidden' : 'hidden md:flex'} flex-col items-center mb-[0.5vmax]`}>
                        <div className="relative">
                            <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                                ${voiceAudioLevels && voiceAudioLevels[user?.username] > 0.05
                                    ? 'border-green-400 bg-green-400 text-white animate-pulse'
                                    : isMyTurn
                                        ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse'
                                        : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                                {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
                            </div>
                            <VoiceIndicator
                                isActive={voiceAudioLevels && voiceAudioLevels[user?.username] > 0.05}
                                level={voiceAudioLevels[user?.username] || 0}
                            />
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

            </>)}

            {/* v2 Mobile Game Table */}
            {useMobileV2 && (
                <GameTableMobile
                    user={user}
                    roomId={roomId}
                    gameState={gameState}
                    myPlayerId={myPlayerId}
                    fourColorMode={fourColorMode}
                    sortedHand={sortedHand}
                    myHand={myHand}
                    selectedCards={selectedCards}
                    toggleCard={toggleCard}
                    handleSelectCards={handleSelectCards}
                    playCards={playCards}
                    passTurn={passTurn}
                    isSubmitting={isSubmitting}
                    isMyTurn={isMyTurn}
                    getRelativePlayer={getRelativePlayer}
                    canKickPlayer={canKickPlayer}
                    handlePlayerClick={handlePlayerClick}
                    sortMode={sortMode}
                    isCustomOrder={isCustomOrder}
                    handleSortClick={handleSortClick}
                    roundResult={roundResult}
                    nextRound={nextRound}
                    onOpenSettings={() => setShowSettings(true)}
                    onCreateAccount={() => navigate('/')}
                    sensors={sensors}
                    handleDragStart={handleDragStart}
                    handleDragEnd={handleDragEnd}
                    handContainerRef={handContainerRef}
                    handleTouchStart={handleTouchStart}
                    handleTouchMove={handleTouchMove}
                    handleTouchEnd={handleTouchEnd}
                    containerWidth={containerWidth}
                    voiceState={voiceState}
                    voiceAudioLevels={voiceAudioLevels}
                    isSpectator={isSpectator}
                    viewerIndex={viewerIndex}
                    onSelectSeat={(player) => setSpectatorSeatId(player?.id ?? null)}
                    onOpenSpectators={() => setShowSpectators(true)}
                />
            )}

            {/* Spectator roster + host mute controls (both breakpoints) */}
            <SpectatorPanel
                show={showSpectators}
                onClose={() => setShowSpectators(false)}
                spectators={gameState?.spectators || []}
                mutedAll={gameState?.spectatorsMutedAll}
                isHost={isHost}
                onMuteAll={(muted) => socket.emit('mute_all_spectators', { roomId, muted })}
                onMuteOne={(username, muted) => socket.emit('mute_spectator', { roomId, username, muted })}
            />

            {/* Settings Modal */}
            <SettingsModal
                show={showSettings}
                onClose={() => setShowSettings(false)}
                autoPass={autoPass}
                toggleAutoPass={toggleAutoPass}
                fourColorMode={fourColorMode}
                toggleFourColorMode={toggleFourColorMode}
                tableTheme={tableTheme}
                setTableTheme={setTableTheme}
                accentColor={accentColor}
                setAccentColor={setAccentColor}
                reducedMotion={reducedMotion}
                toggleReducedMotion={toggleReducedMotion}
                soundEnabled={soundEnabled}
                toggleSound={toggleSound}
                soundVolume={soundVolume}
                setSoundVolume={setSoundVolume}
                onLeave={() => { setShowSettings(false); handleLeaveClick(); }}
            />

            {/* Leave Confirmation Modal */}
            <LeaveConfirmModal
                show={showLeaveConfirm}
                isHost={gameState?.hostUsername === user?.username}
                onConfirm={confirmLeave}
                onCancel={cancelLeave}
            />

            {/* Kick Player Confirmation Modal */}
            <KickConfirmModal
                show={showKickConfirm}
                playerToKick={playerToKick}
                isGameInProgress={gameState?.gameState === 'playing' || gameState?.gameState === 'round_over'}
                onConfirm={confirmKick}
                onCancel={cancelKick}
            />
        </div>
    );
};

export default GameRoom;
