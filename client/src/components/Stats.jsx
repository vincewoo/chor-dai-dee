import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

const Stats = ({ user }) => {
    const [mode, setMode] = useState('standard');
    const [stats, setStats] = useState(null);
    const [headToHead, setHeadToHead] = useState([]);
    const [tier3Stats, setTier3Stats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        fetchStats();
    }, [mode]);

    const fetchStats = async () => {
        setLoading(true);
        setError('');
        try {
            const [statsRes, h2hRes, tier3Res] = await Promise.all([
                axios.get(`${API_BASE}/api/stats/${user.username}/detailed?mode=${mode}`),
                axios.get(`${API_BASE}/api/stats/${user.username}/head-to-head?mode=${mode}`),
                axios.get(`${API_BASE}/api/stats/${user.username}/tier3?mode=${mode}`)
            ]);
            setStats(statsRes.data);
            setHeadToHead(h2hRes.data.headToHead || []);
            setTier3Stats(tier3Res.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load stats');
        } finally {
            setLoading(false);
        }
    };

    if (!user) {
        navigate('/');
        return null;
    }

    return (
        <div className="min-h-screen bg-green-900 text-white p-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-4xl font-bold text-yellow-400">Player Statistics</h1>
                    <button
                        onClick={() => navigate('/lobby')}
                        className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded transition"
                    >
                        Back to Lobby
                    </button>
                </div>

                {/* Username */}
                <div className="text-xl mb-4">
                    <span className="text-gray-300">Player:</span>
                    <span className="text-yellow-300 font-bold ml-2">{user.username}</span>
                </div>

                {/* Mode Selector */}
                <div className="flex gap-4 mb-6">
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

                {/* Loading/Error States */}
                {loading && (
                    <div className="text-center text-xl">Loading stats...</div>
                )}
                {error && (
                    <div className="bg-red-500/20 border border-red-500 text-red-200 p-4 rounded">
                        {error}
                    </div>
                )}

                {/* Stats Display */}
                {stats && !loading && (
                    <div className="space-y-6">
                        {/* Game Overview */}
                        <GameOverviewCard stats={stats.gameStats} />

                        {/* Placement Tracking */}
                        <PlacementCard stats={stats.gameStats} />

                        {/* Play Aggressiveness */}
                        <PlayStyleCard stats={stats.gameStats} roundAggregates={stats.roundAggregates} />

                        {/* Combination Usage */}
                        <CombinationCard stats={stats.combinationStats} />

                        {/* Penalty Severity */}
                        <PenaltyCard stats={stats.gameStats} roundAggregates={stats.roundAggregates} />

                        {/* Tier 2 Strategic Metrics */}
                        <div className="col-span-full mt-4">
                            <h2 className="text-3xl font-bold text-yellow-300 mb-2">Strategic Metrics (Tier 2)</h2>
                            <p className="text-sm text-gray-400">Control, competition, and head-to-head performance</p>
                        </div>

                        <LeadSuccessCard stats={stats.gameStats} />
                        <HeadToHeadCard headToHead={headToHead} />

                        {/* Tier 3 Advanced Analytics */}
                        {tier3Stats && (
                            <>
                                <div className="col-span-full mt-4">
                                    <h2 className="text-3xl font-bold text-yellow-300 mb-2">Advanced Analytics (Tier 3)</h2>
                                    <p className="text-sm text-gray-400">Deep insights into decision quality, consistency, and play style</p>
                                </div>

                                <CardAwarenessCard stats={tier3Stats.cardAwareness} />
                                <VarianceCard stats={tier3Stats.variance} />
                                <BehavioralCard stats={tier3Stats.behavioral} />
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Game Overview Card Component
const GameOverviewCard = ({ stats }) => {
    const gamesPlayed = stats.games_played || 0;
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : '0.0';
    const avgPoints = gamesPlayed > 0 ? ((stats.points || 0) / gamesPlayed).toFixed(1) : '0.0';
    const rating = stats.rating_mu ? Math.round((stats.rating_mu - 3 * stats.rating_sigma) * 40 + 1200) : 1200;

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Game Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatItem label="Games Played" value={gamesPlayed} />
                <StatItem label="Wins" value={wins} valueColor="text-green-600" />
                <StatItem label="Losses" value={losses} valueColor="text-red-600" />
                <StatItem label="Win Rate" value={`${winRate}%`} valueColor="text-blue-600" />
                <StatItem label="Avg Points/Game" value={avgPoints} />
                <StatItem label="Rating" value={rating} valueColor="text-purple-600" />
            </div>
        </div>
    );
};

// Placement Card Component (Game-level only - final rankings)
const PlacementCard = ({ stats }) => {
    const first = stats.first_place || 0;
    const second = stats.second_place || 0;
    const third = stats.third_place || 0;
    const fourth = stats.fourth_place || 0;
    const total = first + second + third + fourth;

    const getPercentage = (count) => total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Placement Distribution</h2>
            <div className="space-y-3">
                <PlacementBar place="1st" count={first} percentage={getPercentage(first)} color="bg-yellow-500" />
                <PlacementBar place="2nd" count={second} percentage={getPercentage(second)} color="bg-gray-400" />
                <PlacementBar place="3rd" count={third} percentage={getPercentage(third)} color="bg-orange-600" />
                <PlacementBar place="4th" count={fourth} percentage={getPercentage(fourth)} color="bg-red-500" />
            </div>
        </div>
    );
};

const PlacementBar = ({ place, count, percentage, color }) => (
    <div className="flex items-center gap-3">
        <div className="w-12 font-bold">{place}</div>
        <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
            <div
                className={`${color} h-full flex items-center justify-end pr-2 text-white font-bold transition-all duration-500`}
                style={{ width: `${Math.max(parseFloat(percentage), 5)}%` }}
            >
                {parseFloat(percentage) > 10 && `${percentage}%`}
            </div>
        </div>
        <div className="w-20 text-right">
            {count} games
        </div>
        {parseFloat(percentage) <= 10 && (
            <div className="w-12 text-gray-600 text-sm">
                {percentage}%
            </div>
        )}
    </div>
);

// Play Style Card Component
const PlayStyleCard = ({ stats, roundAggregates }) => {
    const totalPlays = stats.total_plays || 0;
    const totalPasses = stats.total_passes || 0;
    const totalRounds = stats.total_rounds || 0;
    const totalActions = totalPlays + totalPasses;

    const passRate = totalActions > 0 ? ((totalPasses / totalActions) * 100).toFixed(1) : '0.0';
    const playsPerRound = totalRounds > 0 ? (totalPlays / totalRounds).toFixed(2) : '0.00';
    const passesPerRound = totalRounds > 0 ? (totalPasses / totalRounds).toFixed(2) : '0.00';
    const avgPlacement = roundAggregates.avg_placement ? roundAggregates.avg_placement.toFixed(2) : 'N/A';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Play Style</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatItem label="Total Plays" value={totalPlays} valueColor="text-green-600" />
                <StatItem label="Total Passes" value={totalPasses} valueColor="text-red-600" />
                <StatItem label="Pass Rate" value={`${passRate}%`} />
                <StatItem label="Plays/Round" value={playsPerRound} />
                <StatItem label="Passes/Round" value={passesPerRound} />
                <StatItem label="Total Rounds" value={totalRounds} />
                <StatItem label="Avg Placement" value={avgPlacement} valueColor="text-purple-600" />
                <StatItem label="Round Wins" value={roundAggregates.round_wins || 0} valueColor="text-yellow-600" />
            </div>
        </div>
    );
};

// Combination Card Component
const CombinationCard = ({ stats }) => {
    const combinations = [
        { label: 'Singles', value: stats.singles || 0, color: 'bg-blue-500' },
        { label: 'Pairs', value: stats.pairs || 0, color: 'bg-green-500' },
        { label: 'Triples', value: stats.triples || 0, color: 'bg-yellow-500' },
        { label: 'Straights', value: stats.straights || 0, color: 'bg-purple-500' },
        { label: 'Flushes', value: stats.flushes || 0, color: 'bg-pink-500' },
        { label: 'Full Houses', value: stats.full_houses || 0, color: 'bg-orange-500' },
        { label: 'Quads', value: stats.quads || 0, color: 'bg-red-500' },
        { label: 'Straight Flushes', value: stats.straight_flushes || 0, color: 'bg-indigo-500' },
    ];

    const total = combinations.reduce((sum, c) => sum + c.value, 0);

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Hand Types Played</h2>
            {total === 0 ? (
                <p className="text-gray-500 text-center py-4">No games played yet in this mode</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {combinations.map((combo) => (
                        <div key={combo.label} className="text-center">
                            <div className="text-sm text-gray-600 mb-1">{combo.label}</div>
                            <div className={`${combo.color} text-white font-bold text-2xl py-2 rounded`}>
                                {combo.value}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {total > 0 ? ((combo.value / total) * 100).toFixed(1) : 0}%
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Penalty Card Component (Round-level - updates after each round)
const PenaltyCard = ({ stats, roundAggregates }) => {
    // Use roundAggregates (real-time round data) if available, otherwise fall back to gameStats
    const source = roundAggregates && (roundAggregates.total_rounds > 0) ? roundAggregates : stats;

    const penalty1x = (source.total_rounds || 0) - (source.penalty_2x_rounds || 0) - (source.penalty_3x_rounds || 0);
    const penalty2x = source.penalty_2x_rounds || 0;
    const penalty3x = source.penalty_3x_rounds || 0;
    const totalRounds = source.total_rounds || 0;

    const getPercentage = (count) => totalRounds > 0 ? ((count / totalRounds) * 100).toFixed(1) : '0.0';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Penalty Severity</h2>
            <div className="space-y-3">
                <PenaltyBar
                    label="1-9 cards (1x)"
                    count={penalty1x}
                    percentage={getPercentage(penalty1x)}
                    color="bg-green-500"
                />
                <PenaltyBar
                    label="10-12 cards (2x)"
                    count={penalty2x}
                    percentage={getPercentage(penalty2x)}
                    color="bg-yellow-500"
                />
                <PenaltyBar
                    label="13 cards (3x)"
                    count={penalty3x}
                    percentage={getPercentage(penalty3x)}
                    color="bg-red-500"
                />
            </div>
        </div>
    );
};

const PenaltyBar = ({ label, count, percentage, color }) => (
    <div className="flex items-center gap-3">
        <div className="w-32 text-sm font-semibold">{label}</div>
        <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
            <div
                className={`${color} h-full flex items-center justify-end pr-2 text-white font-bold transition-all duration-500`}
                style={{ width: `${Math.max(parseFloat(percentage), 5)}%` }}
            >
                {parseFloat(percentage) > 10 && `${percentage}%`}
            </div>
        </div>
        <div className="w-20 text-right text-sm">
            {count} rounds
        </div>
        {parseFloat(percentage) <= 10 && (
            <div className="w-12 text-gray-600 text-sm">
                {percentage}%
            </div>
        )}
    </div>
);

// Lead Success Card Component - Tier 2
const LeadSuccessCard = ({ stats }) => {
    const leadsWon = stats.leads_won || 0;
    const leadAttempts = stats.lead_attempts || 0;
    const leadSuccessRate = leadAttempts > 0 ? ((leadsWon / leadAttempts) * 100).toFixed(1) : '0.0';
    const totalPlays = stats.total_plays || 0;
    const totalPasses = stats.total_passes || 0;
    const totalActions = totalPlays + totalPasses;

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Lead Control</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatItem label="Leads Won" value={leadsWon} valueColor="text-green-600" />
                <StatItem label="Total Plays" value={totalPlays} />
                <StatItem label="Lead Success Rate" value={`${leadSuccessRate}%`} valueColor="text-purple-600" />
                <StatItem
                    label="Control Efficiency"
                    value={totalActions > 0 ? `${((leadsWon / totalActions) * 100).toFixed(1)}%` : '0%'}
                    valueColor="text-blue-600"
                />
            </div>
            <div className="mt-4 text-sm text-gray-600">
                <p>
                    <strong>Lead Success Rate:</strong> Percentage of plays that resulted in winning control of the table (all opponents pass).
                </p>
                <p className="mt-1">
                    <strong>Control Efficiency:</strong> Leads won relative to all actions (plays + passes).
                </p>
            </div>
        </div>
    );
};

// Head-to-Head Card Component - Tier 2
const HeadToHeadCard = ({ headToHead }) => {
    if (!headToHead || headToHead.length === 0) {
        return (
            <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
                <h2 className="text-2xl font-bold text-yellow-600 mb-4">Head-to-Head Records</h2>
                <p className="text-gray-500 text-center py-4">
                    Play against other players to build head-to-head records!
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-yellow-600 mb-4">Head-to-Head Records</h2>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b-2 border-gray-300">
                            <th className="py-2 px-3">Opponent</th>
                            <th className="py-2 px-3 text-center">Games</th>
                            <th className="py-2 px-3 text-center">Wins</th>
                            <th className="py-2 px-3 text-center">Losses</th>
                            <th className="py-2 px-3 text-center">Win Rate</th>
                            <th className="py-2 px-3 text-center">Avg Placement Δ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {headToHead.map((record, index) => {
                            const winRate = (record.win_rate * 100).toFixed(1);
                            const avgPlacementDiff = (record.total_placement_diff / record.games_played).toFixed(2);
                            const isPositive = parseFloat(avgPlacementDiff) > 0;

                            return (
                                <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                                    <td className="py-3 px-3 font-semibold">{record.opponent_name}</td>
                                    <td className="py-3 px-3 text-center">{record.games_played}</td>
                                    <td className="py-3 px-3 text-center text-green-600 font-bold">{record.wins}</td>
                                    <td className="py-3 px-3 text-center text-red-600 font-bold">{record.losses}</td>
                                    <td className="py-3 px-3 text-center">
                                        <span className={parseFloat(winRate) >= 50 ? 'text-green-600 font-bold' : 'text-gray-700'}>
                                            {winRate}%
                                        </span>
                                    </td>
                                    <td className="py-3 px-3 text-center">
                                        <span className={isPositive ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                                            {isPositive ? '+' : ''}{avgPlacementDiff}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 text-sm text-gray-600">
                <p>
                    <strong>Avg Placement Δ:</strong> Average placement difference (positive = you finish higher than opponent).
                </p>
            </div>
        </div>
    );
};

// Card Awareness & Decision Efficiency Card - Tier 3
const CardAwarenessCard = ({ stats }) => {
    if (!stats) {
        return (
            <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
                <h2 className="text-2xl font-bold text-purple-600 mb-4">Decision Efficiency</h2>
                <p className="text-gray-500 text-center py-4">No decision data available yet</p>
            </div>
        );
    }

    const totalDecisions = stats.total_decisions || 0;
    const optimalDecisions = stats.optimal_decisions || 0;
    const suboptimalDecisions = stats.suboptimal_decisions || 0;
    const optimalRate = totalDecisions > 0 ? ((optimalDecisions / totalDecisions) * 100).toFixed(1) : '0.0';
    const lateGameAccuracy = ((stats.late_game_accuracy || 0) * 100).toFixed(1);

    const riskyPlaysTotal = (stats.risky_plays_successful || 0) + (stats.risky_plays_failed || 0);
    const riskySuccessRate = riskyPlaysTotal > 0
        ? ((stats.risky_plays_successful / riskyPlaysTotal) * 100).toFixed(1)
        : '0.0';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl border-2 border-purple-400">
            <h2 className="text-2xl font-bold text-purple-600 mb-4">Decision Efficiency</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatItem label="Total Decisions" value={totalDecisions} />
                <StatItem label="Optimal Plays" value={optimalDecisions} valueColor="text-green-600" />
                <StatItem label="Suboptimal Plays" value={suboptimalDecisions} valueColor="text-orange-600" />
                <StatItem
                    label="Optimal Rate"
                    value={`${optimalRate}%`}
                    valueColor={parseFloat(optimalRate) >= 60 ? 'text-green-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Late Game Accuracy"
                    value={`${lateGameAccuracy}%`}
                    valueColor={parseFloat(lateGameAccuracy) >= 50 ? 'text-green-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Risky Play Success"
                    value={`${riskySuccessRate}%`}
                    valueColor={parseFloat(riskySuccessRate) >= 50 ? 'text-green-600' : 'text-red-600'}
                />
            </div>
            <div className="mt-4 text-sm text-gray-600">
                <p><strong>Decision Efficiency:</strong> Measures the quality of your play decisions. Higher optimal rate = better strategic choices.</p>
                <p><strong>Late Game Accuracy:</strong> Your positional advantage in the final stages of rounds.</p>
            </div>
        </div>
    );
};

// Variance & Streak Card - Tier 3
const VarianceCard = ({ stats }) => {
    if (!stats) {
        return (
            <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
                <h2 className="text-2xl font-bold text-blue-600 mb-4">Performance Variance</h2>
                <p className="text-gray-500 text-center py-4">No variance data available yet</p>
            </div>
        );
    }

    const currentStreak = stats.current_streak || 0;
    const longestWinStreak = stats.longest_win_streak || 0;
    const longestLossStreak = stats.longest_loss_streak || 0;
    const luckyWins = stats.lucky_wins || 0;
    const skilledWins = stats.skilled_wins || 0;
    const totalWins = luckyWins + skilledWins;
    const skillRate = totalWins > 0 ? ((skilledWins / totalWins) * 100).toFixed(1) : '0.0';

    // New: Variance and Consistency scores
    const varianceScore = ((stats.variance_score || 0) * 100).toFixed(1);
    const consistencyRating = ((stats.consistency_rating || 0) * 100).toFixed(1);

    const streakDisplay = currentStreak > 0
        ? `+${currentStreak} Win${currentStreak !== 1 ? 's' : ''}`
        : currentStreak < 0
        ? `${currentStreak} Loss${currentStreak !== -1 ? 'es' : ''}`
        : 'No Streak';

    const streakColor = currentStreak > 0 ? 'text-green-600' : currentStreak < 0 ? 'text-red-600' : 'text-gray-700';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl border-2 border-blue-400">
            <h2 className="text-2xl font-bold text-blue-600 mb-4">Performance Variance</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatItem
                    label="Current Streak"
                    value={streakDisplay}
                    valueColor={streakColor}
                />
                <StatItem
                    label="Longest Win Streak"
                    value={longestWinStreak}
                    valueColor="text-green-600"
                />
                <StatItem
                    label="Longest Loss Streak"
                    value={longestLossStreak}
                    valueColor="text-red-600"
                />
                <StatItem label="Skilled Wins" value={skilledWins} valueColor="text-green-600" />
                <StatItem label="Lucky Wins" value={luckyWins} valueColor="text-yellow-600" />
                <StatItem
                    label="Skill Rate"
                    value={`${skillRate}%`}
                    valueColor={parseFloat(skillRate) >= 70 ? 'text-green-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Consistency Rating"
                    value={`${consistencyRating}%`}
                    valueColor={parseFloat(consistencyRating) >= 70 ? 'text-green-600' : parseFloat(consistencyRating) >= 50 ? 'text-yellow-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Variance Score"
                    value={`${varianceScore}%`}
                    valueColor={parseFloat(varianceScore) < 30 ? 'text-green-600' : parseFloat(varianceScore) < 50 ? 'text-yellow-600' : 'text-red-600'}
                />
            </div>
            <div className="mt-4 text-sm text-gray-600">
                <p><strong>Variance Analysis:</strong> Tracks consistency and performance patterns over time.</p>
                <p><strong>Consistency Rating:</strong> Higher is better - shows how reliably you perform.</p>
                <p><strong>Variance Score:</strong> Lower is better - measures performance volatility.</p>
                <p><strong>Skilled vs Lucky Wins:</strong> Wins attributed to strong play vs. fortunate circumstances.</p>
            </div>
        </div>
    );
};

// Behavioral Profile Card - Tier 3
const BehavioralCard = ({ stats }) => {
    if (!stats) {
        return (
            <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl">
                <h2 className="text-2xl font-bold text-indigo-600 mb-4">Player Profile</h2>
                <p className="text-gray-500 text-center py-4">No behavioral data available yet</p>
            </div>
        );
    }

    const aggressionScore = ((stats.aggression_score || 0) * 100).toFixed(1);
    const riskScore = ((stats.risk_score || 0) * 100).toFixed(1);
    const adaptabilityScore = ((stats.adaptability_score || 0) * 100).toFixed(1);
    const archetype = stats.player_archetype || 'Unknown';
    const earlyGameStyle = stats.early_game_style || 'Neutral';
    const lateGameStyle = stats.late_game_style || 'Neutral';

    const archetypeColor = {
        'Aggressive': 'text-red-600',
        'Conservative': 'text-blue-600',
        'Balanced': 'text-green-600',
        'Adaptive': 'text-purple-600'
    }[archetype] || 'text-gray-700';

    return (
        <div className="bg-white text-gray-800 p-6 rounded-xl shadow-2xl border-2 border-indigo-400">
            <h2 className="text-2xl font-bold text-indigo-600 mb-4">Player Profile</h2>

            <div className="mb-6 p-4 bg-indigo-50 rounded-lg">
                <div className="text-center">
                    <div className="text-sm text-gray-600 mb-1">Player Archetype</div>
                    <div className={`text-3xl font-bold ${archetypeColor}`}>{archetype}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatItem
                    label="Aggression Score"
                    value={`${aggressionScore}%`}
                    valueColor={parseFloat(aggressionScore) > 70 ? 'text-red-600' : parseFloat(aggressionScore) < 40 ? 'text-blue-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Risk Score"
                    value={`${riskScore}%`}
                    valueColor={parseFloat(riskScore) > 60 ? 'text-orange-600' : 'text-gray-700'}
                />
                <StatItem
                    label="Adaptability"
                    value={`${adaptabilityScore}%`}
                    valueColor={parseFloat(adaptabilityScore) > 70 ? 'text-green-600' : 'text-gray-700'}
                />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded">
                    <div className="text-sm text-gray-600 mb-1">Early Game</div>
                    <div className="font-bold">{earlyGameStyle}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                    <div className="text-sm text-gray-600 mb-1">Late Game</div>
                    <div className="font-bold">{lateGameStyle}</div>
                </div>
            </div>

            <div className="mt-4 text-sm text-gray-600">
                <p><strong>Behavioral Profile:</strong> AI-classified play style based on decision patterns.</p>
                <p><strong>Archetypes:</strong> Aggressive (high pressure), Conservative (safe play), Balanced (mixed), Adaptive (flexible).</p>
            </div>
        </div>
    );
};

// Reusable Stat Item Component
const StatItem = ({ label, value, valueColor = 'text-gray-900' }) => (
    <div className="text-center">
        <div className="text-sm text-gray-600 mb-1">{label}</div>
        <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
    </div>
);

export default Stats;
