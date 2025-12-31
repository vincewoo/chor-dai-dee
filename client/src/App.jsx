import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import Stats from './components/Stats';
import Leaderboard from './components/Leaderboard';
import ActivityFeed from './components/ActivityFeed';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import { UserPreferencesProvider } from './contexts/UserPreferencesContext';
import { SuitColorProvider } from './contexts/SuitColorContext';
import { VoiceProvider } from './contexts/VoiceContext';
import './utils/voiceDebug'; // Load voice debug utilities

// In production, connect to same origin; in development, connect to localhost:3000
const socketUrl = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');
const socket = io(socketUrl, {
  // Reconnection options optimized for mobile browsers
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,        // Wait 1 second before first reconnect attempt
  reconnectionDelayMax: 5000,     // Max 5 seconds between attempts
  timeout: 20000,                 // 20 seconds connection timeout (matches server)
  // Force WebSocket to avoid polling issues on mobile networks
  transports: ['websocket'],
  // Disable upgrade to prevent connection instability
  upgrade: false,
  // Match server's ping settings
  pingTimeout: 20000,
  pingInterval: 15000,
  // Prevent aggressive reconnection on mobile
  randomizationFactor: 0.5
});

function App() {
  const [user, setUser] = useState(() => {
    // Check for regular user first, then guest user
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      return JSON.parse(savedUser);
    }
    const savedGuest = localStorage.getItem('guestUser');
    return savedGuest ? JSON.parse(savedGuest) : null;
  });

  const handleSetUser = (userData) => {
    if (userData) {
      if (userData.isGuest) {
        // Store guest users separately
        localStorage.setItem('guestUser', JSON.stringify(userData));
        localStorage.removeItem('user'); // Clear any regular user
      } else {
        // Store regular users
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.removeItem('guestUser'); // Clear any guest user
      }
    } else {
      // Clear all user data on logout
      localStorage.removeItem('user');
      localStorage.removeItem('guestUser');
    }
    setUser(userData);
  };

  return (
    <UserPreferencesProvider user={user}>
      <SuitColorProvider>
        <VoiceProvider socket={socket}>
          <Router>
              <Routes>
                  <Route path="/" element={!user ? <Login setUser={handleSetUser} /> : <Navigate to="/lobby" />} />
                  <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/stats" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/stats/:username" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/leaderboard" element={user ? <Leaderboard user={user} /> : <Navigate to="/" />} />
                  <Route path="/activity" element={user ? <ActivityFeed serverUrl={socketUrl} /> : <Navigate to="/" />} />
                  <Route path="/game/:roomId" element={user ? <GameRoom user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
              </Routes>
          </Router>
          <PWAUpdatePrompt />
        </VoiceProvider>
      </SuitColorProvider>
    </UserPreferencesProvider>
  )
}

export default App
