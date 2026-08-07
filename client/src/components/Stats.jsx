import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { StatsV2 } from './tableV2';
import { useBackNavigation } from '../hooks/useBackNavigation';
import { useLogout } from '../hooks/useLogout';

const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

const Stats = ({ user, setUser }) => {
    const { username: urlUsername } = useParams();
    const [searchParams] = useSearchParams();
    const initialMode = searchParams.get('mode') || 'short';
    const [mode, setMode] = useState(initialMode);
    const [stats, setStats] = useState(null);
    const [headToHead, setHeadToHead] = useState([]);
    const [tier3Stats, setTier3Stats] = useState(null);
    const [handStrength, setHandStrength] = useState(null);
    const [playerRank, setPlayerRank] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const goBack = useBackNavigation();
    // "Create an account" for a guest must shed the guest identity before
    // heading to `/` — the login route redirects any truthy user (guests
    // included) straight back to /lobby, so a bare navigate('/') bounces.
    const leaveGuestSession = useLogout(setUser);

    // Use URL username if provided, otherwise use logged-in user's username
    const viewingUsername = urlUsername || user?.username;

    // Update mode when URL parameter changes
    useEffect(() => {
        const modeFromUrl = searchParams.get('mode') || 'short';
        setMode(modeFromUrl);
    }, [searchParams]);

    useEffect(() => {
        if (viewingUsername) {
            fetchStats();
        }
    }, [mode, viewingUsername]);

        const fetchStats = async () => {
        setLoading(true);
        setError('');
        try {
            const [statsRes, h2hRes, tier3Res, rankRes, dealRes] = await Promise.all([
                axios.get(`${API_BASE}/api/stats/${viewingUsername}/detailed?mode=${mode}`),
                axios.get(`${API_BASE}/api/stats/${viewingUsername}/head-to-head?mode=${mode}`),
                axios.get(`${API_BASE}/api/stats/${viewingUsername}/tier3?mode=${mode}`),
                axios.get(`${API_BASE}/api/leaderboard/${viewingUsername}/rank?mode=${mode}&sortBy=rating`).catch(() => ({ data: { rank: null } })),
                axios.get(`${API_BASE}/api/stats/${viewingUsername}/hand-strength?mode=${mode}`).catch(() => ({ data: null }))
            ]);
            setStats(statsRes.data);
            setHeadToHead(h2hRes.data.headToHead || []);
            setTier3Stats(tier3Res.data);
            setPlayerRank(rankRes.data.rank);
            setHandStrength(dealRes.data);
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
        <StatsV2
                username={viewingUsername}
                isSelf={!urlUsername || urlUsername === user.username}
                isGuest={!!user.isGuest}
                mode={mode}
                onSetMode={setMode}
                stats={stats}
                headToHead={headToHead}
                tier3={tier3Stats}
                handStrength={handStrength}
                rank={playerRank}
                loading={loading}
                error={error}
                // Own stats (/stats) is a tab root — the tab bar is how you
                // leave, so there is no arrow. Another player's page is a
                // drill-in, and back means the page you drilled in from
                // (leaderboard, head-to-head, ...), not the lobby.
                onBack={urlUsername ? goBack : null}
                onViewMyStats={() => navigate(`/stats?mode=${mode}`)}
                onOpponentClick={(name) => navigate(`/stats/${name}?mode=${mode}`)}
            onCreateAccount={leaveGuestSession}
            // Guests have no tape attributed to them, so there is nothing to
            // draw examples from.
            onExamples={user?.isGuest
                ? null
                : (topic) => navigate(`/training?topic=${topic}&mode=${mode}`)}
        />
    );
};

export default Stats;
