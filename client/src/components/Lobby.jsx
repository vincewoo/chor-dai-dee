import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import logoImage from '../assets/chor-dai-dee-logo.png';
import HowToPlay from './HowToPlay';
import ScoreDialog from './ScoreDialog';
import { useVoice } from '../contexts/VoiceContext';
import { GAME_MODES } from '../constants/gameModes';

const Lobby = ({ user, socket, setUser }) => {
    const [roomId, setRoomId] = useState('');
    const [error, setError] = useState('');
    const [reconnecting, setReconnecting] = useState(false);
    const [connected, setConnected] = useState(socket.connected);
    const [showHowToPlay, setShowHowToPlay] = useState(false);
    const [joinableRooms, setJoinableRooms] = useState([]);
    const [recentGames, setRecentGames] = useState([]);
    const [selectedGame, setSelectedGame] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();
    const voiceContext = useVoice();

    // Room lobby state (when returning from a game)
    const [roomLobbyData, setRoomLobbyData] = useState(null);
    // { roomId, players, hostUsername, gameMode }
    const [selectedGameMode, setSelectedGameMode] = useState('standard');

    // Check if we're returning from a game to room lobby
    useEffect(() => {
        if (location.state?.isRoomLobby && location.state?.roomId) {
            console.log('Returning to room lobby:', location.state);
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

        const handleGameStarted = (state) => {
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
            isDragonWin: false // We could detect this from events if needed
        };
        setSelectedGame(gameDialogData);
    };

    const createRoom = () => {
        console.log('createRoom called, socket connected:', socket.connected);
        socket.emit('join_room', { roomId: 'create', username: user.username, isGuest: user.isGuest });
    };

    const joinRoom = () => {
        if (!roomId) return;
        socket.emit('join_room', { roomId: roomId.toUpperCase(), username: user.username, isGuest: user.isGuest });
    };

    const joinInProgressRoom = (targetRoomId) => {
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
        socket.on('reconnected', ({ roomId, playerId, gameState }) => {
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
        });

        // Attempt reconnection on mount if already connected
        if (socket.connected) {
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
            clearInterval(interval);
        };
    }, [socket, navigate, user?.username]);

    // Room Lobby View - when returning from a game
    if (roomLobbyData) {
        const isHost = user.username === roomLobbyData.hostUsername;
        const players = roomLobbyData.players || [];

        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-green-800 text-white p-6 sm:p-4">
                <img src={logoImage} alt="Chor Dai Dee Logo" className="w-48 sm:w-40 mb-6" />
                <div className="bg-white text-gray-800 p-8 sm:p-6 rounded-xl shadow-2xl w-full sm:max-w-lg text-center">
                    <div className={`text-xs mb-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
                        {connected ? '● Connected' : '● Disconnected'}
                    </div>

                    <h2 className="text-2xl font-bold mb-2">Room Lobby</h2>
                    <div className="text-3xl font-mono font-bold text-green-600 mb-4 tracking-widest">
                        {roomLobbyData.roomId}
                    </div>

                    {/* Players List */}
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-3">Players ({players.length}/4)</h3>
                        <div className="flex flex-wrap justify-center gap-2">
                            {players.map(p => (
                                <div
                                    key={p.id || p.name}
                                    className={`px-4 py-2 rounded-lg ${
                                        p.name === roomLobbyData.hostUsername
                                            ? 'bg-yellow-100 border-2 border-yellow-400'
                                            : 'bg-gray-100'
                                    }`}
                                >
                                    {p.name === roomLobbyData.hostUsername && '👑 '}
                                    {p.name}
                                    {p.name === user.username && ' (You)'}
                                </div>
                            ))}
                            {Array.from({ length: 4 - players.length }).map((_, i) => (
                                <div key={`empty-${i}`} className="px-4 py-2 rounded-lg bg-gray-50 text-gray-400 border-2 border-dashed border-gray-300">
                                    Empty
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Game Mode Selector - Host only */}
                    {isHost && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold mb-2 text-gray-600">Game Mode</h3>
                            <div className="flex gap-2 justify-center">
                                {Object.values(GAME_MODES).map(mode => (
                                    <button
                                        key={mode.id}
                                        onClick={() => handleGameModeChange(mode.id)}
                                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                                            selectedGameMode === mode.id
                                                ? 'bg-green-600 text-white'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        {mode.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Voice Chat Toggle */}
                    <div className="mb-6">
                        <button
                            onClick={handleVoiceToggle}
                            className={`px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2 mx-auto ${
                                voiceContext.voiceEnabled
                                    ? voiceContext.isVoiceConnected
                                        ? 'bg-green-600 text-white'
                                        : 'bg-yellow-500 text-white'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d={voiceContext.voiceEnabled
                                        ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                                        : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                                    }
                                />
                            </svg>
                            {voiceContext.voiceEnabled
                                ? voiceContext.isVoiceConnected ? 'Voice On' : 'Connecting...'
                                : 'Join Voice'
                            }
                        </button>
                        {voiceContext.voiceEnabled && voiceContext.isVoiceConnected && (
                            <div className="flex gap-2 justify-center mt-2">
                                <button
                                    onClick={voiceContext.toggleMute}
                                    className={`p-2 rounded-lg transition ${
                                        voiceContext.isMuted ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700'
                                    }`}
                                    title={voiceContext.isMuted ? 'Unmute' : 'Mute'}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        {voiceContext.isMuted ? (
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2 2m0-2l-2 2" />
                                        ) : (
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                        )}
                                    </svg>
                                </button>
                                <button
                                    onClick={voiceContext.toggleDeafen}
                                    className={`p-2 rounded-lg transition ${
                                        voiceContext.isDeafened ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700'
                                    }`}
                                    title={voiceContext.isDeafened ? 'Undeafen' : 'Deafen'}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        {voiceContext.isDeafened ? (
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                        ) : (
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        )}
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 justify-center">
                        {isHost ? (
                            <button
                                onClick={handleStartGameFromLobby}
                                className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition"
                            >
                                Start Game
                            </button>
                        ) : (
                            <div className="text-gray-500 py-3">
                                Waiting for host to start...
                            </div>
                        )}
                        <button
                            onClick={handleLeaveRoomLobby}
                            className="bg-red-500 text-white px-6 py-3 rounded-lg font-bold hover:bg-red-600 transition"
                        >
                            Leave Room
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Main Lobby View
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-800 text-white p-6 sm:p-4">
            <img src={logoImage} alt="Chor Dai Dee Logo" className="w-64 sm:w-60 mb-8" />
            <div className="bg-white text-gray-800 p-8 sm:p-8 rounded-xl shadow-2xl w-full sm:max-w-md text-center">
                <div className={`text-xs mb-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
                    {reconnecting ? '● Checking for existing game...' : connected ? '● Connected' : '● Disconnected - Is the server running?'}
                </div>
                <div className="flex items-center justify-center gap-2 mb-2">
                    <h2 className="text-2xl font-bold">Welcome, {user.username}!</h2>
                    {user.isGuest && (
                        <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded">
                            Guest
                        </span>
                    )}
                </div>
                {user.isGuest && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                        <p className="text-sm text-blue-900 mb-2">
                            Playing as a guest? Your stats won't be saved.
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className="text-sm text-blue-600 hover:text-blue-800 font-semibold underline"
                        >
                            Create Account to Save Progress
                        </button>
                    </div>
                )}
                <div className="flex justify-center gap-4 mb-4 flex-wrap">
                    <button
                        onClick={() => setShowHowToPlay(true)}
                        className="text-sm text-green-600 hover:text-green-800 underline font-medium"
                    >
                        How to Play
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={() => navigate('/stats')}
                        className="text-sm text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                        View Stats
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={() => navigate('/leaderboard')}
                        className="text-sm text-purple-600 hover:text-purple-800 underline font-medium"
                    >
                        Leaderboard
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={() => navigate('/activity')}
                        className="text-sm text-green-600 hover:text-green-800 underline font-medium"
                    >
                        Activity Feed
                    </button>
                    <span className="text-gray-300">|</span>
                    <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700 underline">
                        Logout
                    </button>
                </div>

                <div className="space-y-4">
                    <button onClick={createRoom} className="w-full bg-yellow-500 text-white py-3 rounded-lg font-bold hover:bg-yellow-600 transition shadow-md">
                        Create New Room
                    </button>

                    <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-gray-300"></div>
                        <span className="flex-shrink mx-4 text-gray-400">OR</span>
                        <div className="flex-grow border-t border-gray-300"></div>
                    </div>

                    <div className="flex space-x-2 items-end">
                        <div className="flex-1 text-left">
                            <label htmlFor="room-code" className="block text-sm font-medium text-gray-700 mb-1">
                                Join Existing Room
                            </label>
                            <input
                                id="room-code"
                                type="text"
                                placeholder="Enter Room Code"
                                className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                                value={roomId}
                                onChange={e => setRoomId(e.target.value)}
                            />
                        </div>
                        <button onClick={joinRoom} className="bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700 transition h-[42px]">
                            Join
                        </button>
                    </div>

                    {joinableRooms.length > 0 && (
                        <>
                            <div className="relative flex py-2 items-center">
                                <div className="flex-grow border-t border-gray-300"></div>
                                <span className="flex-shrink mx-4 text-gray-400 text-sm">Join In-Progress Game</span>
                                <div className="flex-grow border-t border-gray-300"></div>
                            </div>

                            <div className="max-h-48 overflow-y-auto space-y-2">
                                {joinableRooms.map(room => (
                                    <div
                                        key={room.roomId}
                                        className="border border-gray-300 rounded p-3 hover:bg-gray-50 cursor-pointer transition"
                                        onClick={() => joinInProgressRoom(room.roomId)}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-bold text-green-600">{room.roomId}</span>
                                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                                {room.gameMode === 'short' ? 'Short' : 'Standard'}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-600">
                                            Round {room.roundNumber} • {room.botCount} bot{room.botCount !== 1 ? 's' : ''} available
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {room.players.filter(p => !p.isBot).map(p => p.name).join(', ')}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                {error && <div className="mt-4 text-red-600 text-sm">{error}</div>}

                {/* Recent Games Activity Snippet */}
                {recentGames.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-gray-300">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-gray-600">🔥 Recent Activity</h3>
                            <button
                                onClick={() => navigate('/activity')}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                                View All →
                            </button>
                        </div>
                        <div className="space-y-2">
                            {recentGames.slice(0, 3).map((game) => {
                                const winner = game.participants?.find(p => p.placement === 1);
                                const humanPlayers = game.participants?.filter(p => !p.isBot) || [];
                                const botCount = game.participants?.filter(p => p.isBot).length || 0;
                                const timeDiff = Date.now() - new Date(game.end_time);
                                const minutesAgo = Math.floor(timeDiff / 60000);
                                const hoursAgo = Math.floor(timeDiff / 3600000);
                                const timeStr = hoursAgo > 0 ? `${hoursAgo}h ago` : `${minutesAgo}m ago`;

                                return (
                                    <div
                                        key={game.game_id}
                                        className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition cursor-pointer"
                                        onClick={() => handleGameClick(game)}
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <div className="flex items-center gap-1">
                                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                                    game.game_mode === 'short'
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : 'bg-purple-100 text-purple-700'
                                                }`}>
                                                    {game.game_mode === 'short' ? '⚡ Short' : '🏆 Standard'}
                                                </span>
                                                <span className="text-xs text-gray-400">ended {timeStr}</span>
                                            </div>
                                            <span className="text-xs text-gray-500">{game.total_rounds} rounds</span>
                                        </div>
                                        <div className="text-sm">
                                            <div className="flex flex-wrap items-center">
                                                {game.participants?.sort((a, b) => a.placement - b.placement).map((p, idx) => (
                                                    <React.Fragment key={idx}>
                                                        {idx > 0 && <span className="text-gray-400 mr-1">, </span>}
                                                        <span className="inline-flex items-center">
                                                            {p.placement === 1 && <span className="mr-1">👑</span>}
                                                            <span className={
                                                                p.placement === 1 && !p.isBot
                                                                    ? "font-semibold text-green-700"
                                                                    : p.isBot
                                                                    ? "text-gray-400 italic"
                                                                    : "text-gray-700"
                                                            }>
                                                                {p.username}
                                                            </span>
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <HowToPlay isOpen={showHowToPlay} onClose={() => setShowHowToPlay(false)} />

            <ScoreDialog
                isOpen={!!selectedGame}
                onClose={() => setSelectedGame(null)}
                gameData={selectedGame}
                showActions={false}
            />
        </div>
    );
};

export default Lobby;
