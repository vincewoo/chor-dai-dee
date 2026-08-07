import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveBackTarget } from '../utils/appNav';

// The one way a drill-in screen's back arrow leaves. Back means history —
// leaderboard → a player's stats → back must land on the leaderboard, and a
// chain of opponent pages must unwind one page at a time. Screens used to
// hardcode navigate('/lobby'), which threw the whole stack away.
//
// The decision itself (pop vs replace-to-fallback on the first history entry)
// is resolveBackTarget in utils/appNav.js, pure and pinned by appNav.test.js;
// this hook only binds it to the router.
export function useBackNavigation(fallback = '/lobby') {
    const navigate = useNavigate();
    const { key } = useLocation();
    return useCallback(() => {
        const target = resolveBackTarget(key, fallback);
        if (target.pop) navigate(-1);
        else navigate(target.replaceTo, { replace: true });
    }, [key, navigate, fallback]);
}

export default useBackNavigation;
