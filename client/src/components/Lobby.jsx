import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Lobby = ({ user, socket, setUser }) => {
    const [roomId, setRoomId] = useState('');
    const [error, setError] = useState('');
    const [connected, setConnected] = useState(socket.connected);
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

    useEffect(() => {
        console.log('Setting up socket listeners, socket connected:', socket.connected);

        const onConnect = () => {
            console.log('Socket connected');
            setConnected(true);
        };

        const onDisconnect = () => {
            console.log('Socket disconnected');
            setConnected(false);
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        socket.on('joined_room', ({ roomId, playerId }) => {
            console.log('joined_room received:', roomId, playerId);
            navigate(`/game/${roomId}`);
        });

        socket.on('error', (err) => {
            console.log('error received:', err);
            setError(err);
        });

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('joined_room');
            socket.off('error');
        };
    }, [socket, navigate]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white">
            <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl w-96 text-center">
                <div className={`text-xs mb-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
                    {connected ? '● Connected' : '● Disconnected - Is the server running?'}
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome, {user.username}!</h2>
                <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700 underline mb-4">
                    Logout
                </button>

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
        </div>
    );
};

export default Lobby;
