import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ScoreDialog from './ScoreDialog';
import ActivityFeedGameCard from './ActivityFeedGameCard';

const ActivityFeed = ({ serverUrl }) => {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        status: 'completed',
        gameMode: 'all'
    });
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedGame, setSelectedGame] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchActivityFeed();
    }, [filters, currentPage]);

    const fetchActivityFeed = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: currentPage,
                limit: 20,
                status: filters.status,
                ...(filters.gameMode !== 'all' && { gameMode: filters.gameMode })
            });

            const response = await fetch(`${serverUrl}/api/activity?${params}`);
            if (!response.ok) throw new Error('Failed to fetch activity feed');

            const data = await response.json();
            setGames(data.games || []);
            setTotalPages(data.pagination?.totalPages || 1);
            setError(null);
        } catch (err) {
            console.error('Error fetching activity feed:', err);
            setError('Failed to load activity feed');
        } finally {
            setLoading(false);
        }
    };

    const handleGameClick = useCallback((game) => {
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
            isDragonWin: false // Could be detected from events
        };
        setSelectedGame(gameDialogData);
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => navigate('/')}
                        className="text-blue-400 hover:text-blue-300 mb-4"
                    >
                        ← Back to Lobby
                    </button>
                    <h1 className="text-3xl font-bold mb-2">Activity Feed</h1>
                    <p className="text-gray-400">Recent games from the community</p>
                </div>

                {/* Fun Filter Pills */}
                <div className="mb-6">
                    {/* Status Filter */}
                    <div className="mb-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Show me...</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, status: 'completed' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.status === 'completed'
                                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                ✅ Finished Games
                            </button>
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, status: 'all' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.status === 'all'
                                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                🎮 Everything
                            </button>
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, status: 'abandoned' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.status === 'abandoned'
                                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                💔 Rage Quits
                            </button>
                        </div>
                    </div>

                    {/* Game Mode Filter */}
                    <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Game Style</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, gameMode: 'all' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.gameMode === 'all'
                                        ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                🎲 All Modes
                            </button>
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, gameMode: 'short' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.gameMode === 'short'
                                        ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                ⚡ Quick Games
                                <span className="ml-1 text-xs opacity-75">(50 pts)</span>
                            </button>
                            <button
                                onClick={() => {
                                    setFilters({ ...filters, gameMode: 'standard' });
                                    setCurrentPage(1);
                                }}
                                className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 ${
                                    filters.gameMode === 'standard'
                                        ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                🏆 Full Match
                                <span className="ml-1 text-xs opacity-75">(100 pts)</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Games List */}
                {loading ? (
                    <div className="text-center py-8">
                        <div className="text-gray-400">Loading games...</div>
                    </div>
                ) : error ? (
                    <div className="text-center py-8">
                        <div className="text-red-400">{error}</div>
                        <button
                            onClick={fetchActivityFeed}
                            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                        >
                            Retry
                        </button>
                    </div>
                ) : games.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-gray-400">No games found</div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-4">
                            {games.map(game => (
                                <ActivityFeedGameCard
                                    key={game.game_id}
                                    game={game}
                                    onClick={handleGameClick}
                                />
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mt-8">
                                <button
                                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                    disabled={currentPage === 1}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Previous
                                </button>
                                <span className="text-gray-400">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <ScoreDialog
                isOpen={!!selectedGame}
                onClose={() => setSelectedGame(null)}
                gameData={selectedGame}
                showActions={false}
            />
        </div>
    );
};

export default ActivityFeed;
