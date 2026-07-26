import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TrainingV2 } from './tableV2';
import { useUserPreferences } from '../contexts/UserPreferencesContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

/**
 * Container for the training page. Fetching only; TrainingV2 renders.
 *
 * Topic and mode live in the query string so a stats link can point straight at
 * one, and so a shared or bookmarked link opens on the same thing.
 */
const Training = ({ user }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { fourColorMode } = useUserPreferences();

    const topic = searchParams.get('topic') || 'mistakes';
    const mode = searchParams.get('mode') || '';

    const [result, setResult] = useState(null);
    const key = `${topic}:${mode}`;
    const settled = result?.forKey === key;

    useEffect(() => {
        if (!user?.username) return undefined;

        let cancelled = false;
        axios
            .get(`${API_BASE}/api/review/examples/${user.username}`, {
                params: { topic, ...(mode ? { mode } : {}) },
            })
            .then((res) => {
                if (!cancelled) setResult({ forKey: key, data: res.data });
            })
            .catch((err) => {
                if (cancelled) return;
                setResult({
                    forKey: key,
                    error: err.response?.data?.error || 'Failed to load examples',
                });
            });

        return () => { cancelled = true; };
    }, [key, topic, mode, user?.username]);

    if (!user) {
        navigate('/');
        return null;
    }

    const data = settled ? result.data : null;

    return (
        <TrainingV2
            topic={topic}
            onSetTopic={(next) => {
                const params = { topic: next };
                if (mode) params.mode = mode;
                setSearchParams(params);
            }}
            examples={data?.examples || []}
            gamesSearched={data?.gamesSearched || 0}
            totalFound={data?.totalFound || 0}
            fourColor={fourColorMode}
            loading={!settled}
            error={settled ? result.error : ''}
            onBack={() => navigate(-1)}
            onOpenGame={(gameId) => navigate(`/review/${gameId}`)}
        />
    );
};

export default Training;
