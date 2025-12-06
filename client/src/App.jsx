import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';

// In production, connect to same origin; in development, use localhost:3000
const SOCKET_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
const socket = io(SOCKET_URL);

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
    <Router>
        <Routes>
            <Route path="/" element={!user ? <Login setUser={handleSetUser} /> : <Navigate to="/lobby" />} />
            <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
            <Route path="/game/:roomId" element={user ? <GameRoom user={user} socket={socket} setUser={handleSetUser} /> : <Navigate to="/" />} />
        </Routes>
    </Router>
  )
}

export default App
