import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Field, AuthButton } from './tableV2/LoginV2';
import { ProfileShell, Section, InfoRow } from './tableV2/ProfileV2';

// In production, use same origin; in development, use localhost:3000
const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Account settings. Every mutation here carries its own proof of ownership --
// the current password, or a Google token already linked to the row -- because
// the app has no session to lean on (see the ACCOUNT / PROFILE ROUTES comment in
// server/index.js). That is why each form asks for a password even though you
// are visibly logged in.
function Profile({ user, setUser }) {
    const navigate = useNavigate();
    const [account, setAccount] = useState(null);
    const [loadError, setLoadError] = useState('');

    // Each card reports its own outcome; a rename succeeding must not render as
    // a confirmation on the password card.
    const [status, setStatus] = useState({});
    const [busy, setBusy] = useState('');

    const [newUsername, setNewUsername] = useState('');
    const [namePassword, setNamePassword] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [googlePassword, setGooglePassword] = useState('');

    // Holds a freshly-minted Google token between "Sign in with Google" and the
    // request that spends it -- for linking, and as proof when a Google-only
    // account sets its first password.
    const [googleIdToken, setGoogleIdToken] = useState(null);

    const setCardStatus = (card, kind, message) =>
        setStatus((prev) => ({ ...prev, [card]: kind ? { kind, message } : null }));
    const clearCardStatus = (card) => setCardStatus(card, null, null);

    const loadAccount = useCallback(async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/account/${user.id}`);
            setAccount(res.data);
            setNewUsername(res.data.username);
            setLoadError('');
        } catch (err) {
            setLoadError(err.response?.data?.error || 'Could not load your account');
        }
    }, [user.id]);

    useEffect(() => { loadAccount(); }, [loadAccount]);

    const handleRename = async (e) => {
        e.preventDefault();
        clearCardStatus('username');
        setBusy('username');
        try {
            const res = await axios.post(`${API_BASE}/api/account/${user.id}/username`, {
                newUsername: newUsername.trim(),
                password: namePassword,
            });
            // The name is the identity the rest of the app renders from, so push
            // it through the same setter login uses rather than reloading.
            setUser({ ...user, username: res.data.user.username });
            setAccount((prev) => ({ ...prev, username: res.data.user.username }));
            setNamePassword('');
            setCardStatus('username', 'success', 'Username updated. Past games now show the new name.');
        } catch (err) {
            setCardStatus('username', 'error', err.response?.data?.error || 'Could not change your username');
        } finally {
            setBusy('');
        }
    };

    const handlePassword = async (e) => {
        e.preventDefault();
        clearCardStatus('password');

        if (newPassword !== confirmPassword) {
            setCardStatus('password', 'error', 'The two passwords do not match');
            return;
        }

        setBusy('password');
        try {
            await axios.post(`${API_BASE}/api/account/${user.id}/password`, {
                newPassword,
                // A Google-only account has no current password to send; the
                // server takes a linked Google token as proof instead.
                ...(account.hasPassword ? { currentPassword } : { idToken: googleIdToken }),
            });
            setAccount((prev) => ({ ...prev, hasPassword: true }));
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setGoogleIdToken(null);
            setCardStatus('password', 'success', 'Password saved.');
        } catch (err) {
            setCardStatus('password', 'error', err.response?.data?.error || 'Could not change your password');
        } finally {
            setBusy('');
        }
    };

    const handleGoogleLink = async (credentialResponse) => {
        clearCardStatus('google');

        if (!googlePassword) {
            // Stash the token so the password field can be filled in after the
            // Google popup rather than before it.
            setGoogleIdToken(credentialResponse.credential);
            setCardStatus('google', 'error', 'Enter your password to confirm, then press Link.');
            return;
        }

        await linkWithToken(credentialResponse.credential);
    };

    const linkWithToken = async (idToken) => {
        setBusy('google');
        try {
            const res = await axios.post(`${API_BASE}/api/account/${user.id}/google/link`, {
                idToken,
                password: googlePassword,
            });
            setAccount((prev) => ({
                ...prev,
                googleLinked: true,
                googleEmailMasked: res.data.googleEmailMasked,
            }));
            setGooglePassword('');
            setGoogleIdToken(null);
            setCardStatus('google', 'success', 'Google account linked. You can sign in with it from now on.');
        } catch (err) {
            setCardStatus('google', 'error', err.response?.data?.error || 'Could not link your Google account');
        } finally {
            setBusy('');
        }
    };

    const handleGoogleUnlink = async () => {
        clearCardStatus('google');
        setBusy('google');
        try {
            await axios.post(`${API_BASE}/api/account/${user.id}/google/unlink`, {
                password: googlePassword,
            });
            setAccount((prev) => ({ ...prev, googleLinked: false, googleEmailMasked: null }));
            setGooglePassword('');
            setCardStatus('google', 'success', 'Google account unlinked.');
        } catch (err) {
            setCardStatus('google', 'error', err.response?.data?.error || 'Could not unlink your Google account');
        } finally {
            setBusy('');
        }
    };

    if (!account) {
        return (
            <ProfileShell title="Profile" onBack={() => navigate('/lobby')}>
                <Section title={loadError ? 'Something went wrong' : 'Loading…'} status={loadError ? { kind: 'error', message: loadError } : null} />
            </ProfileShell>
        );
    }

    const nameUnchanged = newUsername.trim() === account.username;

    return (
        <ProfileShell title="Profile" subtitle={account.username} onBack={() => navigate('/lobby')}>
            <Section
                title="Display name"
                description="This is the name other players see, and the name your past games are listed under."
                status={status.username}
            >
                <form onSubmit={handleRename} className="flex flex-col gap-3">
                    <Field
                        id="profile-username"
                        label="Username"
                        hint="3-20 characters: letters, numbers and underscores"
                        type="text"
                        required
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        disabled={busy === 'username'}
                    />
                    {account.hasPassword && (
                        <Field
                            id="profile-name-password"
                            label="Confirm with your password"
                            type="password"
                            required
                            value={namePassword}
                            onChange={(e) => setNamePassword(e.target.value)}
                            disabled={busy === 'username'}
                        />
                    )}
                    <AuthButton type="submit" disabled={busy === 'username' || nameUnchanged}>
                        {busy === 'username' ? 'Saving…' : 'Save username'}
                    </AuthButton>
                </form>
            </Section>

            <Section
                title={account.hasPassword ? 'Password' : 'Set a password'}
                description={account.hasPassword
                    ? 'Used to sign in without Google, and to confirm changes on this page.'
                    : 'Your account signs in with Google only. Adding a password gives you a second way in — and is required before you can unlink Google.'}
                status={status.password}
            >
                <form onSubmit={handlePassword} className="flex flex-col gap-3">
                    {account.hasPassword && (
                        <Field
                            id="profile-current-password"
                            label="Current password"
                            type="password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={busy === 'password'}
                        />
                    )}
                    <Field
                        id="profile-new-password"
                        label="New password"
                        hint="At least 6 characters"
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={busy === 'password'}
                    />
                    <Field
                        id="profile-confirm-password"
                        label="Confirm new password"
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={busy === 'password'}
                    />
                    {!account.hasPassword && !googleIdToken && GOOGLE_CLIENT_ID && (
                        <>
                            <div style={{ color: 'rgba(244,245,247,.55)', fontSize: 12, fontWeight: 600 }}>
                                Confirm it's you with the Google account on this profile:
                            </div>
                            <div className="flex justify-center">
                                <GoogleLogin
                                    onSuccess={(cred) => {
                                        setGoogleIdToken(cred.credential);
                                        setCardStatus('password', 'success', 'Confirmed. Now choose your password.');
                                    }}
                                    onError={() => setCardStatus('password', 'error', 'Google sign-in failed')}
                                    useOneTap={false}
                                    theme="filled_black"
                                    size="large"
                                    text="continue_with"
                                    shape="rectangular"
                                />
                            </div>
                        </>
                    )}
                    <AuthButton
                        type="submit"
                        disabled={busy === 'password' || (!account.hasPassword && !googleIdToken)}
                    >
                        {busy === 'password' ? 'Saving…' : account.hasPassword ? 'Change password' : 'Set password'}
                    </AuthButton>
                </form>
            </Section>

            {GOOGLE_CLIENT_ID && (
                <Section
                    title="Google"
                    description={account.googleLinked
                        ? 'Sign in with one tap, no password needed.'
                        : 'Link your Google account to sign in with one tap.'}
                    status={status.google}
                >
                    <InfoRow
                        label="Status"
                        value={account.googleLinked ? (account.googleEmailMasked || 'Linked') : 'Not linked'}
                        tone={account.googleLinked ? 'default' : 'muted'}
                    />

                    {account.hasPassword && (
                        <Field
                            id="profile-google-password"
                            label="Confirm with your password"
                            type="password"
                            value={googlePassword}
                            onChange={(e) => setGooglePassword(e.target.value)}
                            disabled={busy === 'google'}
                        />
                    )}

                    {account.googleLinked ? (
                        <AuthButton
                            variant="secondary"
                            onClick={handleGoogleUnlink}
                            disabled={busy === 'google' || !account.hasPassword}
                        >
                            {busy === 'google' ? 'Unlinking…' : 'Unlink Google'}
                        </AuthButton>
                    ) : googleIdToken ? (
                        <AuthButton onClick={() => linkWithToken(googleIdToken)} disabled={busy === 'google'}>
                            {busy === 'google' ? 'Linking…' : 'Link Google account'}
                        </AuthButton>
                    ) : (
                        <div className="flex justify-center">
                            <GoogleLogin
                                onSuccess={handleGoogleLink}
                                onError={() => setCardStatus('google', 'error', 'Google sign-in failed')}
                                useOneTap={false}
                                theme="filled_black"
                                size="large"
                                text="continue_with"
                                shape="rectangular"
                            />
                        </div>
                    )}

                    {account.googleLinked && !account.hasPassword && (
                        <div style={{ color: 'rgba(244,245,247,.55)', fontSize: 12, fontWeight: 600 }}>
                            Set a password above before unlinking — Google is currently your only way in.
                        </div>
                    )}
                </Section>
            )}

            <Section title="Avatar" description="The animal and tile other players see next to your name.">
                <InfoRow
                    label="Avatar"
                    value="Pick your animal and tile"
                    action={
                        <button
                            onClick={() => navigate('/avatar')}
                            style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                        >
                            Change
                        </button>
                    }
                />
            </Section>
        </ProfileShell>
    );
}

export default Profile;
