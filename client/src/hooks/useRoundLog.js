import { useEffect, useRef, useState, useMemo } from 'react';

// Reconstructs a client-side log of the current round's plays and passes
// from the stream of `game_update` snapshots (gameState.players[].lastPlayed).
//
// Server facts this relies on (server/game/RoomManager.js):
//  - Each player's `lastPlayed` is `{ type, cards, playerId, timestamp, playOrder }`
//    where `type` is the hand type (e.g. 'PAIR') for a play or 'pass' for a pass.
//  - `playOrder` increments per event and resets to 0 when a trick is cleared.
//  - A trick clear surfaces as a snapshot where every `lastPlayed` is null.
//
// Returns:
//  - log: full ordered list of entries this round (plays + passes), each
//    { key, trick, playerId, name, isPass, handType, cards, playOrder }
//  - trickNo: current trick number (1-based)
//  - pileTrickPlays: non-pass entries of the current trick (last 5), oldest→newest
//  - lastPlaySeq: counter bumped whenever a new *play* is appended (fly-in key seed)
//
// The pile top card should still be driven by gameState.lastPlayedHand directly;
// this log is advisory (a dropped socket message only affects the review sheet).
export function useRoundLog(gameState) {
    const [snapshot, setSnapshot] = useState({ log: [], trickNo: 1, lastPlaySeq: 0 });

    // Persistent tracking across renders.
    const seenRef = useRef({});           // playerId -> "playOrder:timestamp" last recorded
    const entriesRef = useRef([]);         // accumulated entries this round
    const trickNoRef = useRef(1);
    const roundRef = useRef(null);
    const trickHasEntriesRef = useRef(false); // any entry since last trick boundary
    const seqRef = useRef(0);

    const players = gameState?.players;
    const roundNumber = gameState?.roundNumber;
    const phase = gameState?.gameState;

    // This effect synchronizes derived log state from the socket-driven gameState
    // stream (an external system). setState here is intentional; the parent already
    // re-renders on each game_update, so no extra cascade is introduced in practice.
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (!players) return;
        // Only accumulate during active play. During round_over we freeze the log
        // (so it stays reviewable); it resets when roundNumber changes.
        if (phase !== 'playing') return;

        // Round reset: new round number → clear everything.
        if (roundRef.current !== roundNumber) {
            roundRef.current = roundNumber;
            seenRef.current = {};
            entriesRef.current = [];
            trickNoRef.current = 1;
            trickHasEntriesRef.current = false;
            seqRef.current = 0;
            setSnapshot({ log: [], trickNo: 1, lastPlaySeq: 0 });
        }

        // Gather newly-appeared events this snapshot.
        const fresh = [];
        let anyLastPlayed = false;
        for (const p of players) {
            const lp = p.lastPlayed;
            if (!lp) continue;
            anyLastPlayed = true;
            const stamp = `${lp.playOrder}:${lp.timestamp}`;
            if (seenRef.current[p.id] === stamp) continue;
            seenRef.current[p.id] = stamp;
            fresh.push({
                trick: trickNoRef.current,
                playerId: p.id,
                name: p.name,
                isPass: lp.type === 'pass',
                handType: lp.type,
                cards: lp.cards || [],
                playOrder: lp.playOrder,
                timestamp: lp.timestamp,
            });
        }

        // Trick boundary: all lastPlayed cleared after we had entries in this trick.
        if (!anyLastPlayed && trickHasEntriesRef.current) {
            trickNoRef.current += 1;
            trickHasEntriesRef.current = false;
            seenRef.current = {};
            // No new entries, but trick number advanced → publish so pile empties.
            setSnapshot({
                log: entriesRef.current,
                trickNo: trickNoRef.current,
                lastPlaySeq: seqRef.current,
            });
            return;
        }

        if (fresh.length === 0) return;

        // Order events within the update by playOrder (handles multi-event bursts
        // like the single-2♠ auto-pass, and reconnection catch-up).
        fresh.sort((a, b) => a.playOrder - b.playOrder);

        let bumpedSeq = false;
        for (const e of fresh) {
            e.key = `${e.trick}-${e.playOrder}`;
            entriesRef.current.push(e);
            trickHasEntriesRef.current = true;
            if (!e.isPass) bumpedSeq = true;
        }
        if (bumpedSeq) seqRef.current += 1;

        setSnapshot({
            log: entriesRef.current.slice(),
            trickNo: trickNoRef.current,
            lastPlaySeq: seqRef.current,
        });
    }, [players, roundNumber, phase]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const pileTrickPlays = useMemo(() => {
        const currentTrick = snapshot.trickNo;
        return snapshot.log
            .filter(e => e.trick === currentTrick && !e.isPass)
            .slice(-5);
    }, [snapshot]);

    return {
        log: snapshot.log,
        trickNo: snapshot.trickNo,
        pileTrickPlays,
        lastPlaySeq: snapshot.lastPlaySeq,
    };
}
