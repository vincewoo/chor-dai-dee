import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MaxBotsChip } from './tableV2';

const ScoreDialog = ({
    isOpen,
    onClose,
    gameData,
    showActions = false,
    onNextRound = null,
    onBackToLobby = null,
    // Shown for a finished game the viewer actually played in. Independent of
    // showActions: the review is offered from the activity feed, where the
    // round/lobby actions are not.
    onReview = null
}) => {
    if (!isOpen) return null;

    // Add better error handling for missing or malformed data
    if (!gameData) {
        console.error('ScoreDialog: No game data provided');
        return null;
    }

    // Safely check for winner/roundWinner
    const isGameOver = gameData.winner !== undefined && gameData.winner !== null;
    const isDragonWin = gameData.isDragonWin || false;
    const isRoundOver = !isGameOver && gameData.roundWinner;

    // Sort scores by cumulative score (lowest first)
    const sortedScores = gameData.scores ?
        [...gameData.scores].sort((a, b) => a.cumulativeScore - b.cumulativeScore) : [];

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center text-white p-4 sm:p-8"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="bg-gray-900 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Title */}
                        {isGameOver ? (
                            <>
                                <h2 className="text-4xl sm:text-5xl font-bold text-yellow-400 mb-2 text-center">
                                    {isDragonWin ? '🐉 DRAGON! 🐉' : '🏆 Game Over!'}
                                </h2>
                                <div className="text-xl mb-2 text-green-300 text-center">
                                    Winner: {gameData.winner?.name || 'Unknown'}
                                </div>
                                {isDragonWin ? (
                                    <div className="text-lg mb-4 text-yellow-300 font-bold text-center">
                                        Won with a DRAGON (13-card Straight)!
                                    </div>
                                ) : (
                                    <div className="text-lg mb-4 text-gray-400 text-center">
                                        Completed in {gameData.roundNumber} rounds
                                    </div>
                                )}
                                {/* Only ever set for a finished game opened from
                                    the home screen's Recent list, the only
                                    caller that has the game's recorded bot
                                    policy. */}
                                {gameData.maxBots && (
                                    <div className="mb-4 flex justify-center">
                                        <MaxBotsChip />
                                    </div>
                                )}
                            </>
                        ) : isRoundOver ? (
                            <>
                                <h2 className="text-3xl sm:text-4xl font-bold text-yellow-400 mb-2 text-center">
                                    Round {gameData.roundNumber} Complete!
                                </h2>
                                <div className="text-lg mb-4 text-green-300 text-center">
                                    Round Winner: {gameData.roundWinner?.name || 'Unknown'}
                                </div>
                            </>
                        ) : null}

                        {/* Scores Table */}
                        <div className="bg-white/10 rounded-lg p-4 mb-4">
                            <h3 className="text-lg font-bold mb-3 border-b pb-2">
                                {isGameOver ? 'Final Scores' : 'Round Scores'}
                            </h3>

                            {isRoundOver && (
                                <div className="grid grid-cols-4 gap-2 text-xs sm:text-sm font-semibold mb-2 text-gray-400">
                                    <span>Player</span>
                                    <span className="text-center">Cards</span>
                                    <span className="text-center">Round</span>
                                    <span className="text-center">Total</span>
                                </div>
                            )}

                            {sortedScores.map((s, idx) => (
                                <div key={s.name} className={
                                    isGameOver ?
                                        `flex justify-between mb-2 ${idx === 0 ? 'text-green-400 font-bold text-lg' : ''}` :
                                        "grid grid-cols-4 gap-2 mb-2 items-center text-sm"
                                }>
                                    {isGameOver ? (
                                        <>
                                            <span>
                                                {idx === 0 && '🏆 '}
                                                {idx === 1 && '🥈 '}
                                                {idx === 2 && '🥉 '}
                                                {s.name} {s.isBot ? '(Bot)' : ''}
                                            </span>
                                            <span>{s.cumulativeScore || s.finalScore || 0} pts</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className={s.isRoundWinner ? 'text-green-400 font-bold' : ''}>
                                                {s.name} {s.isBot ? '(Bot)' : ''}
                                            </span>
                                            <span className="text-center text-gray-400">{s.cardsLeft}</span>
                                            <span className={`text-center ${s.roundPoints === 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                +{s.roundPoints}
                                            </span>
                                            <span className={`text-center font-bold ${
                                                s.cumulativeScore >= 80 ? 'text-red-500' :
                                                s.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-white'
                                            }`}>
                                                {s.cumulativeScore}
                                            </span>
                                        </>
                                    )}
                                </div>
                            ))}

                            {isRoundOver && gameData.pointThreshold && (
                                <div className="mt-4 pt-2 border-t border-white/20 text-xs sm:text-sm text-gray-400">
                                    First to {gameData.pointThreshold} points loses. Lowest score wins!
                                </div>
                            )}
                        </div>

                        {/* Game Info */}
                        {gameData.gameMode && (
                            <div className="text-center text-sm text-gray-400 mb-4">
                                Game Mode: {gameData.gameMode === 'short' ? '⚡ Short (50 pts)' : '🏆 Standard (100 pts)'}
                            </div>
                        )}

                        {onReview && isGameOver && (
                            <button
                                onClick={onReview}
                                className="w-full mb-3 bg-purple-600 px-6 py-3 rounded-lg font-bold hover:bg-purple-700 transition transform hover:scale-105"
                            >
                                🔍 Review my moves
                            </button>
                        )}

                        {/* Actions */}
                        {showActions && (
                            <div className="flex gap-3">
                                {isRoundOver && onNextRound && (
                                    <button
                                        onClick={onNextRound}
                                        className="flex-1 bg-green-600 px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105"
                                    >
                                        Next Round
                                    </button>
                                )}
                                {isGameOver && onBackToLobby && (
                                    <button
                                        onClick={onBackToLobby}
                                        className="flex-1 bg-blue-600 px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition transform hover:scale-105"
                                    >
                                        Back to Lobby
                                    </button>
                                )}
                                {!showActions && (
                                    <button
                                        onClick={onClose}
                                        className="w-full bg-gray-700 px-6 py-3 rounded-lg font-bold hover:bg-gray-600 transition"
                                    >
                                        Close
                                    </button>
                                )}
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ScoreDialog;