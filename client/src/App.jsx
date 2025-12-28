import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import Stats from './components/Stats';
import Leaderboard from './components/Leaderboard';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import { UserPreferencesProvider } from './contexts/UserPreferencesContext';
import { SuitColorProvider } from './contexts/SuitColorContext';

// In production, connect to same origin; in development, connect to localhost:3000
const socketUrl = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');
const socket = io(socketUrl, {
  // Reconnection options optimized for mobile browsers (especially iOS Safari)
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,        // Start reconnecting quickly
  reconnectionDelayMax: 3000,    // Don't wait too long between attempts
  timeout: 10000,                // Connection timeout
  // Prefer WebSocket but fall back to polling if needed
  transports: ['websocket', 'polling'],
  // Upgrade from polling to websocket when possible
  upgrade: true,
});

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleSetUser = (userData) => {
    if (userData) {
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('user');
    }
    setUser(userData);
  };

  return (
    <UserPreferencesProvider user={user}>
      <SuitColorProvider>
        <Router>
            <Routes>
                <Route path="/" element={!user ? <Login setUser={handleSetUser} /> : <Navigate to="/lobby" />} />
                <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
                <Route path="/stats" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                <Route path="/stats/:username" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                <Route path="/leaderboard" element={user ? <Leaderboard user={user} /> : <Navigate to="/" />} />
                <Route path="/game/:roomId" element={user ? <GameRoom user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
            </Routes>
        </Router>
        <PWAUpdatePrompt />
      </SuitColorProvider>
    </UserPreferencesProvider>
  )
}

export default App
