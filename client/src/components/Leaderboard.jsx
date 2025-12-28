import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

const Leaderboard = ({ user }) => {
    const [mode, setMode] = useState('standard');
    const [sortBy, setSortBy] = useState('rating');
    const [minGames, setMinGames] = useState(0);
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [playerRank, setPlayerRank] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showArchetypeDialog, setShowArchetypeDialog] = useState(false);
    const [selectedArchetype, setSelectedArchetype] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchLeaderboard();
    }, [mode, sortBy, minGames]);

    const archetypeDescriptions = {
        'Aggressive': {
            title: 'Aggressive Player',
            color: 'text-red-600',
            description: 'High intensity play style that constantly applies pressure to opponents.',
            strengths: [
                'Quick to take control of the table',
                'Forces opponents to make difficult decisions',
                'Maintains strong momentum',
                'Excellent at capitalizing on weak opponents'
            ],
            improvements: [
                'May exhaust strong cards too early',
                'Can be predictable when always attacking',
                'Sometimes takes unnecessary risks',
                'Vulnerable to counter-plays from patient opponents'
            ],
            strategy: 'This aggressive style can overwhelm opponents, but players should be careful not to exhaust strong cards too early.'
        },
        'Conservative': {
            title: 'Conservative Player',
            color: 'text-blue-600',
            description: 'Prioritizes safety and card preservation over aggressive plays.',
            strengths: [
                'Excellent hand management',
                'Strong endgame presence',
                'Minimizes penalty risk',
                'Hard to pressure into mistakes'
            ],
            improvements: [
                'May miss opportunities to take control',
                'Can appear passive or predictable',
                'Struggles when forced to lead',
                'Sometimes lets aggressive players dominate'
            ],
            strategy: 'This patient approach often pays off in the endgame, but watch for opportunities to seize control when opponents are weak.'
        },
        'Balanced': {
            title: 'Balanced Player',
            color: 'text-green-600',
            description: 'Maintains equilibrium between aggressive and conservative strategies.',
            strengths: [
                'Adapts well to different situations',
                'Consistent decision-making',
                'Difficult to exploit',
                'Well-rounded skill set'
            ],
            improvements: [
                'Jack of all trades, master of none',
                'May lack a decisive edge in critical moments',
                'Can be indecisive when multiple options exist',
                'Sometimes too middle-of-the-road'
            ],
            strategy: 'Versatility is the key strength. Continue reading the game flow and adjusting tactics accordingly.'
        },
        'Adaptive': {
            title: 'Adaptive Player',
            color: 'text-purple-600',
            description: 'Dynamically adjusts strategy based on opponents and game state.',
            strengths: [
                'Highly unpredictable',
                'Excellent at reading opponents',
                'Can counter any play style',
                'Thrives in complex situations'
            ],
            improvements: [
                'May overthink simple situations',
                'Can confuse allies in team variants',
                'Sometimes changes strategy too frequently',
                'Requires high mental energy to maintain'
            ],
            strategy: 'The ability to shift strategies keeps opponents guessing. Use this unpredictability to maintain a psychological edge.'
        }
    };

    const handleArchetypeClick = (archetype) => {
        setSelectedArchetype(archetype);
        setShowArchetypeDialog(true);
    };

    const fetchLeaderboard = async () => {
        setLoading(true);
        setError('');
        try {
            const leaderboardRes = await axios.get(
                `${API_BASE}/api/leaderboard?mode=${mode}&sortBy=${sortBy}&limit=100&minGames=${minGames}`
            );
            setLeaderboardData(leaderboardRes.data);

            // Fetch current user's rank if logged in
            if (user) {
                try {
                    const rankRes = await axios.get(
                        `${API_BASE}/api/leaderboard/${user.username}/rank?mode=${mode}&sortBy=${sortBy}`
                    );
                    setPlayerRank(rankRes.data.rank);
                } catch (err) {
                    setPlayerRank(null);
                }
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load leaderboard');
        } finally {
            setLoading(false);
        }
    };

    if (!user) {
        navigate('/');
        return null;
    }

    const formatRating = (rating) => Math.round(rating);
    const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;
    const formatPlacement = (value) => value ? value.toFixed(2) : 'N/A';

    const getArchetypeBadge = (archetype) => {
        if (!archetype) return null;

        const colors = {
            'Aggressive': 'bg-red-600 hover:bg-red-700',
            'Conservative': 'bg-blue-600 hover:bg-blue-700',
            'Balanced': 'bg-green-600 hover:bg-green-700',
            'Adaptive': 'bg-purple-600 hover:bg-purple-700'
        };

        return (
            <button
                onClick={() => handleArchetypeClick(archetype)}
                className={`text-xs px-2 py-1 rounded cursor-pointer transition-all hover:scale-105 ${colors[archetype] || 'bg-gray-600 hover:bg-gray-700'}`}
                title="Click to learn more"
            >
                {archetype}
            </button>
        );
    };

    const getSortLabel = (key) => {
        const labels = {
            rating: 'Rating',
            games: 'Games Played',
            wins: 'Total Wins',
            winRate: 'Win Rate',
            firstPlace: '1st Place Finishes',
            avgPlacement: 'Avg Placement'
        };
        return labels[key] || key;
    };

    const getRankEmoji = (rank) => {
        if (rank === 1) return '🥇';
        if (rank === 2) return '🥈';
        if (rank === 3) return '🥉';
        return `#${rank}`;
    };

    return (
        <div className="min-h-screen bg-green-900 text-white p-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-4xl font-bold text-yellow-400 mb-2">Leaderboard</h1>
                        {playerRank && (
                            <p className="text-lg text-gray-300">
                                Your Rank: <span className="text-yellow-300 font-bold">{getRankEmoji(playerRank)}</span>
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => navigate('/lobby')}
                        className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded transition"
                    >
                        Back to Lobby
                    </button>
                </div>

                {/* Filters */}
                <div className="bg-green-800 rounded-lg p-4 mb-6 space-y-4">
                    {/* Mode Selector */}
                    <div>
                        <label className="text-sm font-semibold text-gray-300 mb-2 block">Game Mode</label>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setMode('standard')}
                                className={`px-6 py-2 rounded font-bold transition ${
                                    mode === 'standard'
                                        ? 'bg-yellow-500 text-white scale-105'
                                        : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                }`}
                            >
                                Standard (100pts)
                            </button>
                            <button
                                onClick={() => setMode('short')}
                                className={`px-6 py-2 rounded font-bold transition ${
                                    mode === 'short'
                                        ? 'bg-yellow-500 text-white scale-105'
                                        : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                }`}
                            >
                                Short (50pts)
                            </button>
                        </div>
                    </div>

                    {/* Sort By Selector */}
                    <div>
                        <label className="text-sm font-semibold text-gray-300 mb-2 block">Sort By</label>
                        <div className="flex flex-wrap gap-2">
                            {['rating', 'games', 'wins', 'winRate', 'firstPlace', 'avgPlacement'].map((key) => (
                                <button
                                    key={key}
                                    onClick={() => setSortBy(key)}
                                    className={`px-4 py-2 rounded text-sm font-semibold transition ${
                                        sortBy === key
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                    }`}
                                >
                                    {getSortLabel(key)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Minimum Games Filter */}
                    <div>
                        <label className="text-sm font-semibold text-gray-300 mb-2 block">
                            Minimum Games: {minGames}
                        </label>
                        <div className="flex gap-2">
                            {[0, 5, 10, 25, 50].map((value) => (
                                <button
                                    key={value}
                                    onClick={() => setMinGames(value)}
                                    className={`px-3 py-1 rounded text-sm transition ${
                                        minGames === value
                                            ? 'bg-green-600 text-white'
                                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                    }`}
                                >
                                    {value}+
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Loading State */}
                {loading && (
                    <div className="text-center py-12">
                        <div className="text-xl text-gray-300">Loading leaderboard...</div>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="bg-red-900 border border-red-600 rounded-lg p-4 mb-4">
                        <p className="text-red-200">{error}</p>
                    </div>
                )}

                {/* Leaderboard Table */}
                {!loading && !error && (
                    <div className="bg-green-800 rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-green-700">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-yellow-400">Rank</th>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-yellow-400">Player</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Rating</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Games</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Wins</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Win Rate</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">1st Place</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Avg Place</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Leads Won</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-yellow-400">Type</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-green-700">
                                    {leaderboardData.length === 0 ? (
                                        <tr>
                                            <td colSpan="10" className="px-4 py-8 text-center text-gray-400">
                                                No players found with the current filters
                                            </td>
                                        </tr>
                                    ) : (
                                        leaderboardData.map((player, index) => {
                                            const rank = index + 1;
                                            const isCurrentUser = user && player.username === user.username;

                                            return (
                                                <tr
                                                    key={player.username}
                                                    className={`transition hover:bg-green-700 ${
                                                        isCurrentUser ? 'bg-green-700/50 border-l-4 border-yellow-400' : ''
                                                    }`}
                                                >
                                                    <td className="px-4 py-3 text-left font-bold text-lg">
                                                        {getRankEmoji(rank)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => navigate(`/stats/${player.username}`)}
                                                                className={`font-semibold hover:underline cursor-pointer transition ${
                                                                    isCurrentUser ? 'text-yellow-300 hover:text-yellow-200' : 'text-white hover:text-blue-300'
                                                                }`}
                                                            >
                                                                {player.username}
                                                            </button>
                                                            {isCurrentUser && (
                                                                <span className="text-xs bg-yellow-600 px-2 py-1 rounded">You</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center font-bold text-yellow-300">
                                                        {formatRating(player.rating_display)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-gray-300">
                                                        {player.games_played}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-green-300">
                                                        {player.wins}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-blue-300">
                                                        {formatPercentage(player.win_rate)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-purple-300">
                                                        {player.first_place}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-orange-300">
                                                        {formatPlacement(player.avg_placement)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-cyan-300">
                                                        {player.leads_won}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {getArchetypeBadge(player.archetype)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer Info */}
                        {leaderboardData.length > 0 && (
                            <div className="bg-green-700 px-4 py-3 text-sm text-gray-300 border-t border-green-600">
                                Showing top {leaderboardData.length} players
                                {minGames > 0 && ` with ${minGames}+ games`}
                            </div>
                        )}
                    </div>
                )}

                {/* Legend */}
                <div className="mt-6 bg-green-800 rounded-lg p-4">
                    <h3 className="text-lg font-bold text-yellow-400 mb-3">Player Types</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleArchetypeClick('Aggressive')}
                                className="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs cursor-pointer transition-all hover:scale-105"
                                title="Click to learn more"
                            >
                                Aggressive
                            </button>
                            <span className="text-gray-300">High play rate, takes control</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleArchetypeClick('Conservative')}
                                className="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs cursor-pointer transition-all hover:scale-105"
                                title="Click to learn more"
                            >
                                Conservative
                            </button>
                            <span className="text-gray-300">Cautious, strategic passing</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleArchetypeClick('Balanced')}
                                className="bg-green-600 hover:bg-green-700 px-2 py-1 rounded text-xs cursor-pointer transition-all hover:scale-105"
                                title="Click to learn more"
                            >
                                Balanced
                            </button>
                            <span className="text-gray-300">Mix of play and pass</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleArchetypeClick('Adaptive')}
                                className="bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-xs cursor-pointer transition-all hover:scale-105"
                                title="Click to learn more"
                            >
                                Adaptive
                            </button>
                            <span className="text-gray-300">Adjusts to opponents</span>
                        </div>
                    </div>
                </div>

                {/* Archetype Dialog */}
                {showArchetypeDialog && selectedArchetype && archetypeDescriptions[selectedArchetype] && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <h2 className={`text-3xl font-bold ${archetypeDescriptions[selectedArchetype].color}`}>
                                        {archetypeDescriptions[selectedArchetype].title}
                                    </h2>
                                    <button
                                        onClick={() => setShowArchetypeDialog(false)}
                                        className="text-gray-500 hover:text-gray-700 text-2xl"
                                    >
                                        ×
                                    </button>
                                </div>

                                <p className="text-gray-700 text-lg mb-6">
                                    {archetypeDescriptions[selectedArchetype].description}
                                </p>

                                <div className="mb-6">
                                    <h3 className="text-xl font-semibold text-gray-800 mb-3">Strengths</h3>
                                    <ul className="space-y-2 mb-6">
                                        {archetypeDescriptions[selectedArchetype].strengths.map((strength, index) => (
                                            <li key={index} className="flex items-start">
                                                <span className="text-green-500 mr-2">✓</span>
                                                <span className="text-gray-700">{strength}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <h3 className="text-xl font-semibold text-gray-800 mb-3">Areas for Improvement</h3>
                                    <ul className="space-y-2">
                                        {archetypeDescriptions[selectedArchetype].improvements.map((improvement, index) => (
                                            <li key={index} className="flex items-start">
                                                <span className="text-amber-500 mr-2">•</span>
                                                <span className="text-gray-700">{improvement}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="p-4 bg-blue-50 rounded-lg">
                                    <h3 className="text-lg font-semibold text-blue-800 mb-2">Strategic Insight</h3>
                                    <p className="text-blue-700">
                                        {archetypeDescriptions[selectedArchetype].strategy}
                                    </p>
                                </div>

                                <button
                                    onClick={() => setShowArchetypeDialog(false)}
                                    className="mt-6 w-full bg-indigo-600 text-white py-2 px-4 rounded hover:bg-indigo-700 transition"
                                >
                                    Got it!
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Leaderboard;
