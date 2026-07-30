import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { AuthShell, Field, AuthButton, Divider } from './tableV2/LoginV2';

// In production, use same origin; in development, use localhost:3000
const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

// Check if Google OAuth is configured
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const Login = ({ setUser }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    // Google OAuth state
    const [googleFlowStep, setGoogleFlowStep] = useState(null); // null | 'choose' | 'register' | 'link'
    const [googleIdToken, setGoogleIdToken] = useState(null);
    const [googleEmail, setGoogleEmail] = useState('');
    const [suggestedUsername, setSuggestedUsername] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        const endpoint = isRegistering ? `${API_BASE}/api/register` : `${API_BASE}/api/login`;

        try {
            const res = await axios.post(endpoint, { username, password });
            if (res.data.success) {
                setUser(res.data.user);
                navigate('/lobby');
            }
        } catch (err) {
            console.error('Login/Register error:', err);
            console.error('Error response:', err.response);
            console.error('Error message:', err.message);
            setError(err.response?.data?.error || err.message || 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestLogin = () => {
        // Get or create guest user from localStorage for persistence
        let guestUser = localStorage.getItem('guestUser');

        if (guestUser) {
            guestUser = JSON.parse(guestUser);
        } else {
            guestUser = {
                id: null,
                username: `Guest_${Math.floor(1000 + Math.random() * 9000)}`,
                isGuest: true,
                sessionId: crypto.randomUUID(),
            };
            localStorage.setItem('guestUser', JSON.stringify(guestUser));
        }

        setUser(guestUser);
        navigate('/lobby');
    };

    // Handle Google Sign-In success
    const handleGoogleSuccess = async (credentialResponse) => {
        setError('');
        setIsLoading(true);

        try {
            const res = await axios.post(`${API_BASE}/api/auth/google`, {
                idToken: credentialResponse.credential
            });

            if (res.data.success) {
                // Existing Google user - log them in
                setUser(res.data.user);
                navigate('/lobby');
            } else if (res.data.needsAction) {
                // New Google user - show choice dialog
                setGoogleIdToken(credentialResponse.credential);
                setGoogleEmail(res.data.googleEmail || '');
                setSuggestedUsername(res.data.suggestedUsername || '');
                setGoogleFlowStep('choose');
            }
        } catch (err) {
            console.error('Google auth error:', err);
            setError(err.response?.data?.error || 'Google sign-in failed');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle Google Sign-In error
    const handleGoogleError = () => {
        setError('Google sign-in failed. Please try again.');
    };

    // Complete Google registration with chosen username
    const handleGoogleRegister = async (e) => {
        e.preventDefault();
        setError('');

        // Validate client-side first so the user gets a specific message instead
        // of a generic server rejection.
        const name = suggestedUsername.trim();
        if (name.length < 3 || name.length > 20) {
            setError('Username must be 3-20 characters');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(name)) {
            setError('Username can only contain letters, numbers, and underscores');
            return;
        }

        setIsLoading(true);

        try {
            const res = await axios.post(`${API_BASE}/api/auth/google/register`, {
                idToken: googleIdToken,
                username: name
            });

            if (res.data.success) {
                setUser(res.data.user);
                navigate('/lobby');
            }
        } catch (err) {
            console.error('Google registration error:', err);
            setError(err.response?.data?.error || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    // Link Google to existing account
    const handleGoogleLink = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const res = await axios.post(`${API_BASE}/api/auth/google/link`, {
                idToken: googleIdToken,
                username,
                password
            });

            if (res.data.success) {
                setUser(res.data.user);
                navigate('/lobby');
            }
        } catch (err) {
            console.error('Google link error:', err);
            setError(err.response?.data?.error || 'Account linking failed');
        } finally {
            setIsLoading(false);
        }
    };

    // Cancel Google flow and return to main login
    const cancelGoogleFlow = () => {
        setGoogleFlowStep(null);
        setGoogleIdToken(null);
        setGoogleEmail('');
        setSuggestedUsername('');
        setUsername('');
        setPassword('');
        setError('');
    };

    // Google step 2a: new Google user picks a username.
    if (googleFlowStep === 'register') {
        return (
            <AuthShell title="Choose a username" subtitle={`Creating an account with ${googleEmail}`} error={error}>
                <form onSubmit={handleGoogleRegister} className="flex flex-col gap-3">
                    <Field
                        id="google-username"
                        label="Username"
                        hint="3-20 characters: letters, numbers and underscores"
                        type="text"
                        autoFocus
                        required
                        value={suggestedUsername}
                        onChange={(e) => setSuggestedUsername(e.target.value)}
                        disabled={isLoading}
                    />
                    <AuthButton type="submit" disabled={isLoading}>
                        {isLoading ? 'Creating account…' : 'Create account'}
                    </AuthButton>
                </form>
                <AuthButton variant="ghost" onClick={cancelGoogleFlow}>Cancel</AuthButton>
            </AuthShell>
        );
    }

    // Google step 2b: attach Google to an account they already have.
    if (googleFlowStep === 'link') {
        return (
            <AuthShell title="Link your account" subtitle={`Signing in with ${googleEmail}`} error={error}>
                <form onSubmit={handleGoogleLink} className="flex flex-col gap-3">
                    <Field
                        id="link-username"
                        label="Username"
                        type="text"
                        autoFocus
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={isLoading}
                    />
                    <Field
                        id="link-password"
                        label="Password"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                    />
                    <AuthButton type="submit" disabled={isLoading}>
                        {isLoading ? 'Linking account…' : 'Link and sign in'}
                    </AuthButton>
                </form>
                <AuthButton variant="ghost" onClick={cancelGoogleFlow}>Cancel</AuthButton>
            </AuthShell>
        );
    }

    // Google step 1: we have never seen this Google account before.
    if (googleFlowStep === 'choose') {
        return (
            <AuthShell title="Welcome!" subtitle={`Signing in with ${googleEmail}`} error={error}>
                <AuthButton onClick={() => setGoogleFlowStep('register')}>Create a new account</AuthButton>
                <AuthButton variant="secondary" onClick={() => setGoogleFlowStep('link')}>
                    Link an existing account
                </AuthButton>
                <AuthButton variant="ghost" onClick={cancelGoogleFlow}>Cancel</AuthButton>
            </AuthShell>
        );
    }

    // Main login / register form.
    return (
        <AuthShell
            title={isRegistering ? 'Create an account' : 'Welcome back'}
            subtitle={isRegistering ? 'Your stats and rank follow the account.' : "Let's blast some 2s!"}
            error={error}
            footer={
                <button
                    onClick={() => setIsRegistering(!isRegistering)}
                    style={{ background: 'none', border: 'none', color: 'rgba(244,245,247,.55)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}
                >
                    {isRegistering ? 'Already have an account? Log in' : 'Need an account? Register'}
                </button>
            }
        >
            <AuthButton variant="secondary" onClick={handleGuestLogin}>
                Play as guest
            </AuthButton>

            {GOOGLE_CLIENT_ID && (
                <div className="flex justify-center">
                    <GoogleLogin
                        onSuccess={handleGoogleSuccess}
                        onError={handleGoogleError}
                        useOneTap={false}
                        theme="filled_black"
                        size="large"
                        width="100%"
                        text="signin_with"
                        shape="rectangular"
                    />
                </div>
            )}

            <Divider />

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <Field
                    id="username"
                    label="Username"
                    type="text"
                    autoFocus
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                />
                <div className="relative">
                    <Field
                        id="password"
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        style={{ position: 'absolute', right: 12, bottom: 12, background: 'none', border: 'none', color: 'rgba(244,245,247,.55)', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}
                    >
                        {showPassword ? '🙈' : '👁'}
                    </button>
                </div>
                <AuthButton type="submit" disabled={isLoading} aria-busy={isLoading}>
                    {isLoading
                        ? (isRegistering ? 'Signing up…' : 'Logging in…')
                        : (isRegistering ? 'Sign up' : 'Log in')}
                </AuthButton>
            </form>
        </AuthShell>
    );
};

export default Login;
