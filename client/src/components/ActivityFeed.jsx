import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import ScoreDialog from './ScoreDialog';
import { ActivityFeedV2 } from './tableV2';
import { useIsDesktop } from '../hooks/useMediaQuery';

const ActivityFeed = ({ serverUrl, user }) => {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        status: 'completed',
        gameMode: 'all'
    });
    // `append` distinguishes the two paging idioms: desktop swaps pages in place,
    // the v2 mobile feed appends via "Load more".
    const [page, setPage] = useState({ number: 1, append: false });
    const [totalPages, setTotalPages] = useState(1);
    const [selectedGame, setSelectedGame] = useState(null);
    const isDesktop = useIsDesktop();
    const navigate = useNavigate();

    const currentPage = page.number;

        const fetchActivityFeed = useCallback(async () => {
        if (page.append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        try {
            const params = new URLSearchParams({
                page: page.number,
                limit: 20,
                status: filters.status,
                ...(filters.gameMode !== 'all' && { gameMode: filters.gameMode })
            });

            const response = await fetch(`${serverUrl}/api/activity?${params}`);
            if (!response.ok) throw new Error('Failed to fetch activity feed');

            const data = await response.json();
            const fetched = data.games || [];
            setGames(prev => (page.append ? [...prev, ...fetched] : fetched));
            setTotalPages(data.pagination?.totalPages || 1);
            setError(null);
        } catch (err) {
            console.error('Error fetching activity feed:', err);
            setError('Failed to load activity feed');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [serverUrl, filters, page]);

    useEffect(() => {
        fetchActivityFeed();
    }, [fetchActivityFeed]);

    // Filter changes always restart at page 1 with a fresh list.
    const applyFilters = (next) => {
        setFilters(next);
        setPage({ number: 1, append: false });
    };

    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    const getPlacementEmoji = (placement) => {
        switch (placement) {
            case 1: return '🥇';
            case 2: return '🥈';
            case 3: return '🥉';
            default: return '';
        }
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
            isDragonWin: false // Could be detected from events
        };
        setSelectedGame(gameDialogData);
    };

    const renderGameCard = (game) => {
        const isPrivate = !game.is_public;
        const participants = game.participants || [];
        const sortedParticipants = [...participants].sort((a, b) => a.placement - b.placement);

        return (
            <div
                key={game.game_id}
                className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition-colors cursor-pointer"
                onClick={() => handleGameClick(game)}>
                <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                            game.game_mode === 'short'
                                ? 'bg-blue-900 text-blue-300'
                                : 'bg-purple-900 text-purple-300'
                        }`}>
                            {game.game_mode === 'short' ? 'Short' : 'Standard'}
                        </span>
                        {isPrivate && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-400">
                                Private
                            </span>
                        )}
                        {game.status === 'abandoned' && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-red-900 text-red-300">
                                Abandoned
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-gray-400">
                        {game.end_time
                            ? formatDistanceToNow(new Date(game.end_time), { addSuffix: true })
                            : 'In Progress'}
                    </div>
                </div>

                <div className="space-y-2">
                    {/* Winner highlight */}
                    {game.winner_username && (
                        <div className="text-sm">
                            <span className="text-yellow-400">👑 {game.winner_username}</span>
                            <span className="text-gray-400"> won!</span>
                        </div>
                    )}

                    {/* Participants list */}
                    <div className="space-y-1">
                        {sortedParticipants.map((p, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <span>{getPlacementEmoji(p.placement)}</span>
                                    <span className={p.isBot ? 'text-gray-500 italic' : 'text-gray-300'}>
                                        {p.username}
                                        {p.isBot ? ' (Bot)' : ''}
                                    </span>
                                </div>
                                <span className="text-gray-400">{p.score} pts</span>
                            </div>
                        ))}
                    </div>

                    {/* Game stats */}
                    <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-700">
                        <span>{game.total_rounds} rounds</span>
                        {game.duration_seconds && (
                            <span>{formatDuration(game.duration_seconds)}</span>
                        )}
                        {game.event_count > 0 && (
                            <span className="text-yellow-400">⭐ {game.event_count} highlights</span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // v2 mobile activity feed (narrow viewports). Desktop keeps the layout below.
    if (!isDesktop) {
        return (
            <ActivityFeedV2
                games={games}
                filters={filters}
                onSetFilters={applyFilters}
                loading={loading}
                loadingMore={loadingMore}
                error={error}
                hasMore={currentPage < totalPages}
                onLoadMore={() => setPage({ number: currentPage + 1, append: true })}
                onRetry={fetchActivityFeed}
                onBack={() => navigate('/lobby')}
                username={user?.username}
            />
        );
    }

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
                                    applyFilters({ ...filters, status: 'completed' });
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
                                    applyFilters({ ...filters, status: 'all' });
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
                                    applyFilters({ ...filters, status: 'abandoned' });
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
                                    applyFilters({ ...filters, gameMode: 'all' });
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
                                    applyFilters({ ...filters, gameMode: 'short' });
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
                                    applyFilters({ ...filters, gameMode: 'standard' });
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
                            {games.map(renderGameCard)}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mt-8">
                                <button
                                    onClick={() => setPage({ number: Math.max(1, currentPage - 1), append: false })}
                                    disabled={currentPage === 1}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Previous
                                </button>
                                <span className="text-gray-400">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage({ number: Math.min(totalPages, currentPage + 1), append: false })}
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