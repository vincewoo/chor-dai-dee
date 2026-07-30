// Avatars are an emoji animal on a coloured tile. A player picks theirs in the
// Avatar Picker; the choice is stored server-side (see POST /api/avatar) so
// everyone at the table sees the same avatar for them. Names with no chosen
// avatar — bots, guests, players who never opened the picker — fall back to a
// deterministic avatar derived from the name.
//
// Rendering is synchronous (`getAvatarEmoji(name)`), so chosen avatars live in
// a module-level registry that components fill via the `useAvatars` hook.

import { getApiUrl } from './api.js';

const ANIMALS = [
    '🐯', '🦊', '🐼', '🐰', '🐸', '🦁', '🐨', '🐷',
    '🐙', '🦉', '🐺', '🐮', '🐵', '🦄', '🐻', '🐹',
    '🦖', '🐳', '🦜', '🐢', '🦔', '🐴', '🐬', '🦩',
];

// Animal set surfaced in the Avatar Picker grid (mirrors the v2 mockup).
// Kept in sync with AVATAR_ANIMALS in server/avatars.js, which validates saves.
export const PICKER_ANIMALS = ['🐯', '🐼', '🐰', '🦊', '🐸', '🦉', '🐱', '🐧', '🐢', '🐨', '🦁', '🐹'];

// Tile-colour gradients for avatar backgrounds (mirrors the v2 mockup).
export const TILE_GRADS = [
    'linear-gradient(145deg,#fff7e8,#ede3cd)',
    'linear-gradient(145deg,#ffffff,#dfe5ea)',
    'linear-gradient(145deg,#fff2f4,#eddade)',
    'linear-gradient(145deg,#f0f4ff,#dde4f0)',
    'linear-gradient(145deg,#eefbf3,#d8ecdf)',
];

// Each picker animal has one playful display name. These labels add character
// to the picker; player identity everywhere else continues to use the username.
export const AVATAR_NAMES = {
    '🐯': 'Tai Pan Tiger',
    '🐼': 'Bamboo Baron',
    '🐰': 'Lucky Hopper',
    '🦊': 'Sly Shuffler',
    '🐸': 'Ribbit Royale',
    '🦉': 'Night Knower',
    '🐱': 'Kopi Cat',
    '🐧': 'Tuxedo Trickster',
    '🐢': 'Slow Burn',
    '🐨': 'Koala-ty Cards',
    '🦁': 'Mane Event',
    '🐹': 'Pocket Rocket',
};

// djb2 string hash → non-negative integer
function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Registry of chosen avatars, keyed by username.
// Entries are `{ avatar, at }`, where a null avatar means "asked the server,
// this player has no chosen avatar" — that's what stops us asking again for
// bots and never-picked accounts. Entries go stale after CACHE_TTL_MS so a
// player who changes their avatar mid-session is picked up by the next screen
// that renders them, without a reload.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 2 * 60 * 1000;

const registry = new Map();
const listeners = new Set();
let version = 0;

// Names queued for the next batched lookup, and those already asked for.
let queued = new Set();
let flushHandle = null;

function notify() {
    version += 1;
    listeners.forEach((fn) => fn());
}

export function subscribeAvatars(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getAvatarsVersion() {
    return version;
}

// Records a resolved lookup (or a locally made choice, which is resolved as far
// as this device is concerned).
function remember(username, avatar) {
    registry.set(String(username), { avatar: avatar || null, at: Date.now() });
}

async function flushQueue() {
    flushHandle = null;
    const names = [...queued];
    queued = new Set();
    if (names.length === 0) return;

    try {
        const res = await fetch(getApiUrl(`/avatars?usernames=${names.map(encodeURIComponent).join(',')}`));
        if (!res.ok) throw new Error(`avatar lookup failed: ${res.status}`);
        const { avatars = {} } = await res.json();
        // Record misses too — that's what makes this a cache rather than a
        // request per render for every bot at the table. A miss on your own
        // name is harmless: the local choice below still covers it.
        names.forEach((name) => remember(name, avatars[name]));
        notify();
    } catch (err) {
        // Leave the names unresolved so the next mount retries; until then the
        // deterministic fallback avatar is shown.
        console.error('Error loading avatars:', err);
    }
}

// Queues a lookup for any username we haven't resolved recently. Safe to call
// on every render — fresh names are dropped and the rest are coalesced into one
// request per tick. A stale entry keeps rendering until its refresh lands, so
// this never flickers back to the fallback avatar.
export function ensureAvatars(usernames) {
    const now = Date.now();
    let added = false;
    (usernames || []).forEach((raw) => {
        const name = String(raw || '');
        if (!name || queued.has(name)) return;
        const cached = registry.get(name);
        if (cached && now - cached.at < CACHE_TTL_MS) return;
        queued.add(name);
        added = true;
    });
    if (added && flushHandle === null) {
        flushHandle = setTimeout(flushQueue, 0);
    }
}

const STORE_KEY = 'avatarChoice';

// Reads the current user's saved avatar override, if any. Kept in localStorage
// as well as on the server so your own avatar renders instantly at startup and
// still works while signed out or offline.
// Shape: { owner, animal, tile (index into TILE_GRADS) }.
export function getAvatarChoice() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function saveAvatarChoice(choice) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(choice));
    } catch {
        /* ignore */
    }
    if (choice?.owner) {
        remember(choice.owner, { animal: choice.animal, tile: choice.tile });
    }
    // Let same-tab listeners (identity cards, seats) react immediately.
    notify();
    try {
        window.dispatchEvent(new Event('avatarchoice'));
    } catch {
        /* ignore */
    }
}

// Pushes the picked avatar to the server so other players see it. Guests have
// no account to attach it to, so theirs stays local.
export async function persistAvatarChoice(user, { animal, tile }) {
    if (!user?.id || user.isGuest) return false;
    try {
        const res = await fetch(getApiUrl(`/avatar/${user.id}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ animal, tile }),
        });
        return res.ok;
    } catch (err) {
        console.error('Error saving avatar:', err);
        return false;
    }
}

// Reconciles the signed-in user's own avatar between this device and the
// server: the server wins if it has one, otherwise a choice made on this device
// (or before avatars were stored server-side) is uploaded.
export async function syncOwnAvatar(user) {
    const username = user?.username;
    if (!username) return;

    const local = getAvatarChoice();
    const localMine = local?.owner === username && local.animal ? local : null;
    if (localMine) {
        remember(username, { animal: localMine.animal, tile: localMine.tile ?? 0 });
        notify();
    }
    if (!user.id || user.isGuest) return;

    try {
        const res = await fetch(getApiUrl(`/avatars?usernames=${encodeURIComponent(username)}`));
        if (!res.ok) throw new Error(`avatar lookup failed: ${res.status}`);
        const { avatars = {} } = await res.json();
        const remote = avatars[username];
        if (remote) {
            remember(username, remote);
            // Mirror it locally so the next start renders it before any fetch.
            saveAvatarChoice({ ...(localMine || {}), owner: username, animal: remote.animal, tile: remote.tile });
        } else if (localMine) {
            await persistAvatarChoice(user, { animal: localMine.animal, tile: localMine.tile ?? 0 });
        } else {
            remember(username, null);
            notify();
        }
    } catch (err) {
        console.error('Error syncing avatar:', err);
    }
}

// Resolves the chosen avatar for a username, if there is one.
function chosenAvatar(username) {
    const cached = registry.get(username);
    if (cached?.avatar) return cached.avatar;
    // Before the lookup resolves, the local choice covers the current user.
    const choice = getAvatarChoice();
    if (choice?.owner === username && choice.animal) {
        return { animal: choice.animal, tile: choice.tile };
    }
    return null;
}

// Resolves the emoji for a username: the avatar they chose if we know it,
// otherwise one derived deterministically from the name.
export function getAvatarEmoji(username = '') {
    const key = String(username || '');
    if (!key) return ANIMALS[0];
    const chosen = chosenAvatar(key);
    if (chosen?.animal) return chosen.animal;
    return ANIMALS[hash(key) % ANIMALS.length];
}

// Resolves the tile-gradient for a username (chosen avatar wins, else derived).
export function getAvatarTile(username = '') {
    const key = String(username || '');
    const chosen = chosenAvatar(key);
    if (chosen && Number.isInteger(chosen.tile)) return TILE_GRADS[chosen.tile];
    return TILE_GRADS[hash(key || 'x') % TILE_GRADS.length];
}
