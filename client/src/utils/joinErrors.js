// Pure predicate for the lobby's socket error handler.
//
// The lobby probes for a rejoinable game with a dummy join_room emit (on
// mount and on every socket connect), and a probe that finds nothing comes
// back as the same "Room not found" error a bad user-typed room code would.
// The two are only distinguishable by whether a user-initiated join is in
// flight — a probe's miss is expected and worth no toast.
//
// Kept pure and separate from Lobby.jsx so the highest-risk logic in the
// lobby's error path is testable with node --test (client tests cover pure
// utils only; component modules can't load there).
export function shouldShowJoinError(err, isJoinInFlight) {
    return err !== 'Room not found' || !!isJoinInFlight;
}
