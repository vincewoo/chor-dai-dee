import { useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import { useOwnAvatarSync } from './hooks/useAvatars';

// Login -> Lobby -> GameRoom is the path essentially every session takes, so those
// stay in the entry chunk. The rest are side trips that most sessions never make;
// splitting them keeps their weight (charts, tables, date formatting) out of the
// bundle that gates first paint.
const Stats = lazy(() => import('./components/Stats'));
const Leaderboard = lazy(() => import('./components/Leaderboard'));
const ActivityFeed = lazy(() => import('./components/ActivityFeed'));
const AvatarPickerV2 = lazy(() =>
  import('./components/tableV2').then(m => ({ default: m.AvatarPickerV2 }))
);

// Route-level fallback. These chunks are small and usually warm from the service
// worker, so this is a brief flash at worst.
const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-green-900 text-white">
    Loading...
  </div>
);
import { UserPreferencesProvider } from './contexts/UserPreferencesContext';
import { SuitColorProvider } from './contexts/SuitColorContext';
import { VoiceProvider } from './contexts/VoiceContext';
import './utils/voiceDebug'; // Load voice debug utilities

// Google OAuth Client ID from environment
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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

  // Pull this account's saved avatar down (or push up one picked before the
  // account existed) so it follows the player between devices.
  useOwnAvatarSync(user);

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

  // Wrap with GoogleOAuthProvider only if client ID is configured
  const AppContent = (
    <UserPreferencesProvider user={user}>
      <SuitColorProvider>
        <VoiceProvider socket={socket}>
          <Router>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                  <Route path="/" element={!user ? <Login setUser={handleSetUser} /> : <Navigate to="/lobby" />} />
                  <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/stats" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/stats/:username" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
                  <Route path="/leaderboard" element={user ? <Leaderboard user={user} /> : <Navigate to="/" />} />
                  <Route path="/activity" element={user ? <ActivityFeed serverUrl={socketUrl} user={user} /> : <Navigate to="/" />} />
                  <Route path="/avatar" element={user ? <AvatarPickerV2 user={user} /> : <Navigate to="/" />} />
                  <Route path="/game/:roomId" element={user?.username ? <GameRoom user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
              </Routes>
            </Suspense>
          </Router>
          <PWAUpdatePrompt />
        </VoiceProvider>
      </SuitColorProvider>
    </UserPreferencesProvider>
  );

  // Only wrap with GoogleOAuthProvider if client ID is configured
  if (GOOGLE_CLIENT_ID) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        {AppContent}
      </GoogleOAuthProvider>
    );
  }

  return AppContent;
}

export default App
