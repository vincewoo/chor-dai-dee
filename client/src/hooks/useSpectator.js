import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Owns everything spectator-specific for a game room.
 *
 * Intent comes from router location state (set by the "Watch instead" button);
 * the server is the authority on whether we're actually spectating, via the
 * `spectating_room` event. That split matters because location state is lost on a
 * hard refresh - the server then re-identifies us by username (spectators are
 * username-keyed) and replies `spectating_room` to a plain get_room_state.
 */
export default function useSpectator(socket, roomId, onClosed) {
    const location = useLocation();

    // A hard refresh (F5) drops router state, so mirror the intent in
    // sessionStorage. Without this the reload would emit join_room and either
    // seat the spectator or bounce them with 'Room full'.
    const storageKey = `cdd:spectating:${roomId}`;
    const wantsSpectate = !!location.state?.spectate || (() => {
        try { return sessionStorage.getItem(storageKey) === '1'; } catch { return false; }
    })();

    const [isSpectator, setIsSpectator] = useState(false);
    const [spectatorHands, setSpectatorHands] = useState({});
    // Which seat the spectator is "sitting" in (mobile). null = default seat 0.
    const [spectatorSeatId, setSpectatorSeatId] = useState(null);

    // Survives socket reconnects, where location.state is still present but we
    // need to know which emit to repeat.
    const spectateModeRef = useRef(wantsSpectate);

    const onClosedRef = useRef(onClosed);
    useEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);

    useEffect(() => {
        if (!socket) return;

        const handleSpectating = ({ gameState }) => {
            spectateModeRef.current = true;
            try { sessionStorage.setItem(storageKey, '1'); } catch { /* private mode */ }
            setIsSpectator(true);
            if (gameState?.players?.length) {
                // Keep the chosen seat only if that player is still at the table
                setSpectatorSeatId(prev =>
                    prev && gameState.players.some(p => p.id === prev) ? prev : null
                );
            }
        };

        const handleHands = ({ hands }) => setSpectatorHands(hands || {});

        const handleClosed = ({ reason }) => {
            spectateModeRef.current = false;
            try { sessionStorage.removeItem(storageKey); } catch { /* private mode */ }
            setIsSpectator(false);
            setSpectatorHands({});
            if (onClosedRef.current) onClosedRef.current(reason);
        };

        socket.on('spectating_room', handleSpectating);
        socket.on('spectator_hands', handleHands);
        socket.on('spectator_room_closed', handleClosed);

        return () => {
            socket.off('spectating_room', handleSpectating);
            socket.off('spectator_hands', handleHands);
            socket.off('spectator_room_closed', handleClosed);
        };
    }, [socket, storageKey]);

    // Emitted on mount and on every socket reconnect, in place of join_room.
    const emitSpectateJoin = useCallback((user) => {
        socket.emit('spectate_room', {
            roomId,
            username: user?.username,
            isGuest: user?.isGuest,
        });
    }, [socket, roomId]);

    const leaveSpectate = useCallback(() => {
        if (spectateModeRef.current) socket.emit('leave_spectate', { roomId });
        spectateModeRef.current = false;
        try { sessionStorage.removeItem(storageKey); } catch { /* private mode */ }
    }, [socket, roomId, storageKey]);

    return {
        wantsSpectate,
        spectateModeRef,
        isSpectator,
        spectatorHands,
        spectatorSeatId,
        setSpectatorSeatId,
        emitSpectateJoin,
        leaveSpectate,
    };
}
