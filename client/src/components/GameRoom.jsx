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
        // Request current room state when component mounts
        socket.emit('get_room_state', { roomId });

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

        socket.on('game_over', (data) => {
            setWinner(data);
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

    // Top Player Area - cards horizontal on left, avatar on right
    const TopPlayerArea = ({ player }) => {
        if (!player) return null;
        const isTurn = gameState.currentTurn === player.id;

        return (
            <>
                {/* Player info and cards */}
                <div className={`absolute top-4 left-1/2 -translate-x-1/3 flex items-center gap-10 transition-all ${isTurn ? 'scale-105' : 'scale-100'}`}>
                    {/* Cards - horizontal */}
                    <div className="flex -space-x-9">
                        {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                            <div key={i} className="w-7 h-10 bg-blue-500 border border-white rounded shadow-sm"></div>
                        ))}
                    </div>
                    {/* Avatar */}
                    <div className="flex flex-col items-center shrink-0">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold border-4 shadow-lg
                            ${isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                            {player.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="text-white bg-black/50 px-2 py-0.5 rounded text-xs font-semibold shadow mt-1">{player.name}</div>
                        <div className="text-yellow-300 text-xs">{player.cardCount} Cards</div>
                    </div>
                </div>
                {/* Played cards or PASS - below player */}
                {player.lastPlayed && (
                    <div className="absolute top-28 left-1/2 -translate-x-1/2 flex -space-x-5">
                        {player.lastPlayed.type === 'pass' ? (
                            <motion.div
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-red-400 font-bold text-2xl bg-black/50 px-4 py-2 rounded-lg"
                            >
                                PASS
                            </motion.div>
                        ) : (
                            player.lastPlayed.cards?.map((card) => (
                                <motion.div
                                    key={`${card.rank}-${card.suit}`}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 0.65, opacity: 1 }}
                                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                                >
                                    <Card rank={card.rank} suit={card.suit} />
                                </motion.div>
                            ))
                        )}
                    </div>
                )}
            </>
        );
    };

    // Left Player Area - cards vertical (rotated 90°), avatar at bottom
    const LeftPlayerArea = ({ player }) => {
        if (!player) return null;
        const isTurn = gameState.currentTurn === player.id;

        return (
            <>
                {/* Player info and cards */}
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'}`}>
                    {/* Cards - vertical stack, each card rotated (wider than tall) */}
                    <div className="flex flex-col -space-y-6 mb-3">
                        {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                            <div key={i} className="w-10 h-7 bg-blue-500 border border-white rounded shadow-sm"></div>
                        ))}
                    </div>
                    {/* Avatar */}
                    <div className="flex flex-col items-center">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold border-4 shadow-lg
                            ${isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                            {player.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="text-white bg-black/50 px-2 py-0.5 rounded text-xs font-semibold shadow mt-1">{player.name}</div>
                        <div className="text-yellow-300 text-xs">{player.cardCount} Cards</div>
                    </div>
                </div>
                {/* Played cards or PASS - to the right of player */}
                {player.lastPlayed && (
                    <div className="absolute left-24 top-1/2 -translate-y-1/2 flex -space-x-5">
                        {player.lastPlayed.type === 'pass' ? (
                            <motion.div
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-red-400 font-bold text-2xl bg-black/50 px-4 py-2 rounded-lg"
                            >
                                PASS
                            </motion.div>
                        ) : (
                            player.lastPlayed.cards?.map((card) => (
                                <motion.div
                                    key={`${card.rank}-${card.suit}`}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 0.65, opacity: 1 }}
                                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                                >
                                    <Card rank={card.rank} suit={card.suit} />
                                </motion.div>
                            ))
                        )}
                    </div>
                )}
            </>
        );
    };

    // Right Player Area - cards vertical (rotated 90°), avatar at top
    const RightPlayerArea = ({ player }) => {
        if (!player) return null;
        const isTurn = gameState.currentTurn === player.id;

        return (
            <>
                {/* Player info and cards */}
                <div className={`absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'}`}>
                    {/* Avatar */}
                    <div className="flex flex-col items-center mb-3">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold border-4 shadow-lg
                            ${isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                            {player.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="text-white bg-black/50 px-2 py-0.5 rounded text-xs font-semibold shadow mt-1">{player.name}</div>
                        <div className="text-yellow-300 text-xs">{player.cardCount} Cards</div>
                    </div>
                    {/* Cards - vertical stack, each card rotated (wider than tall) */}
                    <div className="flex flex-col -space-y-6">
                        {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                            <div key={i} className="w-10 h-7 bg-blue-500 border border-white rounded shadow-sm"></div>
                        ))}
                    </div>
                </div>
                {/* Played cards or PASS - to the left of player */}
                {player.lastPlayed && (
                    <div className="absolute right-24 top-1/2 -translate-y-1/2 flex -space-x-5">
                        {player.lastPlayed.type === 'pass' ? (
                            <motion.div
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-red-400 font-bold text-2xl bg-black/50 px-4 py-2 rounded-lg"
                            >
                                PASS
                            </motion.div>
                        ) : (
                            player.lastPlayed.cards?.map((card) => (
                                <motion.div
                                    key={`${card.rank}-${card.suit}`}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 0.65, opacity: 1 }}
                                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                                >
                                    <Card rank={card.rank} suit={card.suit} />
                                </motion.div>
                            ))
                        )}
                    </div>
                )}
            </>
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
                <div className="absolute inset-0 z-40 bg-green-800 flex flex-col items-center justify-center text-white">
                    <div className="text-sm text-green-300 mb-2">Room Code</div>
                    <h1 className="text-5xl font-bold mb-8 tracking-widest">{roomId}</h1>
                    <h2 className="text-2xl mb-6">Waiting for Players...</h2>
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
                    <button onClick={startGame} className="bg-yellow-500 text-black px-8 py-3 rounded-full font-bold text-xl hover:bg-yellow-400 shadow-lg transform transition hover:scale-105 mb-4">
                        Start Game (Fill with Bots)
                    </button>
                    <button onClick={leaveRoom} className="text-green-300 hover:text-white underline text-sm">
                        Leave Room
                    </button>
                </div>
            )}

            {/* Game Table Layout */}

            {/* Top Player (Offset 2) */}
            <TopPlayerArea player={getRelativePlayer(2)} />

            {/* Left Player (Offset 3) */}
            <LeftPlayerArea player={getRelativePlayer(3)} />

            {/* Right Player (Offset 1) */}
            <RightPlayerArea player={getRelativePlayer(1)} />

            {/* Center: Table indicator */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                 {!gameState.lastPlayedHand && (
                     <div className="text-white/30 font-bold text-lg border-2 border-dashed border-white/30 px-6 py-3 rounded-lg">
                         Free Play
                     </div>
                 )}
            </div>

            {/* Bottom player's played cards or PASS */}
            {getRelativePlayer(0)?.lastPlayed && (
                <div className="absolute bottom-44 left-1/2 -translate-x-1/2 flex -space-x-5">
                    {getRelativePlayer(0).lastPlayed.type === 'pass' ? (
                        <motion.div
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-red-400 font-bold text-2xl bg-black/50 px-4 py-2 rounded-lg"
                        >
                            PASS
                        </motion.div>
                    ) : (
                        getRelativePlayer(0).lastPlayed.cards?.map((card) => (
                            <motion.div
                                key={`${card.rank}-${card.suit}`}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 0.65, opacity: 1 }}
                                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                            >
                                <Card rank={card.rank} suit={card.suit} />
                            </motion.div>
                        ))
                    )}
                </div>
            )}

            {/* Bottom: My Hand & Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-4">
                {/* Left side: Controls and Cards stacked */}
                <div className="flex flex-col items-center">
                    {/* Controls */}
                    <div className="flex space-x-4 mb-3">
                        <button
                            onClick={playCards}
                            disabled={!isMyTurn || selectedCards.length === 0}
                            className={`px-6 py-2 rounded-full font-bold shadow-lg transition transform
                                ${isMyTurn && selectedCards.length > 0 ? 'bg-yellow-500 text-black hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Play
                        </button>
                        <button
                            onClick={passTurn}
                            disabled={!isMyTurn || !gameState.lastPlayedHand}
                            className={`px-6 py-2 rounded-full font-bold shadow-lg transition transform
                                ${isMyTurn && gameState.lastPlayedHand ? 'bg-yellow-600 text-white hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Pass
                        </button>
                    </div>

                    {/* My Hand */}
                    <div className="flex justify-center -space-x-6 hover:space-x-1 transition-all duration-300">
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

                {/* Right side: Avatar */}
                <div className="flex flex-col items-center mb-2">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold border-4 shadow-lg
                        ${isMyTurn ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse' : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                        {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
                    </div>
                    <div className="text-white bg-black/50 px-2 py-0.5 rounded text-xs font-semibold shadow mt-1">{user?.username || 'You'}</div>
                    <div className="text-yellow-300 text-xs">{myHand.length} Cards</div>
                </div>
            </div>
        </div>
    );
};

export default GameRoom;
