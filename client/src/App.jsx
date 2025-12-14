import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import Stats from './components/Stats';
import { SuitColorProvider } from './contexts/SuitColorContext';

// In production, connect to same origin; in development, connect to localhost:3000
const socketUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';
const socket = io(socketUrl);

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
    <SuitColorProvider>
      <Router>
          <Routes>
              <Route path="/" element={!user ? <Login setUser={handleSetUser} /> : <Navigate to="/lobby" />} />
              <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
              <Route path="/stats" element={user ? <Stats user={user} setUser={handleSetUser} /> : <Navigate to="/" />} />
              <Route path="/game/:roomId" element={user ? <GameRoom user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
          </Routes>
      </Router>
    </SuitColorProvider>
  )
}

export default App
