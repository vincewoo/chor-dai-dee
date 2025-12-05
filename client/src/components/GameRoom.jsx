import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from './Card';
import { AnimatePresence, motion } from 'framer-motion';

const GameRoom = ({ user, socket }) => {
    const { roomId } = useParams();
    const navigate = useNavigate();

    const [gameState, setGameState] = useState(null);
    const [myHand, setMyHand] = useState([]);
    const [selectedCards, setSelectedCards] = useState([]);
    const [error, setError] = useState('');
    const [winner, setWinner] = useState(null);

    useEffect(() => {
        if (!gameState) {
            // Re-join if refresh? For now assume flow from Lobby
        }

        socket.on('room_update', (state) => {
            setGameState(state);
        });

        socket.on('game_started', (state) => {
            setGameState(state);
            setWinner(null);
        });

        socket.on('hand_update', (hand) => {
            setMyHand(hand);
            setSelectedCards([]);
        });

        socket.on('game_update', (state) => {
            setGameState(state);
        });

        socket.on('game_over', ({ winner }) => {
            setWinner(winner);
        });

        socket.on('error', (err) => {
            setError(err);
            setTimeout(() => setError(''), 3000);
        });

        return () => {
            socket.off('room_update');
            socket.off('game_started');
            socket.off('hand_update');
            socket.off('game_update');
            socket.off('game_over');
            socket.off('error');
        };
    }, [socket]);

    const startGame = () => {
        socket.emit('start_game', { roomId });
    };

    const toggleCard = (card) => {
        const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
        if (isSelected) {
            setSelectedCards(selectedCards.filter(c => !(c.rank === card.rank && c.suit === card.suit)));
        } else {
            setSelectedCards([...selectedCards, card]);
        }
    };

    const playCards = () => {
        if (selectedCards.length === 0) return;
        socket.emit('play_card', { roomId, cards: selectedCards });
    };

    const passTurn = () => {
        socket.emit('pass_turn', { roomId });
    };

    const leaveRoom = () => {
        navigate('/lobby');
        // socket emit leave?
    };

    if (!gameState) return <div className="text-white text-center mt-20">Loading...</div>;

    const myIndex = gameState.players.findIndex(p => p.id === socket.id);
    const isMyTurn = gameState.currentTurn === socket.id;

    // Helper to get relative player positions (Bottom=0, Right=1, Top=2, Left=3)
    const getRelativePlayer = (offset) => {
        if (myIndex === -1) return gameState.players[offset]; // Spectator view
        const idx = (myIndex + offset) % 4;
        return gameState.players[idx];
    };

    const PlayerArea = ({ player, position }) => {
        if (!player) return <div className={`absolute ${position} text-white opacity-50`}>Empty Slot</div>;

        const isTurn = gameState.currentTurn === player.id;

        return (
            <div className={`absolute ${position} flex flex-col items-center transition-all ${isTurn ? 'scale-110' : 'scale-100'}`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-4 mb-2 shadow-lg
                    ${isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                    {player.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="text-white bg-black/50 px-2 py-1 rounded text-sm font-semibold shadow">{player.name}</div>
                <div className="text-yellow-300 text-xs mt-1">{player.cardCount} Cards</div>

                {/* Visual Cards Back */}
                <div className="flex mt-2 -space-x-12">
                     {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                         <div key={i} className="w-8 h-12 bg-blue-700 border border-white rounded shadow-sm"></div>
                     ))}
                </div>
            </div>
        );
    };

    return (
        <div className="h-screen w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            {/* Top Bar */}
            <div className="absolute top-4 left-4 text-white z-10">
                <h1 className="text-2xl font-bold drop-shadow-md">Room: {roomId}</h1>
                <button onClick={leaveRoom} className="text-xs underline text-gray-300 hover:text-white">Leave</button>
            </div>

            {/* Error Toast */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute top-10 bg-red-600 text-white px-6 py-2 rounded shadow-xl z-50 font-bold"
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Winner Modal */}
            {winner && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center text-white p-8">
                    <h2 className="text-6xl font-bold text-yellow-400 mb-4 animate-bounce">Game Over!</h2>
                    <div className="text-2xl mb-2 text-green-300">Winner: {winner.winner.name}</div>

                    <div className="bg-white/10 rounded-lg p-6 mb-8 w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4 border-b pb-2">Scoreboard</h3>
                        {winner.scores && winner.scores.map(s => (
                            <div key={s.name} className="flex justify-between mb-2">
                                <span>{s.name} {s.isBot ? '(Bot)' : ''}</span>
                                <span className={s.points >= 0 ? 'text-green-400' : 'text-red-400'}>
                                    {s.points >= 0 ? `+${s.points}` : s.points}
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
                <div className="absolute inset-0 z-40 bg-black/40 flex flex-col items-center justify-center text-white">
                    <h2 className="text-4xl font-bold mb-4">Waiting for Players...</h2>
                    <div className="flex gap-4 mb-8">
                        {gameState.players.map(p => (
                            <div key={p.id} className="bg-white text-black p-4 rounded shadow-lg min-w-[100px] text-center font-bold">
                                {p.name}
                            </div>
                        ))}
                        {Array.from({ length: 4 - gameState.players.length }).map((_, i) => (
                            <div key={i} className="bg-white/20 p-4 rounded border-2 border-dashed border-white min-w-[100px] text-center">Empty</div>
                        ))}
                    </div>
                    {/* Only host (first player?) or anyone can start if enough players. Let's allow anyone for MVP */}
                    <button onClick={startGame} className="bg-yellow-500 text-black px-8 py-3 rounded-full font-bold text-xl hover:bg-yellow-400 shadow-lg transform transition hover:scale-105">
                        Start Game (Fill with Bots)
                    </button>
                </div>
            )}

            {/* Game Table Layout */}

            {/* Top Player (Offset 2) */}
            <PlayerArea player={getRelativePlayer(2)} position="top-8" />

            {/* Left Player (Offset 3) */}
            <PlayerArea player={getRelativePlayer(3)} position="left-8 top-1/2 -translate-y-1/2" />

            {/* Right Player (Offset 1) */}
            <PlayerArea player={getRelativePlayer(1)} position="right-8 top-1/2 -translate-y-1/2" />

            {/* Center: Played Cards */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-40 flex items-center justify-center">
                 {gameState.lastPlayedHand ? (
                     <div className="flex -space-x-8">
                         {gameState.lastPlayedHand.cards?.map((card, i) => (
                             <motion.div
                                key={`${card.rank}-${card.suit}`}
                                initial={{ y: -50, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                             >
                                 <Card rank={card.rank} suit={card.suit} />
                             </motion.div>
                         ))}
                     </div>
                 ) : (
                     <div className="text-white/30 font-bold text-2xl border-2 border-dashed border-white/30 p-4 rounded-lg">
                         Play Area
                     </div>
                 )}
            </div>

            {/* Bottom: My Hand & Controls */}
            <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center">
                {/* Controls */}
                <div className="flex space-x-4 mb-4">
                    <button
                        onClick={playCards}
                        disabled={!isMyTurn || selectedCards.length === 0}
                        className={`px-8 py-2 rounded-full font-bold shadow-lg transition transform
                            ${isMyTurn && selectedCards.length > 0 ? 'bg-yellow-500 text-black hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                    >
                        Play Selected
                    </button>
                    <button
                        onClick={passTurn}
                        disabled={!isMyTurn || !gameState.lastPlayedHand}
                        className={`px-8 py-2 rounded-full font-bold shadow-lg transition transform
                            ${isMyTurn && gameState.lastPlayedHand ? 'bg-red-500 text-white hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                    >
                        Pass
                    </button>
                </div>

                {/* My Hand */}
                <div className="flex justify-center -space-x-6 hover:space-x-1 transition-all duration-300 px-4">
                    {myHand.map((card, index) => {
                         const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                         return (
                            <Card
                                key={`${card.rank}-${card.suit}`}
                                rank={card.rank}
                                suit={card.suit}
                                selected={isSelected}
                                onClick={() => toggleCard(card)}
                                index={index}
                            />
                         );
                    })}
                </div>
            </div>
        </div>
    );
};

export default GameRoom;
