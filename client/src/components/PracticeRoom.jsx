import { useEffect, useState } from 'react';
import GameRoom from './GameRoom';
import { createPracticeSocket } from '../offline/PracticeSocket';

function PracticeRoom({ user, setUser }) {
    const [socket] = useState(() => createPracticeSocket());

    useEffect(() => () => socket.close(), [socket]);

    return (
        <GameRoom
            user={user}
            socket={socket}
            setUser={setUser}
            roomIdOverride="PRACTICE"
            practiceMode
        />
    );
}

export default PracticeRoom;
