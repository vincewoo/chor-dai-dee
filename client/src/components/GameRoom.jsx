import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSpectator from '../hooks/useSpectator';
import { AnimatePresence, motion } from 'framer-motion';
import { canBeatWithAnyHand } from '../utils/handChecker';
import { sortByRank, sortBySuit } from '../utils/cardUtils';
import { lensServerMessage } from '../utils/suitLens';
import ScoreDialog from './ScoreDialog';
import { useSuitColors } from '../contexts/SuitColorContext';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import logoImage from '../assets/chor-dai-dee-logo.webp';
import SpectatorPanel from './SpectatorPanel';
import VoiceChat from './VoiceChat';
import VoiceControlBubble from './VoiceControlBubble';
import { useVoice } from '../contexts/VoiceContext';
import { SettingsModal, LeaveConfirmModal, KickConfirmModal } from './modals';
import { GameTableMobile, GameTableDesktop, WaitingRoomV2, GameOverV2 } from './tableV2';
import { useIsDesktop } from '../hooks/useMediaQuery';
import useGameSounds from '../hooks/useGameSounds';
import { playSound } from '../utils/sounds';

const GameRoom = ({ user, socket }) => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const { fourColorMode, toggleFourColorMode, pusoyMode, togglePusoyMode } = useSuitColors();
    const {
        autoPass, toggleAutoPass,
        coachEnabled, toggleCoach,
        tableTheme, setTableTheme,
        accentColor, setAccentColor,
        reducedMotion, toggleReducedMotion,
        soundEnabled, toggleSound,
        soundVolume, setSoundVolume,
        setBotDifficulty,
    } = useUserPreferences();
    const handContainerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);
    // Track our actual player ID (may differ from socket.id due to reconnection timing)
    const [myPlayerId, setMyPlayerId] = useState(socket.id);
    // Which table composition to render.
    const isDesktop = useIsDesktop();

    // Width the hand fan has to work with. The mobile table is full-bleed, so
    // the window width is exactly right; the desktop table measures its own
    // hand rail (GameTableDesktop) and ignores this.
    useEffect(() => {
        const updateWidth = () => setContainerWidth(window.innerWidth);
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
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
    const [showSpectators, setShowSpectators] = useState(false); // Spectator roster panel
    const [voiceState, setVoiceState] = useState(null); // Voice state from VoiceChat component

    // ---- Coach ----
    // One slot, whatever the owl last said: a hint you asked for or a note
    // about the move you just made. Two bubbles from one character would be a
    // conversation the player never had, so the newer message replaces the
    // older one. `id` only exists to re-key the animation.
    const [coachMessage, setCoachMessage] = useState(null);
    const [coachBusy, setCoachBusy] = useState(false);
    const coachMessageId = useRef(0);

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

    // The socket listeners below are registered once (deps: [socket, navigate]),
    // so the suit lens is read through a ref — putting it in the dep array would
    // tear down and rebuild every listener each time the player toggles it.
    const pusoyModeRef = useRef(pusoyMode);
    useEffect(() => { pusoyModeRef.current = pusoyMode; }, [pusoyMode]);

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
            // The server writes errors in underlying suit notation; rewrite the
            // one that names a card for whichever lens this viewer is using.
            setError(lensServerMessage(err, pusoyModeRef.current));
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
                    // `auto` tells the server this pass came from the
                    // preference, not from the player. It cannot tell
                    // otherwise, and the randomized delay above -- chosen so
                    // opponents cannot distinguish an auto-pass -- would
                    // otherwise land in the middle of the plausible human
                    // deliberation band in any timing analysis.
                    socket.emit('pass_turn', { roomId, auto: true });
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

    // ---- Coach wiring ----
    //
    // Registered apart from the main listener block so the coach can be added
    // to or removed from a live room without tearing down every other handler.
    //
    // A hint is only good for the one decision it was asked about: it names
    // cards you hold right now and has already selected them, so the moment you
    // play or pass it is spent and must not come back on its own. A note is
    // about a move already made and outlives the turn, so rather than clearing
    // on every turn change — which would kill a note within a second of a bot
    // moving — each message is stamped with the decision it belongs to and only
    // hints are filtered at render time.
    //
    // The stamp must be the server's `turnNumber`, which increments on every
    // play and pass. Keying on `currentTurn` does not work: that is a player id
    // and takes the same value every time the turn comes back around, so a
    // spent hint matched again and reappeared on the next turn with stale
    // advice. The stamp is read through a ref because the listeners below are
    // registered once, per the same reasoning as pusoyModeRef above.
    const coachTurnKey = `${gameState?.roundNumber}:${gameState?.turnNumber}`;
    const coachTurnKeyRef = useRef(coachTurnKey);
    useEffect(() => { coachTurnKeyRef.current = coachTurnKey; }, [coachTurnKey]);

    useEffect(() => {
        const say = (message) => {
            coachMessageId.current += 1;
            setCoachMessage({ ...message, id: coachMessageId.current, turnKey: coachTurnKeyRef.current });
        };

        const handleHint = (hint) => {
            setCoachBusy(false);
            if (!hint || hint.error) {
                return say({
                    source: 'hint', tone: 'good',
                    headline: 'Not right now.',
                    detail: hint?.error || 'The coach could not read this position.',
                });
            }
            // The whole point of the button: the hint arrives already selected,
            // so the next tap is Play. A pass suggestion clears the selection
            // instead — being told to pass while cards sit selected invites
            // playing them by accident.
            setSelectedCards(hint.action === 'play' ? hint.cards : []);
            say({
                source: 'hint',
                tone: 'good',
                headline: hint.headline,
                detail: hint.detail,
                factors: hint.factors,
                confident: hint.confident,
            });
        };

        const handleNote = (note) => {
            if (!note) return;
            say({
                source: 'note',
                tone: note.tone,
                headline: note.headline,
                detail: note.detail,
                factors: note.factors,
                bestMoveCards: note.bestMoveCards,
                bestMoveLabel: note.bestMoveLabel,
            });
        };

        socket.on('coach_hint', handleHint);
        socket.on('coach_note', handleNote);
        return () => {
            socket.off('coach_hint', handleHint);
            socket.off('coach_note', handleNote);
        };
    }, [socket]);

    // Tell the room which seats want coaching. Re-sent whenever the player id
    // changes, because a reconnect issues a new one and the server keys the
    // set on it. Spectators are rejected server-side and have no button anyway.
    useEffect(() => {
        if (isSpectator || !myPlayerId) return;
        socket.emit('set_coach', { roomId, enabled: coachEnabled });
    }, [socket, roomId, coachEnabled, myPlayerId, isSpectator]);

    // Notes arrive unprompted, so they time out. Hints were asked for and stay
    // until dismissed or until the turn moves on (see the turn stamp above).
    useEffect(() => {
        if (coachMessage?.source !== 'note') return;
        const timer = setTimeout(() => setCoachMessage(null), 9000);
        return () => clearTimeout(timer);
    }, [coachMessage]);

    const askCoach = useCallback(() => {
        setCoachBusy(true);
        socket.emit('coach_hint', { roomId });
        // The reply always clears this, but a room that vanished mid-request
        // would otherwise leave the owl greyed out for good.
        setTimeout(() => setCoachBusy(false), 4000);
    }, [socket, roomId]);

    // A stale hint is worse than no hint: its cards may already be played.
    const visibleCoachMessage =
        coachMessage && (coachMessage.source !== 'hint' || coachMessage.turnKey === coachTurnKey)
            ? coachMessage
            : null;

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

    // Handle drag end event
    const handleDragEnd = (event) => {
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
        // The hint was about this decision and the decision is now made. The
        // turn stamp would retire it a moment later anyway, once game_update
        // lands; clearing here means it goes the instant you commit, and leaves
        // the slot free for the coach's note on what you just played.
        setCoachMessage(null);

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
        setCoachMessage(null);
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

    // Helper to determine if a player can be kicked
    const canKickPlayer = (player) => {
        return isHost && player && !player.isBot && player.id !== myPlayerId;
    };

    // The in-game screen. The waiting room replaces it entirely, and the
    // orchestrator is picked by viewport; everything else (modals, voice,
    // toasts, spectator panel) is shared by both.
    const showTable = gameState.gameState !== 'waiting';
    const TableComposition = isDesktop ? GameTableDesktop : GameTableMobile;
    const tableProps = {
        user, roomId, gameState, myPlayerId, fourColorMode, pusoyMode,
        sortedHand, myHand, selectedCards, toggleCard, handleSelectCards,
        playCards, passTurn, isSubmitting, isMyTurn, getRelativePlayer,
        canKickPlayer, handlePlayerClick,
        sortMode, isCustomOrder, handleSortClick,
        roundResult, nextRound,
        onOpenSettings: () => setShowSettings(true),
        onCreateAccount: () => navigate('/'),
        sensors, handleDragEnd,
        handContainerRef,
        containerWidth, voiceState, voiceAudioLevels,
        isSpectator, viewerIndex,
        onSelectSeat: (player) => setSpectatorSeatId(player?.id ?? null),
        onOpenSpectators: () => setShowSpectators(true),
        // One bundle for both coach surfaces: the owl button in ControlsRow and
        // the speech bubble above it. Spectators never see either — they have
        // no move to be coached on.
        coach: {
            enabled: coachEnabled && !isSpectator,
            canAsk: isMyTurn && !gameState.trickWinPending && !isSubmitting,
            busy: coachBusy,
            onAsk: askCoach,
            message: visibleCoachMessage,
            onDismiss: () => setCoachMessage(null),
        },
    };

    return (
        <div className="h-screen-safe mt-safe w-screen bg-[#0b0d10] relative overflow-hidden flex items-center justify-center font-sans">
            {/* Owns the room's WebRTC lifecycle; renders nothing itself. */}
            <VoiceChat
                socket={socket}
                roomId={roomId}
                username={user?.username}
                onVoiceStateChange={setVoiceState}
            />
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

                return (
                    <GameOverV2 gameOver={gameOver} myName={user?.username}>
                        {gameOverActions}
                        {/* Guests have no account to attribute decisions to, so
                            there is nothing to review. */}
                        {gameOver?.gameId && !user?.isGuest && (
                            <button
                                onClick={() => navigate(`/review/${gameOver.gameId}`)}
                                className="px-6 py-2 rounded-lg font-bold text-sm transition transform hover:scale-105"
                                style={{ background: 'rgba(0,0,0,.38)', border: '1px solid rgba(255,255,255,.2)', color: 'rgba(244,245,247,.9)' }}
                            >
                                🔍 Review my moves
                            </button>
                        )}
                    </GameOverV2>
                );
            })()}

            {/* Waiting State */}
            {gameState.gameState === 'waiting' && (
                <WaitingRoomV2
                    roomId={roomId}
                    players={gameState.players}
                    myPlayerId={myPlayerId}
                    isHost={gameState.players.find(p => p.name === gameState.hostUsername)?.id === myPlayerId}
                    hostUsername={gameState.hostUsername}
                    gameMode={gameState.gameMode}
                    botDifficulty={gameState.botDifficulty}
                    fourColorMode={fourColorMode}
                    pusoyMode={pusoyMode}
                    isPrivate={gameState.isPrivate}
                    onSetPrivacy={(priv) => socket.emit('set_privacy', { isPrivate: priv })}
                    onSetGameMode={(mode) => socket.emit('set_game_mode', { gameMode: mode })}
                    onSetBotDifficulty={(difficulty) => {
                        socket.emit('set_bot_difficulty', { difficulty });
                        // Remember it, so the next room this player creates
                        // starts here. The room stays authoritative either way.
                        setBotDifficulty(difficulty);
                    }}
                    onToggleFourColor={toggleFourColorMode}
                    onTogglePusoy={togglePusoyMode}
                    voice={{
                        enabled: !!voiceContext?.voiceEnabled,
                        connected: !!voiceContext?.isVoiceConnected,
                        isMuted: !!voiceContext?.isMuted,
                        isDeafened: !!voiceContext?.isDeafened,
                        userCount: voiceUserCount,
                        onJoin: () => voiceContext?.joinVoiceRoom(roomId, user?.username),
                        onToggleMute: () => voiceContext?.toggleMute(),
                        onToggleDeafen: () => voiceContext?.toggleDeafen(),
                    }}
                    onStartGame={startGame}
                    onLeave={handleLeaveClick}
                    onOpenSettings={() => setShowSettings(true)}
                    onShareInvite={() => {
                        try { navigator.clipboard?.writeText(window.location.href); } catch { /* ignore */ }
                    }}
                />
            )}

            {/* v2 game table. Same props either way — the two orchestrators
                differ only in composition. */}
            {showTable && <TableComposition {...tableProps} />}

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
                coachEnabled={coachEnabled}
                toggleCoach={toggleCoach}
                fourColorMode={fourColorMode}
                toggleFourColorMode={toggleFourColorMode}
                pusoyMode={pusoyMode}
                togglePusoyMode={togglePusoyMode}
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
