import { useEffect, useSyncExternalStore } from 'react';
import {
    ensureAvatars,
    getAvatarsVersion,
    subscribeAvatars,
    syncOwnAvatar,
} from '../utils/avatars';

// Usernames can contain spaces, NUL can't — so it's a safe join/split separator.
const SEP = '\u0000';

// Makes sure the chosen avatars for `usernames` are loaded, and re-renders the
// component when they arrive. Rendering itself still goes through the
// synchronous getAvatarEmoji/getAvatarTile helpers. Returns a version counter
// that changes whenever a resolved avatar does — pass it to any useMemo that
// caches avatar output so the cache isn't left holding the fallback.
export function useAvatars(usernames) {
    // The array is rebuilt on every render (it's derived from game state), so
    // key the effect on its contents rather than its identity.
    const key = (usernames || []).filter(Boolean).map(String).sort().join(SEP);

    const version = useSyncExternalStore(subscribeAvatars, getAvatarsVersion, getAvatarsVersion);

    useEffect(() => {
        if (key) ensureAvatars(key.split(SEP));
    }, [key]);

    return version;
}

// Reconciles the signed-in user's own avatar with the server once per session.
export function useOwnAvatarSync(user) {
    const { id, username, isGuest } = user || {};
    useEffect(() => {
        if (username) syncOwnAvatar({ id, username, isGuest });
    }, [id, username, isGuest]);
}
