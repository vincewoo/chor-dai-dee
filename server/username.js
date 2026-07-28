// Rules for every path that can set a username or password: registration, the
// Google signup flow, and the profile rename. These lived inline in two
// endpoints and nowhere at all in a third (`createUser` validated nothing), so
// which rules applied depended on which door you came through. A rename that
// accepts a name registration would reject is how the database reaches a state
// the rest of the app assumes is impossible.

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;

// Guest seats are auto-named `Guest_1234` (see `handleGuestLogin` in
// client/src/components/Login.jsx) and recorded in `game_participants` with a
// NULL user_id -- sharing the UNIQUE(game_id, username) key with account rows.
// An account allowed to hold a guest-shaped name could therefore collide with
// its own history on rename, and could impersonate a guest besides. The prefix
// is inside the legal charset, so reserving it is the only thing that stops it.
const RESERVED_PREFIXES = ['guest_'];

// Returns `{ ok: true, username }` with the trimmed name, or `{ ok: false, error }`
// carrying a message meant to be shown to the player as-is.
function validateUsername(raw) {
    const username = typeof raw === 'string' ? raw.trim() : '';

    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
        return { ok: false, error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters` };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return { ok: false, error: 'Username can only contain letters, numbers, and underscores' };
    }
    if (RESERVED_PREFIXES.some((prefix) => username.toLowerCase().startsWith(prefix))) {
        return { ok: false, error: 'Usernames beginning with "Guest_" are reserved' };
    }
    return { ok: true, username };
}

function validatePassword(raw) {
    const password = typeof raw === 'string' ? raw : '';
    if (password.length < PASSWORD_MIN) {
        return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters` };
    }
    return { ok: true, password };
}

module.exports = {
    USERNAME_MIN,
    USERNAME_MAX,
    PASSWORD_MIN,
    validateUsername,
    validatePassword,
};
