import { useMemo } from 'react';

/**
 * Everyone we're actually peered with in voice, seated or not.
 *
 * Derives FROM `peers` rather than intersecting it with `players`. The old
 * `players.filter(p => peers.includes(p.name))` silently dropped anyone in voice
 * without a seat - which is every spectator - leaving them audible but with no
 * name and no volume slider.
 *
 * Returns [{ name, id, isSpectator }], excluding ourselves.
 */
export default function useVoiceParticipants(players, peers, username) {
    return useMemo(() => {
        const seatList = players || [];
        const peerList = peers || [];
        const seatedNames = new Set(seatList.map(p => p.name));

        const seated = seatList
            .filter(p => peerList.includes(p.name))
            .map(p => ({ name: p.name, id: p.id, isSpectator: false }));

        const spectators = peerList
            .filter(n => !seatedNames.has(n))
            .map(n => ({ name: n, id: `spec-${n}`, isSpectator: true }));

        return [...seated, ...spectators].filter(p => p.name !== username);
    }, [players, peers, username]);
}
