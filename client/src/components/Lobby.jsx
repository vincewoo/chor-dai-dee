import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Lobby = ({ user, socket }) => {
    const [roomId, setRoomId] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const createRoom = () => {
        socket.emit('join_room', { roomId: 'create', username: user.username });
    };

    const joinRoom = () => {
        if (!roomId) return;
        socket.emit('join_room', { roomId: roomId.toUpperCase(), username: user.username });
    };

    React.useEffect(() => {
        socket.on('joined_room', ({ roomId, playerId }) => {
            navigate(`/game/${roomId}`);
        });

        socket.on('error', (err) => {
            setError(err);
        });

        return () => {
            socket.off('joined_room');
            socket.off('error');
        };
    }, [socket, navigate]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white">
            <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl w-96 text-center">
                <h2 className="text-2xl font-bold mb-6">Welcome, {user.username}!</h2>

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
