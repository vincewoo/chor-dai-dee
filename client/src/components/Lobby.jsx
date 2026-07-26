import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import HowToPlay from './HowToPlay';
import ScoreDialog from './ScoreDialog';
import { useVoice } from '../contexts/VoiceContext';
import { GAME_MODES } from '../constants/gameModes';
import { HomeScreenV2, WaitingRoomV2 } from './tableV2';
import { useSuitColors } from '../contexts/SuitColorContext';

const Lobby = ({ user, socket, setUser }) => {
    const [roomId, setRoomId] = useState('');
    const [error, setError] = useState('');
    const [reconnecting, setReconnecting] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    // Room id we can offer to watch after a join was refused for being full
    const [spectateOffer, setSpectateOffer] = useState(null);
    const [connected, setConnected] = useState(socket.connected);
    const [showHowToPlay, setShowHowToPlay] = useState(false);
    const [joinableRooms, setJoinableRooms] = useState([]);
    const [recentGames, setRecentGames] = useState([]);
    // Snapshot "now" once at mount so the relative "Xm ago" labels stay pure
    // across re-renders (avoids calling Date.now() during render).
    const [nowTs] = useState(() => Date.now());
    const [selectedGame, setSelectedGame] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();
    const voiceContext = useVoice();
    const { fourColorMode, toggleFourColorMode } = useSuitColors();

        // Room lobby state (when returning from a game)
    const [roomLobbyData, setRoomLobbyData] = useState(null);
    // { roomId, players, hostUsername, gameMode }
    const [selectedGameMode, setSelectedGameMode] = useState('standard');

    // Check if we're returning from a game to room lobby
    useEffect(() => {
        if (location.state?.isRoomLobby && location.state?.roomId) {
            console.log('Returning to room lobby:', location.state);
            // Deriving state from router navigation on mount; guarded by the
            // condition above so this isn't an unconditional render cascade.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRoomLobbyData({
                roomId: location.state.roomId,
                players: location.state.players || [],
                hostUsername: location.state.hostUsername
            });
            // Join the socket room to receive updates
            socket.emit('get_room_state', { roomId: location.state.roomId });
            // Clear the location state to prevent re-triggering on refresh
            window.history.replaceState({}, document.title);
        }
    }, [location.state, socket]);

    // Socket listeners for room lobby updates
    useEffect(() => {
        if (!roomLobbyData) return;

        const handleRoomUpdate = (state) => {
            if (state.id === roomLobbyData.roomId || state.roomId === roomLobbyData.roomId) {
                setRoomLobbyData(prev => ({
                    ...prev,
                    players: state.players || prev.players,
                    hostUsername: state.hostUsername || prev.hostUsername,
                    gameMode: state.gameMode || prev.gameMode
                }));
                if (state.gameMode) {
                    setSelectedGameMode(state.gameMode);
                }
            }
        };

        const handleGameStarted = () => {
            // Game started, navigate to game room
            navigate(`/game/${roomLobbyData.roomId}`);
        };

        const handlePlayerLeft = ({ playerName }) => {
            setRoomLobbyData(prev => ({
                ...prev,
                players: prev.players.filter(p => p.name !== playerName)
            }));
        };

        const handleHostChanged = ({ newHost }) => {
            setRoomLobbyData(prev => ({
                ...prev,
                hostUsername: newHost
            }));
        };

        socket.on('room_update', handleRoomUpdate);
        socket.on('game_started', handleGameStarted);
        socket.on('player_left', handlePlayerLeft);
        socket.on('host_changed', handleHostChanged);

        return () => {
            socket.off('room_update', handleRoomUpdate);
            socket.off('game_started', handleGameStarted);
            socket.off('player_left', handlePlayerLeft);
            socket.off('host_changed', handleHostChanged);
        };
    }, [roomLobbyData, socket, navigate]);

    // Handle leaving room lobby
    const handleLeaveRoomLobby = useCallback(() => {
        if (roomLobbyData) {
            socket.emit('leave_room', { roomId: roomLobbyData.roomId });
            voiceContext.leaveVoiceRoom();
        }
        setRoomLobbyData(null);
    }, [roomLobbyData, socket, voiceContext]);

    // Handle starting game from room lobby
    const handleStartGameFromLobby = useCallback(() => {
        if (roomLobbyData) {
            socket.emit('start_game', { roomId: roomLobbyData.roomId, useAdvancedBots: true });
        }
    }, [roomLobbyData, socket]);

    // Handle game mode change in room lobby
    const handleGameModeChange = useCallback((mode) => {
        setSelectedGameMode(mode);
        if (roomLobbyData) {
            socket.emit('set_game_mode', { roomId: roomLobbyData.roomId, gameMode: mode });
        }
    }, [roomLobbyData, socket]);

    // Handle voice toggle in room lobby
    const handleVoiceToggle = useCallback(async () => {
        if (roomLobbyData) {
            if (voiceContext.voiceEnabled) {
                voiceContext.leaveVoiceRoom();
            } else {
                await voiceContext.joinVoiceRoom(roomLobbyData.roomId, user.username);
            }
        }
    }, [roomLobbyData, voiceContext, user.username]);

    const handleLogout = () => {
        // Drop the mic/peer connections before the identity goes away, otherwise
        // the WebRTC session outlives the user it was opened for.
        if (voiceContext?.voiceEnabled) {
            voiceContext.leaveVoiceRoom();
        }
        setUser(null);
        navigate('/');
    };

    const handleGameClick = (game) => {
        // Check if game has valid data
        if (!game || !game.participants) {
            console.error('Invalid game data:', game);
            return;
        }

        // Convert game data to format expected by ScoreDialog
        const winner = game.participants.find(p => p.placement === 1);

        // For completed games from activity feed, always set a winner to trigger "Final Scores" display
        const gameDialogData = {
            winner: winner ? { name: winner.username } : { name: game.winner_username || 'Unknown' },
            scores: game.participants.map(p => ({
                name: p.username || 'Unknown',
                isBot: p.isBot || false,
                cumulativeScore: p.score || 0,
                finalScore: p.score || 0
            })),
            roundNumber: game.total_rounds || 0,
            gameMode: game.game_mode || 'standard',
            isDragonWin: false, // We could detect this from events if needed
            // Carried so the dialog can offer a review, but only for a game
            // this player actually sat in - reviews show every hand at the
            // table and are scoped to your own games.
            gameId: game.game_id,
            canReview: !user?.isGuest && game.participants.some(
                p => !p.isBot && p.username === user?.username
            )
        };
        setSelectedGame(gameDialogData);
    };

    const createRoom = () => {
        if (isJoining) return;
        setIsJoining(true);
        console.log('createRoom called, socket connected:', socket.connected);
        socket.emit('join_room', { roomId: 'create', username: user.username, isGuest: user.isGuest });
    };

    const joinRoom = () => {
        if (!roomId || isJoining) return;
        setIsJoining(true);
        setSpectateOffer(null);
        socket.emit('join_room', { roomId: roomId.toUpperCase(), username: user.username, isGuest: user.isGuest });
    };

    // Watch a game we couldn't join. The server is the authority on whether we
    // actually end up spectating; this just carries the intent to GameRoom.
    const watchRoom = (targetRoomId) => {
        navigate(`/game/${targetRoomId}`, { state: { spectate: true } });
    };

    const joinInProgressRoom = (targetRoomId) => {
        if (isJoining) return;
        setIsJoining(true);
        socket.emit('join_room', { roomId: targetRoomId, username: user.username, isGuest: user.isGuest });
    };

    // Fetch joinable rooms on mount and periodically
    const fetchJoinableRooms = async () => {
        try {
            const baseUrl = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
            const response = await fetch(`${baseUrl}/api/rooms/joinable`);
            if (response.ok) {
                const rooms = await response.json();
                setJoinableRooms(rooms);
            }
        } catch (error) {
            console.error('Error fetching joinable rooms:', error);
        }
    };

    // Fetch recent games for activity snippet
    const fetchRecentGames = async () => {
        try {
            const baseUrl = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
            const response = await fetch(`${baseUrl}/api/activity?limit=4&status=completed`);
            if (response.ok) {
                const data = await response.json();
                setRecentGames(data.games || []);
            }
        } catch (error) {
            console.error('Error fetching recent games:', error);
        }
    };

    // Attempt to reconnect to an existing game on mount
    const attemptReconnect = () => {
        if (socket.connected && user?.username) {
            console.log('Attempting to reconnect to existing game...');
            setReconnecting(true);
            // Use a dummy room ID to trigger reconnection check
            socket.emit('join_room', { roomId: 'reconnect', username: user.username, isGuest: user.isGuest });
            // Clear reconnecting state after a short delay if no reconnection happens
            setTimeout(() => setReconnecting(false), 2000);
        }
    };

    useEffect(() => {
        console.log('Setting up socket listeners, socket connected:', socket.connected);

        const onConnect = () => {
            console.log('Socket connected');
            setConnected(true);
            // Try to reconnect when socket connects
            attemptReconnect();
        };

        const onDisconnect = () => {
            console.log('Socket disconnected');
            setConnected(false);
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        socket.on('joined_room', ({ roomId, playerId }) => {
            console.log('joined_room received:', roomId, playerId);
            setReconnecting(false);
            navigate(`/game/${roomId}`);
        });

        // Handle reconnection to existing game
        socket.on('reconnected', ({ roomId }) => {
            console.log('Reconnected to existing game:', roomId);
            setReconnecting(false);
            navigate(`/game/${roomId}`);
        });

        socket.on('error', (err) => {
            console.log('error received:', err);
            // Only show error if it's not "Room not found" during reconnect attempt
            setReconnecting(prev => {
                if (err !== 'Room not found' || !prev) {
                    setError(err);
                }
                return false;
            });
            setIsJoining(false);
        });

        // A full room is a dead end for joining, but it's the ideal room to watch.
        socket.on('join_failed', ({ roomId: failedRoomId, canSpectate }) => {
            setSpectateOffer(canSpectate ? failedRoomId : null);
        });

        // Attempt reconnection on mount if already connected. This drives an
        // external system (the socket) — the setState inside is a legitimate
        // sync from that external source.
        if (socket.connected) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            attemptReconnect();
        }

        // Fetch joinable rooms initially and every 5 seconds
        fetchJoinableRooms();
        const interval = setInterval(fetchJoinableRooms, 5000);

        // Fetch recent games
        fetchRecentGames();

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('joined_room');
            socket.off('reconnected');
            socket.off('error');
            socket.off('join_failed');
            clearInterval(interval);
        };
    }, [socket, navigate, user?.username]);

    // Room Lobby View - when returning from a game
    if (roomLobbyData) {
        const isHost = user.username === roomLobbyData.hostUsername;
        const players = roomLobbyData.players || [];

        return (
            <WaitingRoomV2
                roomId={roomLobbyData.roomId}
                players={players}
                myPlayerId={players.find(p => p.name === user.username)?.id}
                isHost={isHost}
                hostUsername={roomLobbyData.hostUsername}
                gameMode={selectedGameMode}
                fourColorMode={fourColorMode}
                onSetGameMode={handleGameModeChange}
                onToggleFourColor={toggleFourColorMode}
                onStartGame={handleStartGameFromLobby}
                onLeave={handleLeaveRoomLobby}
                voice={{
                    enabled: !!voiceContext?.voiceEnabled,
                    connected: !!voiceContext?.isVoiceConnected,
                    isMuted: !!voiceContext?.isMuted,
                    isDeafened: !!voiceContext?.isDeafened,
                    userCount: 0,
                    onJoin: handleVoiceToggle,
                    onToggleMute: () => voiceContext?.toggleMute(),
                    onToggleDeafen: () => voiceContext?.toggleDeafen(),
                }}
                onShareInvite={() => {
                    try { navigator.clipboard?.writeText(window.location.href); } catch { /* ignore */ }
                }}
            />
        );
    }

    // The home screen at every width; HomeScreenV2 handles the desktop split.
    return (
        <>
            <HomeScreenV2
                username={user.username}
                isGuest={user.isGuest}
                connected={connected}
                reconnecting={reconnecting}
                isJoining={isJoining}
                code={roomId}
                onCodeChange={setRoomId}
                onCreateRoom={createRoom}
                onJoinRoom={joinRoom}
                activeGames={joinableRooms}
                onJoinActiveGame={joinInProgressRoom}
                recentGames={recentGames}
                onGameClick={handleGameClick}
                nowTs={nowTs}
                onHowToPlay={() => setShowHowToPlay(true)}
                onLeaderboard={() => navigate('/leaderboard')}
                onActivity={() => navigate('/activity')}
                onStats={() => navigate('/stats')}
                onEditAvatar={() => navigate('/avatar')}
                onLogout={handleLogout}
                error={error}
                spectateOffer={spectateOffer}
                onWatchRoom={watchRoom}
            />
            <HowToPlay isOpen={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
            <ScoreDialog
                isOpen={!!selectedGame}
                onClose={() => setSelectedGame(null)}
                gameData={selectedGame}
                showActions={false}
                onReview={selectedGame?.canReview && selectedGame?.gameId
                    ? () => navigate(`/review/${selectedGame.gameId}`)
                    : null}
            />
        </>
    );
};

export default Lobby;
