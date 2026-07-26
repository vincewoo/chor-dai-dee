import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { GameReviewV2 } from './tableV2';
import { useUserPreferences } from '../contexts/UserPreferencesContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

/**
 * Container for the post-game review. Fetching only; GameReviewV2 renders.
 *
 * The server declines for several ordinary reasons - the game predates logging,
 * it aged out of retention, it is still in progress - so the `reason` is kept
 * alongside the message and handed down. Those are not failures to apologise
 * for, and the page words each one differently.
 */
const GameReview = ({ user }) => {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const { fourColorMode } = useUserPreferences();

    // One settled result rather than three flags. It carries the id it was
    // fetched for, so "the route changed and the new fetch has not landed" is
    // read off the render rather than written by a synchronous reset in the
    // effect - which is a cascading render, and which the linter rejects.
    const [result, setResult] = useState(null);
    const settled = result?.forGameId === gameId;

    useEffect(() => {
        if (!gameId || !user?.username) return undefined;

        let cancelled = false;
        let timer = null;

        // The server closes the game's tape just after it emits game_over, so
        // arriving straight from the game-over screen can beat the write by a
        // few hundred milliseconds and read as "still in progress". One retry
        // covers that window; a genuinely unfinished game still reports it.
        const load = (retriesLeft) => axios
            .get(`${API_BASE}/api/review/${gameId}`, { params: { username: user.username } })
            .then((res) => {
                if (!cancelled) setResult({ forGameId: gameId, review: res.data });
            })
            .catch((err) => {
                if (cancelled) return;
                const reason = err.response?.data?.reason || '';
                if (reason === 'game_in_progress' && retriesLeft > 0) {
                    timer = setTimeout(() => load(retriesLeft - 1), 1500);
                    return;
                }
                setResult({
                    forGameId: gameId,
                    error: err.response?.data?.error || 'Failed to load the review',
                    errorReason: reason,
                });
            });

        load(1);

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [gameId, user?.username]);

    const review = settled ? result.review : null;

    if (!user) {
        navigate('/');
        return null;
    }

    return (
        <GameReviewV2
            highlights={review?.highlights || []}
            summary={review?.summary}
            gameMode={review?.gameMode}
            totalRounds={review?.totalRounds}
            fourColor={fourColorMode}
            loading={!settled}
            error={settled ? result.error : ''}
            errorReason={settled ? result.errorReason : ''}
            onBack={() => navigate(-1)}
        />
    );
};

export default GameReview;
