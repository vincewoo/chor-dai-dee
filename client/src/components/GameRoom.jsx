import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from './Card';
import { AnimatePresence, motion } from 'framer-motion';
import { canBeatWithAnyHand } from '../utils/handChecker';
import HandHelper from './HandHelper';
import BotDebugPanel from './BotDebugPanel';

// Card sorting utilities
const SUITS_ORDER = ['D', 'C', 'H', 'S']; // Diamonds < Clubs < Hearts < Spades
const RANKS_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

const getCardValue = (card) => {
    const rankIndex = RANKS_ORDER.indexOf(card.rank);
    const suitIndex = SUITS_ORDER.indexOf(card.suit);
    return rankIndex * 4 + suitIndex;
};

const sortByRank = (cards) => {
    return [...cards].sort((a, b) => getCardValue(a) - getCardValue(b));
};

const sortBySuit = (cards) => {
    return [...cards].sort((a, b) => {
        const suitDiff = SUITS_ORDER.indexOf(a.suit) - SUITS_ORDER.indexOf(b.suit);
        if (suitDiff !== 0) return suitDiff;
        return RANKS_ORDER.indexOf(a.rank) - RANKS_ORDER.indexOf(b.rank);
    });
};

// Helper to create a stable key for a played hand (only changes when cards change)
const getPlayedHandKey = (lastPlayed) => {
    if (!lastPlayed) return null;
    if (lastPlayed.type === 'pass') return 'pass';
    return lastPlayed.cards?.map(c => `${c.rank}-${c.suit}`).join(',') || null;
};

// Played cards display component - extracted to prevent re-renders
const PlayedCards = ({ lastPlayed, position }) => {
    const positionClasses = {
        top: "absolute top-[14vh] left-1/2 -translate-x-1/2 flex",
        left: "absolute left-[8vw] top-1/2 -translate-y-1/2 flex",
        right: "absolute right-[8vw] top-1/2 -translate-y-1/2 flex",
        bottom: "absolute bottom-[22vh] left-1/2 -translate-x-1/2 flex"
    };

    return (
        <AnimatePresence mode="wait">
            {lastPlayed && (
                <motion.div
                    key={getPlayedHandKey(lastPlayed)}
                    className={positionClasses[position]}
                    style={{ gap: '-1vmax', marginLeft: '-1vmax' }}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                    {lastPlayed.type === 'pass' ? (
                        <div className="text-red-400 font-bold text-[1.5vmax] bg-black/50 px-[1vmax] py-[0.5vmax] rounded-lg">
                            PASS
                        </div>
                    ) : (
                        lastPlayed.cards?.map((card) => (
                            <div key={`${card.rank}-${card.suit}`} style={{ marginLeft: '-1.5vmax' }}>
                                <Card rank={card.rank} suit={card.suit} size="small" />
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

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute top-[2vh] left-1/2 -translate-x-1/3 flex items-center gap-[2vmax] transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Cards - horizontal */}
                <div className="flex" style={{ marginLeft: '-2vmax' }}>
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div key={i} className="w-[1.8vmax] h-[2.5vmax] bg-blue-500 border border-white rounded shadow-sm" style={{ marginLeft: '-1vmax' }}></div>
                    ))}
                </div>
                {/* Avatar */}
                <div className="flex flex-col items-center shrink-0 relative">
                    <div className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-[0.5vmax] -right-[0.5vmax] bg-red-500 text-white text-[0.6vmax] px-[0.3vmax] rounded">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <div className="text-yellow-300 text-[0.7vmax]">{player.cardCount} Cards</div>
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

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute left-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Cards - vertical stack, each card rotated (wider than tall) */}
                <div className="flex flex-col mb-[0.75vmax]" style={{ marginTop: '-1vmax' }}>
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div key={i} className="w-[2.5vmax] h-[1.8vmax] bg-blue-500 border border-white rounded shadow-sm" style={{ marginTop: '-0.8vmax' }}></div>
                    ))}
                </div>
                {/* Avatar */}
                <div className="flex flex-col items-center relative">
                    <div className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-[0.5vmax] -right-[0.5vmax] bg-red-500 text-white text-[0.6vmax] px-[0.3vmax] rounded">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <div className="text-yellow-300 text-[0.7vmax]">{player.cardCount} Cards</div>
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

    const isDisconnected = player.isDisconnected;

    return (
        <>
            {/* Player info and cards */}
            <div className={`absolute right-[1vw] top-1/2 -translate-y-1/2 flex flex-col items-center transition-all ${isTurn ? 'scale-105' : 'scale-100'} ${isDisconnected ? 'opacity-50' : ''}`}>
                {/* Avatar */}
                <div className="flex flex-col items-center mb-[0.75vmax] relative">
                    <div className={`w-[3.5vmax] h-[3.5vmax] rounded-full flex items-center justify-center text-[1vmax] font-bold border-4 shadow-lg
                        ${isDisconnected ? 'border-red-500 bg-gray-400 text-gray-600' : isTurn ? 'border-yellow-400 bg-yellow-100 text-black animate-pulse' : 'border-gray-500 bg-gray-200 text-gray-700'}`}>
                        {player.name.substring(0, 2).toUpperCase()}
                    </div>
                    {isDisconnected && (
                        <div className="absolute -top-[0.5vmax] -right-[0.5vmax] bg-red-500 text-white text-[0.6vmax] px-[0.3vmax] rounded">
                            DC
                        </div>
                    )}
                    <div className="text-white bg-black/50 px-[0.5vmax] py-[0.15vmax] rounded text-[0.8vmax] font-semibold shadow mt-[0.25vmax]">
                        {player.name} {player.rating !== undefined && <span className="text-yellow-200">({player.rating})</span>}
                    </div>
                    <div className="text-yellow-300 text-[0.7vmax]">{player.cardCount} Cards</div>
                </div>
                {/* Cards - vertical stack, each card rotated (wider than tall) */}
                <div className="flex flex-col" style={{ marginTop: '-1vmax' }}>
                    {Array.from({ length: Math.min(player.cardCount, 13) }).map((_, i) => (
                        <div key={i} className="w-[2.5vmax] h-[1.8vmax] bg-blue-500 border border-white rounded shadow-sm" style={{ marginTop: '-0.8vmax' }}></div>
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
    const [autoPass, setAutoPass] = useState(false);
    const autoPassTriggered = useRef(false);
    const [showDebugPanel, setShowDebugPanel] = useState(false);
    const [useAdvancedBots, setUseAdvancedBots] = useState(false);
    const [botReasoning, setBotReasoning] = useState(null);
    const [notification, setNotification] = useState(null);
    const [sortMode, setSortMode] = useState('rank'); // 'rank' or 'suit'

    // Sorted hand based on current sort mode
    const sortedHand = useMemo(() => {
        if (sortMode === 'suit') {
            return sortBySuit(myHand);
        }
        return sortByRank(myHand);
    }, [myHand, sortMode]);

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

        socket.on('bot_reasoning', (reasoning) => {
            setBotReasoning(reasoning);
        });

        socket.on('player_disconnected', ({ playerName }) => {
            setNotification({ type: 'warning', message: `${playerName} disconnected` });
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_reconnected', ({ playerName }) => {
            setNotification({ type: 'success', message: `${playerName} reconnected!` });
            setTimeout(() => setNotification(null), 3000);
        });

        return () => {
            socket.off('room_update');
            socket.off('game_started');
            socket.off('hand_update');
            socket.off('game_update');
            socket.off('round_over');
            socket.off('game_over');
            socket.off('error');
            socket.off('bot_reasoning');
            socket.off('player_disconnected');
            socket.off('player_reconnected');
        };
    }, [socket]);

    // Auto-pass effect: check if we should auto-pass when it becomes our turn
    useEffect(() => {
        if (!autoPass || !gameState || gameState.gameState !== 'playing') return;

        const isMyTurn = gameState.currentTurn === socket.id;
        const hasLastPlayedHand = !!gameState.lastPlayedHand;

        // Only auto-pass if it's our turn and there's a hand to beat
        if (isMyTurn && hasLastPlayedHand && !autoPassTriggered.current) {
            // Check if we can beat the hand
            const canBeat = canBeatWithAnyHand(myHand, gameState.lastPlayedHand);

            if (!canBeat) {
                // Small delay to give visual feedback before auto-passing
                autoPassTriggered.current = true;
                const timer = setTimeout(() => {
                    socket.emit('pass_turn', { roomId });
                    autoPassTriggered.current = false;
                }, 500);
                return () => clearTimeout(timer);
            }
        }

        // Reset triggered flag when it's no longer our turn
        if (!isMyTurn) {
            autoPassTriggered.current = false;
        }
    }, [autoPass, gameState, myHand, socket, roomId]);

    const startGame = () => {
        socket.emit('start_game', { roomId, useAdvancedBots });
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

    // Callback for HandHelper to set selected cards
    const handleSelectCards = useCallback((cards) => {
        setSelectedCards(cards);
    }, []);

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

    const toggleDebugMode = () => {
        const newState = !showDebugPanel;
        setShowDebugPanel(newState);
        socket.emit('toggle_debug', { roomId, enabled: newState });
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
            <div className="absolute top-[1vh] left-[1vw] text-white z-10">
                <h1 className="text-[1.5vmax] font-bold drop-shadow-md">Room: {roomId}</h1>
                {gameState.roundNumber > 0 && (
                    <div className="text-[0.9vmax] text-yellow-300">Round {gameState.roundNumber}</div>
                )}
                <div className="flex gap-2 mt-1">
                    <button onClick={leaveRoom} className="text-[0.7vmax] underline text-gray-300 hover:text-white">Leave</button>
                    <button
                        onClick={toggleDebugMode}
                        className={`text-[0.7vmax] px-2 py-0.5 rounded ${showDebugPanel ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        title="Show bot decision reasoning"
                    >
                        🤖 Debug {showDebugPanel ? 'ON' : 'OFF'}
                    </button>
                </div>
            </div>

            {/* Scoreboard */}
            {gameState.gameState === 'playing' && gameState.roundNumber > 0 && (
                <div className="absolute top-[1vh] right-[1vw] bg-black/60 rounded-lg p-[0.75vmax] text-white text-[0.9vmax] z-10">
                    <div className="font-bold mb-[0.5vmax] text-yellow-400">Scores</div>
                    {gameState.players
                        .slice()
                        .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
                        .map(p => (
                        <div key={p.id} className="flex justify-between gap-[1vmax]">
                            <span className={p.id === socket.id ? 'text-yellow-300' : ''}>{p.name}</span>
                            <span className={p.cumulativeScore >= 80 ? 'text-red-400' : p.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-green-400'}>
                                {p.cumulativeScore}
                            </span>
                        </div>
                    ))}
                    <div className="text-[0.7vmax] text-gray-400 mt-[0.5vmax] border-t border-white/20 pt-[0.25vmax]">First to 100 loses</div>
                </div>
            )}

            {/* Error Toast */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute top-[5vh] bg-red-600 text-white px-[1.5vmax] py-[0.5vmax] rounded shadow-xl z-50 font-bold text-[1vmax]"
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
                        className={`absolute top-[8vh] left-1/2 -translate-x-1/2 px-[1.5vmax] py-[0.5vmax] rounded shadow-xl z-50 font-bold text-[1vmax] ${
                            notification.type === 'warning' ? 'bg-yellow-600 text-white' : 'bg-green-600 text-white'
                        }`}
                    >
                        {notification.message}
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
                    <div className="text-[1vmax] text-green-300 mb-[0.5vmax]">Room Code</div>
                    <h1 className="text-[3vmax] font-bold mb-[2vmax] tracking-widest">{roomId}</h1>
                    <h2 className="text-[1.5vmax] mb-[1.5vmax]">Waiting for Players...</h2>
                    <div className="flex gap-[1vmax] mb-[2vmax]">
                        {gameState.players.map(p => (
                            <div key={p.id} className="bg-white text-black p-[1vmax] rounded shadow-lg min-w-[6vmax] text-center font-bold text-[1vmax]">
                                {p.name}
                            </div>
                        ))}
                        {Array.from({ length: 4 - gameState.players.length }).map((_, i) => (
                            <div key={i} className="bg-white/20 p-[1vmax] rounded border-2 border-dashed border-white min-w-[6vmax] text-center text-[1vmax]">Empty</div>
                        ))}
                    </div>
                    <div className="flex flex-col items-center gap-2 mb-[1vmax]">
                        <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded">
                            <input
                                type="checkbox"
                                id="advancedBots"
                                checked={useAdvancedBots}
                                onChange={(e) => setUseAdvancedBots(e.target.checked)}
                                className="w-4 h-4 cursor-pointer"
                            />
                            <label htmlFor="advancedBots" className="cursor-pointer select-none text-[1vmax]">
                                Enable Advanced AI Bots
                            </label>
                        </div>
                        <button onClick={startGame} className="bg-yellow-500 text-black px-[2vmax] py-[0.75vmax] rounded-full font-bold text-[1.2vmax] hover:bg-yellow-400 shadow-lg transform transition hover:scale-105">
                            Start Game (Fill with Bots)
                        </button>
                    </div>
                    <button onClick={leaveRoom} className="text-green-300 hover:text-white underline text-[0.9vmax]">
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
                    <div className={`mb-[1vmax] px-[1.5vmax] py-[0.5vmax] rounded-full font-bold text-[1.2vmax] shadow-lg ${
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
                            <div className="text-white/70 text-[0.9vmax] mb-[0.5vmax] font-semibold">Hand to Beat</div>
                            <div className="flex bg-black/30 px-[1vmax] py-[0.75vmax] rounded-xl" style={{ marginLeft: '-1vmax' }}>
                                {gameState.lastPlayedHand.cards.map((card) => (
                                    <div key={`center-${card.rank}-${card.suit}`} style={{ marginLeft: '-0.5vmax' }}>
                                        <Card rank={card.rank} suit={card.suit} />
                                    </div>
                                ))}
                            </div>
                            <div className="text-white/50 text-[0.8vmax] mt-[0.5vmax]">
                                {gameState.lastPlayedHand.type.replace(/_/g, ' ').toUpperCase()}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="free-play"
                            className="text-white/30 font-bold text-[1.2vmax] border-2 border-dashed border-white/30 px-[1.5vmax] py-[0.75vmax] rounded-lg"
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
            <div className="absolute bottom-[2vh] left-1/2 -translate-x-1/2 flex items-end gap-[1vmax]">
                {/* Left side: Controls and Cards stacked */}
                <div className="flex flex-col items-center">
                    {/* Hand Helper Buttons */}
                    {gameState.gameState === 'playing' && (
                        <HandHelper
                            playerHand={myHand}
                            lastPlayedHand={gameState.lastPlayedHand}
                            onSelectCards={handleSelectCards}
                            isMyTurn={isMyTurn}
                        />
                    )}

                    {/* Controls */}
                    <div className="flex items-center gap-[1vmax] mb-[0.75vmax]">
                        <button
                            onClick={playCards}
                            disabled={!isMyTurn || selectedCards.length === 0}
                            className={`px-[1.5vmax] py-[0.5vmax] rounded-full font-bold shadow-lg transition transform text-[1vmax]
                                ${isMyTurn && selectedCards.length > 0 ? 'bg-yellow-500 text-black hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Play
                        </button>
                        <button
                            onClick={passTurn}
                            disabled={!isMyTurn || !gameState.lastPlayedHand}
                            className={`px-[1.5vmax] py-[0.5vmax] rounded-full font-bold shadow-lg transition transform text-[1vmax]
                                ${isMyTurn && gameState.lastPlayedHand ? 'bg-yellow-600 text-white hover:scale-105' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
                        >
                            Pass
                        </button>
                        <button
                            onClick={() => setAutoPass(!autoPass)}
                            className={`px-[1vmax] py-[0.5vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-[0.85vmax]
                                ${autoPass ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-200'}`}
                            title="Automatically pass when you have no cards that can beat the played hand"
                        >
                            Auto-Pass {autoPass ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={() => setSortMode(sortMode === 'rank' ? 'suit' : 'rank')}
                            className="px-[1vmax] py-[0.5vmax] rounded-full font-bold shadow-lg transition transform hover:scale-105 text-[0.85vmax] bg-purple-600 text-white hover:bg-purple-500"
                            title={`Currently sorting by ${sortMode}. Click to sort by ${sortMode === 'rank' ? 'suit' : 'rank'}.`}
                        >
                            Sort: {sortMode === 'rank' ? '🔢 Rank' : '♠ Suit'}
                        </button>
                    </div>

                    {/* My Hand */}
                    <div className="flex justify-center transition-all duration-300 hover:gap-[0.5vmax]" style={{ gap: '-1.5vmax' }}>
                        {sortedHand.map((card, index) => {
                             const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                             return (
                                <div key={`${card.rank}-${card.suit}`} style={{ marginLeft: index === 0 ? 0 : '-1.5vmax' }} className="hover:ml-0 transition-all">
                                    <Card
                                        rank={card.rank}
                                        suit={card.suit}
                                        selected={isSelected}
                                        onClick={() => toggleCard(card)}
                                        index={index}
                                    />
                                </div>
                             );
                        })}
                    </div>
                </div>

                {/* Right side: Avatar */}
                <div className="flex flex-col items-center mb-[0.5vmax]">
                    <div className={`w-[4vmax] h-[4vmax] rounded-full flex items-center justify-center text-[1.2vmax] font-bold border-4 shadow-lg
                        ${isMyTurn ? 'border-yellow-400 bg-yellow-400 text-black animate-pulse' : 'border-yellow-600 bg-yellow-500 text-black'}`}>
                        {user?.username?.substring(0, 2).toUpperCase() || 'ME'}
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

            {/* Bot Debug Panel */}
            <AnimatePresence>
                {showDebugPanel && (
                    <BotDebugPanel
                        reasoning={botReasoning}
                        isVisible={showDebugPanel}
                        onClose={() => {
                            setShowDebugPanel(false);
                            socket.emit('toggle_debug', { roomId, enabled: false });
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default GameRoom;
