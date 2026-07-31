import { useEffect, useRef, useState, useMemo } from 'react';

// Reconstructs a client-side log of the current round's plays and passes
// from the stream of `game_update` snapshots (gameState.players[].lastPlayed).
//
// Server facts this relies on (server/game/RoomManager.js):
//  - Each player's `lastPlayed` is `{ type, cards, playerId, timestamp, playOrder }`
//    where `type` is the hand type (e.g. 'PAIR') for a play or 'pass' for a pass.
//  - `playOrder` increments per event and resets to 0 when a trick is cleared.
//  - A trick clear surfaces as a snapshot where every `lastPlayed` is null...
//    except when the trick winner leads again before the clear delay elapses,
//    where the clear and the new lead land in the same snapshot and `playOrder`
//    simply rewinds (see RoomManager.playHand's trickWinPending fast path).
//  - The round-winning hand arrives in the same snapshot that flips `gameState`
//    to 'round_over', so that phase has to be recorded too.
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
    const [snapshot, setSnapshot] = useState({ log: [], trickNo: 1, lastPlaySeq: 0, partial: false });

    // Persistent tracking across renders.
    const seenRef = useRef({});           // playerId -> "playOrder:timestamp" last recorded
    const entriesRef = useRef([]);         // accumulated entries this round
    const trickNoRef = useRef(1);
    const roundRef = useRef(null);
    const trickHasEntriesRef = useRef(false); // any entry since last trick boundary
    const maxOrderRef = useRef(0);         // highest playOrder seen in current trick
    const seqRef = useRef(0);
    const partialRef = useRef(false);      // joined this round already in progress

    const players = gameState?.players;
    const roundNumber = gameState?.roundNumber;
    const phase = gameState?.gameState;

    // This effect synchronizes derived log state from the socket-driven gameState
    // stream (an external system). setState here is intentional; the parent already
    // re-renders on each game_update, so no extra cascade is introduced in practice.
    // (No eslint-disable for react-hooks/set-state-in-effect: the rule no longer
    // fires here. Re-add it if a future edit makes it, rather than pre-emptively.)
    useEffect(() => {
        if (!players) return;
        // Accumulate while playing, plus round_over: the hand that empties a player's
        // hand arrives together with the round_over phase flip, and it still has to
        // reach the pile (fly-in) and the log. Everything else (waiting, finished) is
        // frozen; the log resets when roundNumber changes.
        if (phase !== 'playing' && phase !== 'round_over') return;

        // Round reset: new round number → clear everything.
        if (roundRef.current !== roundNumber) {
            roundRef.current = roundNumber;
            seenRef.current = {};
            entriesRef.current = [];
            trickNoRef.current = 1;
            trickHasEntriesRef.current = false;
            maxOrderRef.current = 0;
            seqRef.current = 0;
            // A round that is already underway when we first see it (reload,
            // PWA relaunch, reconnect, spectator joining mid-round) can never
            // be logged completely — the server's authoritative history is not
            // sent, so everything before this moment is unrecoverable. Record
            // that, so the UI can decline to number moves it cannot count.
            partialRef.current = players.some(p => (p.cardCount ?? 13) < 13);
            setSnapshot({ log: [], trickNo: 1, lastPlaySeq: 0, partial: partialRef.current });
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
        // Only while playing — the same clear arrives after a round ends, and there we
        // keep the winning hand on the pile instead of emptying it.
        if (!anyLastPlayed && trickHasEntriesRef.current) {
            if (phase !== 'playing') return;
            trickNoRef.current += 1;
            trickHasEntriesRef.current = false;
            maxOrderRef.current = 0;
            seenRef.current = {};
            // No new entries, but trick number advanced → publish so pile empties.
            setSnapshot({
                partial: partialRef.current,
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
            // A rewound playOrder means the server cleared the trick and the winner led
            // again in the same snapshot, so start the new trick here — otherwise the
            // won trick's cards linger on the pile and the keys collide with it.
            if (e.playOrder <= maxOrderRef.current) {
                trickNoRef.current += 1;
                trickHasEntriesRef.current = false;
                maxOrderRef.current = 0;
            }
            e.trick = trickNoRef.current;
            e.key = `${e.trick}-${e.playOrder}`;
            maxOrderRef.current = e.playOrder;
            entriesRef.current.push(e);
            trickHasEntriesRef.current = true;
            if (!e.isPass) bumpedSeq = true;
        }
        if (bumpedSeq) seqRef.current += 1;

        setSnapshot({
            log: entriesRef.current.slice(),
            trickNo: trickNoRef.current,
            lastPlaySeq: seqRef.current,
            partial: partialRef.current,
        });
    }, [players, roundNumber, phase]);

    const pileTrickPlays = useMemo(() => {
        const currentTrick = snapshot.trickNo;
        return snapshot.log
            .filter(e => e.trick === currentTrick && !e.isPass)
            .slice(-5);
    }, [snapshot]);

    return {
        log: snapshot.log,
        // True when this round was already under way when we first saw it, so
        // the log is missing an unknowable number of earlier moves.
        logIsPartial: !!snapshot.partial,
        trickNo: snapshot.trickNo,
        pileTrickPlays,
        lastPlaySeq: snapshot.lastPlaySeq,
    };
}
