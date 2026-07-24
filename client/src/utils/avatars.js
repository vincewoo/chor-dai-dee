// Deterministic animal-emoji avatars derived from a username, with an optional
// per-user override chosen in the Avatar Picker (stored client-side in
// localStorage — no server avatar field yet).

const ANIMALS = [
    '🐯', '🦊', '🐼', '🐰', '🐸', '🦁', '🐨', '🐷',
    '🐙', '🦉', '🐺', '🐮', '🐵', '🦄', '🐻', '🐹',
    '🦖', '🐳', '🦜', '🐢', '🦔', '🐴', '🐬', '🦩',
];

// Animal set surfaced in the Avatar Picker grid (mirrors the v2 mockup).
export const PICKER_ANIMALS = ['🐯', '🐼', '🐰', '🦊', '🐸', '🦉', '🐱', '🐧', '🐢', '🐨', '🦁', '🐹'];

// Tile-colour gradients for avatar backgrounds (mirrors the v2 mockup).
export const TILE_GRADS = [
    'linear-gradient(145deg,#fff7e8,#ede3cd)',
    'linear-gradient(145deg,#ffffff,#dfe5ea)',
    'linear-gradient(145deg,#fff2f4,#eddade)',
    'linear-gradient(145deg,#f0f4ff,#dde4f0)',
    'linear-gradient(145deg,#eefbf3,#d8ecdf)',
];

// Themed name suggestions used by the picker's 🎲 generator.
export const NAME_POOLS = {
    '🐯': ['Tai Pan Tiger', 'Stripe Master', 'Roaring Riches'],
    '🐼': ['Bamboo Baron', 'Panda Express', 'Chill Chomper'],
    '🐰': ['Lucky Hopper', 'Carrot Countess', 'Bunny Bluff'],
    '🦊': ['Sly Shuffler', 'Foxy Flush', 'Clever Kit'],
    '🐸': ['Pond Prince', 'Leap of Faith', 'Ribbit Royale'],
    '🦉': ['Night Knower', 'Wise Winner', 'Hoot Hustler'],
    '🐱': ['Kopi Cat', 'Whisker Wager', 'Purrfect Play'],
    '🐧': ['Tuxedo Trickster', 'Ice Dealer', 'Waddle Winner'],
    '🐢': ['Steady Stacker', 'Shell Shark', 'Slow Burn'],
    '🐨': ['Eucalyptus Ace', 'Nap Master', 'Koala-ty Cards'],
    '🦁': ['Mane Event', 'Pride Player', 'Royal Roar'],
    '🐹': ['Pocket Rocket', 'Cheek Stash', 'Tiny Titan'],
};

// djb2 string hash → non-negative integer
function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

const STORE_KEY = 'avatarChoice';

// Reads the current user's saved avatar override, if any.
// Shape: { animal, tile (index into TILE_GRADS), name }.
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
        // Let same-tab listeners (identity cards) react immediately.
        window.dispatchEvent(new Event('avatarchoice'));
    } catch {
        /* ignore */
    }
}

// Resolves the emoji for a username. If `username` matches the saved override's
// owner it uses the chosen animal; otherwise (or for other players) it derives
// deterministically from the name.
export function getAvatarEmoji(username = '') {
    const key = String(username || '');
    if (!key) return ANIMALS[0];
    const choice = getAvatarChoice();
    if (choice?.owner === key && choice.animal) return choice.animal;
    return ANIMALS[hash(key) % ANIMALS.length];
}

// Resolves the tile-gradient for a username (override wins, else deterministic).
export function getAvatarTile(username = '') {
    const key = String(username || '');
    const choice = getAvatarChoice();
    if (choice?.owner === key && Number.isInteger(choice.tile)) return TILE_GRADS[choice.tile];
    return TILE_GRADS[hash(key || 'x') % TILE_GRADS.length];
}
