import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityFeedV2 } from './tableV2';

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

    // Reviews are fetched per expanded card, not with the feed page: a review
    // is a few KB and a page is twenty games, almost none of which get opened.
    // Cached by game id so re-expanding the same card is free.
    const [reviews, setReviews] = useState({});

    const loadReview = useCallback(async (gameId) => {
        if (!gameId || reviews[gameId] !== undefined) return;
        // Marked in-flight so a double tap cannot fire two requests.
        setReviews(prev => ({ ...prev, [gameId]: null }));
        try {
            const response = await fetch(`${serverUrl}/api/game/${gameId}/review`);
            if (!response.ok) return;
            const data = await response.json();
            setReviews(prev => ({ ...prev, [gameId]: data.review || null }));
        } catch (err) {
            // A missing review just leaves the plain standings in place.
            console.error('Error fetching round review:', err);
        }
    }, [serverUrl, reviews]);

    // Filter changes always restart at page 1 with a fresh list.
    const applyFilters = (next) => {
        setFilters(next);
        setPage({ number: 1, append: false });
    };

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
            reviews={reviews}
            onExpandGame={loadReview}
            onBack={() => navigate('/lobby')}
            username={user?.username}
        />
    );
};

export default ActivityFeed;