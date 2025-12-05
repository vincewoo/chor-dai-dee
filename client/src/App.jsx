import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client'
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';

const socket = io('http://localhost:3000');

function App() {
  const [user, setUser] = useState(null);

  // In a real app, verify session on load. For now, just state.

  return (
    <Router>
        <Routes>
            <Route path="/" element={!user ? <Login setUser={setUser} /> : <Navigate to="/lobby" />} />
            <Route path="/lobby" element={user ? <Lobby user={user} socket={socket} /> : <Navigate to="/" />} />
            <Route path="/game/:roomId" element={user ? <GameRoom user={user} socket={socket} /> : <Navigate to="/" />} />
        </Routes>
    </Router>
  )
}

export default App
