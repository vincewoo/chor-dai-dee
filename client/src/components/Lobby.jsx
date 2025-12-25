import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logoImage from '../assets/chor-dai-dee-logo.png';
import HowToPlay from './HowToPlay';

const Lobby = ({ user, socket, setUser }) => {
    const [roomId, setRoomId] = useState('');
    const [error, setError] = useState('');
    const [reconnecting, setReconnecting] = useState(false);
    const [connected, setConnected] = useState(socket.connected);
    const [showHowToPlay, setShowHowToPlay] = useState(false);
    const navigate = useNavigate();

    const handleLogout = () => {
        setUser(null);
        navigate('/');
    };

    const createRoom = () => {
        console.log('createRoom called, socket connected:', socket.connected);
        socket.emit('join_room', { roomId: 'create', username: user.username });
    };

    const joinRoom = () => {
        if (!roomId) return;
        socket.emit('join_room', { roomId: roomId.toUpperCase(), username: user.username });
    };

    // Attempt to reconnect to an existing game on mount
    const attemptReconnect = () => {
        if (socket.connected && user?.username) {
            console.log('Attempting to reconnect to existing game...');
            setReconnecting(true);
            // Use a dummy room ID to trigger reconnection check
            socket.emit('join_room', { roomId: 'reconnect', username: user.username });
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

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('joined_room');
            socket.off('reconnected');
            socket.off('error');
        };
    }, [socket, navigate, user?.username]);

    return (
        <div className="flex flex-col items-center justify-between sm:justify-center min-h-screen bg-green-900 text-white p-6 sm:p-4">
            <img src={logoImage} alt="Chor Dai Dee Logo" className="w-64 sm:w-60 mt-8 sm:mt-0 mb-8 sm:mb-8" />
            <div className="bg-white text-gray-800 p-8 sm:p-8 rounded-xl shadow-2xl w-full sm:max-w-md text-center mb-8 sm:mb-0">
                <div className={`text-xs mb-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
                    {reconnecting ? '● Checking for existing game...' : connected ? '● Connected' : '● Disconnected - Is the server running?'}
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome, {user.username}!</h2>
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

                    <div className="flex space-x-2">
                        <input
                            type="text"
                            placeholder="Enter Room Code"
                            className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                            value={roomId}
                            onChange={e => setRoomId(e.target.value)}
                        />
                        <button onClick={joinRoom} className="bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700 transition">
                            Join
                        </button>
                    </div>
                </div>
                {error && <div className="mt-4 text-red-600 text-sm">{error}</div>}
            </div>

            <HowToPlay isOpen={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
        </div>
    );
};

export default Lobby;
