import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import logoImage from '../assets/chor-dai-dee-logo.png';

// In production, use same origin; in development, use localhost:3000
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

const Login = ({ setUser }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const endpoint = isRegistering ? `${API_BASE}/api/register` : `${API_BASE}/api/login`;

        try {
            const res = await axios.post(endpoint, { username, password });
            if (res.data.success) {
                setUser(res.data.user);
                navigate('/lobby');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'An error occurred');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white">
            <img src={logoImage} alt="Chor Dai Dee Logo" className="w-60 mb-4" />
            <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl w-96">
                <h2 className="text-2xl font-bold mb-4 text-center">{isRegistering ? 'Register' : 'Login'}</h2>
                {error && (
                    <div role="alert" aria-live="polite" className="bg-red-100 text-red-700 p-2 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="text"
                        aria-label="Username"
                        placeholder="Username"
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                    />
                    <input
                        type="password"
                        aria-label="Password"
                        placeholder="Password"
                        className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                    <button type="submit" className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition font-bold">
                        {isRegistering ? 'Sign Up' : 'Log In'}
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
