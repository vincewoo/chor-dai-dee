import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import logoImage from '../assets/chor-dai-dee-logo.png';

// In production, use same origin; in development, use localhost:3000
const API_BASE = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

const Login = ({ setUser }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

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

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-800 text-white">
            <img src={logoImage} alt="Chor Dai Dee Logo" className="w-60 mb-4" />
            <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl w-96">
                {/* Guest Login Button */}
                <button
                    onClick={handleGuestLogin}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-bold mb-4 flex items-center justify-center gap-2"
                >
                    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    Play as Guest
                </button>

                <div className="flex items-center my-4">
                    <div className="flex-1 border-t border-gray-300"></div>
                    <span className="px-3 text-gray-500 text-sm">OR</span>
                    <div className="flex-1 border-t border-gray-300"></div>
                </div>

                <h2 className="text-2xl font-bold mb-4 text-center">{isRegistering ? 'Register' : 'Login'}</h2>
                {error && (
                    <div role="alert" aria-live="polite" className="bg-red-100 text-red-700 p-2 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            placeholder="Username"
                            autoFocus
                            required
                            className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            disabled={isLoading}
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            placeholder="Password"
                            required
                            className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            disabled={isLoading}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        aria-disabled={isLoading}
                        className={`w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition font-bold flex justify-center items-center ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                {isRegistering ? 'Signing Up...' : 'Logging In...'}
                            </>
                        ) : (
                            isRegistering ? 'Sign Up' : 'Log In'
                        )}
                    </button>
                </form>
                <div className="mt-4 text-center text-sm">
                    <button onClick={() => setIsRegistering(!isRegistering)} className="text-green-600 hover:underline">
                        {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Login;
