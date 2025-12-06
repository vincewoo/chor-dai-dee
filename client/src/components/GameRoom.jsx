import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from './Card';
import { AnimatePresence, motion } from 'framer-motion';

// Helper to create a stable key for a played hand (only changes when cards change)
const getPlayedHandKey = (lastPlayed) => {
    if (!lastPlayed) return null;
    if (lastPlayed.type === 'pass') return 'pass';
    return lastPlayed.cards?.map(c => `${c.rank}-${c.suit}`).join(',') || null;
};

// Played cards display component - extracted to prevent re-renders
const PlayedCards = ({ lastPlayed, position }) => {
    const positionClasses = {
        top: "absolute top-28 left-1/2 -translate-x-1/2 flex -space-x-5",
        left: "absolute left-24 top-1/2 -translate-y-1/2 flex -space-x-5",
        right: "absolute right-24 top-1/2 -translate-y-1/2 flex -space-x-5",
        bottom: "absolute bottom-44 left-1/2 -translate-x-1/2 flex -space-x-5"
    };

    return (
        <AnimatePresence mode="wait">
            {lastPlayed && (
                <motion.div
                    key={getPlayedHandKey(lastPlayed)}
                    className={positionClasses[position]}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                    {lastPlayed.type === 'pass' ? (
                        <div className="text-red-400 font-bold text-2xl bg-black/50 px-4 py-2 rounded-lg">
                            PASS
                        </div>
                    ) : (
                        lastPlayed.cards?.map((card) => (
                            <div key={`${card.rank}-${card.suit}`} className="scale-[0.65]">
                                <Card rank={card.rank} suit={card.suit} />
                            </div>
                        ))
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Top Player Area - cards horizontal on left, avatar on right
const TopPlayerArea = ({ player, isTurn }) => {
    if (!player) return null;

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
            <PlayedCards lastPlayed={player.lastPlayed} position="top" />
        </>
    );
};

// Left Player Area - cards vertical (rotated 90°), avatar at bottom
const LeftPlayerArea = ({ player, isTurn }) => {
    if (!player) return null;

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
            <PlayedCards lastPlayed={player.lastPlayed} position="left" />
        </>
    );
};

// Right Player Area - cards vertical (rotated 90°), avatar at top
const RightPlayerArea = ({ player, isTurn }) => {
    if (!player) return null;

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
            <PlayedCards lastPlayed={player.lastPlayed} position="right" />
        </>
    );
};

const GameRoom = ({ user, socket }) => {
    const { roomId } = useParams();
    const navigate = useNavigate();

    const [gameState, setGameState] = useState(null);
    const [myHand, setMyHand] = useState([]);
    const [selectedCards, setSelectedCards] = useState([]);
    const [error, setError] = useState('');
    const [roundResult, setRoundResult] = useState(null);
    const [gameOver, setGameOver] = useState(null);

    useEffect(() => {
        // Request current room state when component mounts
        socket.emit('get_room_state', { roomId });

        socket.on('room_update', (state) => {
            setGameState(state);
        });

        socket.on('game_started', (state) => {
            setGameState(state);
            setRoundResult(null);
            setGameOver(null);
        });

        socket.on('hand_update', (hand) => {
            setMyHand(hand);
            setSelectedCards([]);
        });

        socket.on('game_update', (state) => {
            setGameState(state);
        });

        socket.on('round_over', (data) => {
            setRoundResult(data);
        });

        socket.on('game_over', (data) => {
            setGameOver(data);
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
            socket.off('round_over');
            socket.off('game_over');
            socket.off('error');
        };
    }, [socket]);

    const startGame = () => {
        socket.emit('start_game', { roomId });
    };

    const nextRound = () => {
        setRoundResult(null);
        socket.emit('next_round', { roomId });
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

    return (
        <div className="h-screen w-screen bg-green-800 relative overflow-hidden flex items-center justify-center font-sans">
            {/* Top Bar */}
            <div className="absolute top-4 left-4 text-white z-10">
                <h1 className="text-2xl font-bold drop-shadow-md">Room: {roomId}</h1>
                {gameState.roundNumber > 0 && (
                    <div className="text-sm text-yellow-300">Round {gameState.roundNumber}</div>
                )}
                <button onClick={leaveRoom} className="text-xs underline text-gray-300 hover:text-white">Leave</button>
            </div>

            {/* Scoreboard */}
            {gameState.gameState === 'playing' && gameState.roundNumber > 0 && (
                <div className="absolute top-4 right-4 bg-black/60 rounded-lg p-3 text-white text-sm z-10">
                    <div className="font-bold mb-2 text-yellow-400">Scores</div>
                    {gameState.players
                        .slice()
                        .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
                        .map(p => (
                        <div key={p.id} className="flex justify-between gap-4">
                            <span className={p.id === socket.id ? 'text-yellow-300' : ''}>{p.name}</span>
                            <span className={p.cumulativeScore >= 80 ? 'text-red-400' : p.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-green-400'}>
                                {p.cumulativeScore}
                            </span>
                        </div>
                    ))}
                    <div className="text-xs text-gray-400 mt-2 border-t border-white/20 pt-1">First to 100 loses</div>
                </div>
            )}

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
                    <h2 className="text-6xl font-bold text-yellow-400 mb-4 animate-bounce">Game Over!</h2>
                    <div className="text-2xl mb-2 text-green-300">Winner: {gameOver.winner.name}</div>
                    <div className="text-lg mb-4 text-gray-400">Completed in {gameOver.roundNumber} rounds</div>

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
            <TopPlayerArea player={getRelativePlayer(2)} isTurn={gameState.currentTurn === getRelativePlayer(2)?.id} />

            {/* Left Player (Offset 3) */}
            <LeftPlayerArea player={getRelativePlayer(3)} isTurn={gameState.currentTurn === getRelativePlayer(3)?.id} />

            {/* Right Player (Offset 1) */}
            <RightPlayerArea player={getRelativePlayer(1)} isTurn={gameState.currentTurn === getRelativePlayer(1)?.id} />

            {/* Center: Current hand to beat */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center">
                {/* Turn indicator */}
                {gameState.gameState === 'playing' && (
                    <div className={`mb-4 px-4 py-2 rounded-full font-bold text-lg shadow-lg ${
                        isMyTurn
                            ? 'bg-yellow-500 text-black animate-pulse'
                            : 'bg-black/60 text-white'
                    }`}>
                        {isMyTurn ? "Your Turn!" : `${gameState.players.find(p => p.id === gameState.currentTurn)?.name}'s Turn`}
                    </div>
                )}

                {/* Hand to beat */}
                <AnimatePresence mode="wait">
                    {gameState.lastPlayedHand ? (
                        <motion.div
                            key={getPlayedHandKey(gameState.lastPlayedHand)}
                            className="flex flex-col items-center"
                            initial={{ scale: 0.5, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{ type: "spring", stiffness: 200, damping: 15 }}
                        >
                            <div className="text-white/70 text-sm mb-2 font-semibold">Hand to Beat</div>
                            <div className="flex -space-x-4 bg-black/30 px-4 py-3 rounded-xl">
                                {gameState.lastPlayedHand.cards.map((card) => (
                                    <div key={`center-${card.rank}-${card.suit}`}>
                                        <Card rank={card.rank} suit={card.suit} />
                                    </div>
                                ))}
                            </div>
                            <div className="text-white/50 text-xs mt-2">
                                {gameState.lastPlayedHand.type.replace(/_/g, ' ').toUpperCase()}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="free-play"
                            className="text-white/30 font-bold text-lg border-2 border-dashed border-white/30 px-6 py-3 rounded-lg"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        >
                            Free Play
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bottom player's played cards or PASS */}
            <PlayedCards lastPlayed={getRelativePlayer(0)?.lastPlayed} position="bottom" />

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
