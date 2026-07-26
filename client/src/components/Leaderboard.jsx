import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ArchetypeDialog from './ArchetypeDialog';
import { LeaderboardV2 } from './tableV2';

const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

const Leaderboard = ({ user }) => {
    const [mode, setMode] = useState('short');
    const [sortBy, setSortBy] = useState('rating');
    const [minGames, setMinGames] = useState(0);
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showArchetypeDialog, setShowArchetypeDialog] = useState(false);
    const [selectedArchetype, setSelectedArchetype] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchLeaderboard();
    }, [mode, sortBy, minGames]);

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

    return (
        <>
            <LeaderboardV2
                data={leaderboardData}
                mode={mode}
                onSetMode={setMode}
                user={user}
                loading={loading}
                error={error}
                onBack={() => navigate('/lobby')}
                onPlayerClick={(username) => navigate(`/stats/${username}?mode=${mode}`)}
                sortBy={sortBy}
                onSetSortBy={setSortBy}
                minGames={minGames}
                onSetMinGames={setMinGames}
                onArchetypeClick={handleArchetypeClick}
            />
            <ArchetypeDialog
                isOpen={showArchetypeDialog}
                onClose={() => setShowArchetypeDialog(false)}
                archetype={selectedArchetype}
            />
        </>
    );
};

export default Leaderboard;
