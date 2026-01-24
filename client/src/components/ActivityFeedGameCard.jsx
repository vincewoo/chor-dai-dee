import React, { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';

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

// Memoized component to prevent re-renders when parent state (like selectedGame) changes but game data hasn't
const ActivityFeedGameCard = ({ game, onClick }) => {
    const isPrivate = !game.is_public;
    const participants = game.participants || [];
    // Sorting inside the component, but now it's memoized so it only happens when game prop changes
    const sortedParticipants = [...participants].sort((a, b) => a.placement - b.placement);

    return (
        <div
            className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition-colors cursor-pointer"
            onClick={() => onClick(game)}>
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

export default memo(ActivityFeedGameCard);
