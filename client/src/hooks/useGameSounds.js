import { useEffect, useRef } from 'react';
import { playSound, unlockAudio } from '../utils/sounds';

/**
 * Watches game state and fires the appropriate sound effects.
 *
 * Sounds are derived from state transitions rather than socket events so that
 * every player hears the same table — bot moves and remote players' moves come
 * through `game_update` with no dedicated event of their own.
 *
 * The refs below hold the previously-observed values; a sound fires only when
 * the value actually changes, which also makes the hook safe against the
 * repeated `game_update` emissions that follow a single move.
 */
const useGameSounds = ({ gameState, roundResult, gameOver, myPlayerId }) => {
    const prevPlayOrderRef = useRef(null);
    const prevRoundNumberRef = useRef(null);
    const prevStatusRef = useRef(undefined);
    const prevTurnRef = useRef(null);
    const prevRoundWinnerRef = useRef(null);
    const gameOverPlayedRef = useRef(false);
    const initializedRef = useRef(false);

    // Browsers keep the AudioContext suspended until a user gesture. Unlock on
    // the first interaction anywhere in the app, then stop listening.
    useEffect(() => {
        const handler = () => unlockAudio();
        const opts = { passive: true };
        window.addEventListener('pointerdown', handler, opts);
        window.addEventListener('keydown', handler, opts);
        return () => {
            window.removeEventListener('pointerdown', handler);
            window.removeEventListener('keydown', handler);
        };
    }, []);

    // Plays and passes: every player's move carries an incrementing playOrder.
    useEffect(() => {
        if (!gameState?.players) return;

        // Find the most recent action across all players.
        let latest = null;
        for (const player of gameState.players) {
            const lastPlayed = player.lastPlayed;
            if (!lastPlayed || typeof lastPlayed.playOrder !== 'number') continue;
            if (!latest || lastPlayed.playOrder > latest.playOrder) {
                latest = lastPlayed;
            }
        }

        if (!latest) {
            // New round / cleared table — reset so the next play always sounds.
            prevPlayOrderRef.current = null;
            return;
        }

        const prev = prevPlayOrderRef.current;
        prevPlayOrderRef.current = latest.playOrder;

        // Don't replay history on mount or after a reconnect.
        if (prev === null || latest.playOrder <= prev) return;

        playSound(latest.type === 'pass' ? 'pass' : 'play');
    }, [gameState]);

    // Shuffle at the start of each round (including the first deal).
    useEffect(() => {
        const status = gameState?.gameState;
        const roundNumber = gameState?.roundNumber;

        if (status !== 'playing' || !roundNumber) {
            // Leaving 'playing' (waiting room, round-over, game finished) —
            // arm the next transition so the following deal always sounds.
            prevStatusRef.current = status;
            prevRoundNumberRef.current = null;
            return;
        }

        const prevStatus = prevStatusRef.current;
        const prevRound = prevRoundNumberRef.current;
        prevStatusRef.current = status;
        prevRoundNumberRef.current = roundNumber;

        // First time we see this game as 'playing'. That's a fresh deal unless
        // we arrived mid-game (reconnect / join-in-progress), where the very
        // first state we ever receive is already 'playing'.
        if (prevRound === null) {
            const joinedMidGame = !initializedRef.current && prevStatus === undefined;
            initializedRef.current = true;
            if (!joinedMidGame) playSound('shuffle');
            return;
        }

        initializedRef.current = true;
        if (prevRound !== roundNumber) playSound('shuffle');
    }, [gameState?.roundNumber, gameState?.gameState]);

    // "Your turn" cue.
    useEffect(() => {
        const currentTurn = gameState?.currentTurn;
        if (gameState?.gameState !== 'playing') {
            prevTurnRef.current = null;
            return;
        }

        const prev = prevTurnRef.current;
        prevTurnRef.current = currentTurn;

        if (prev === null || prev === currentTurn) return;
        if (currentTurn && currentTurn === myPlayerId) {
            playSound('yourTurn');
        }
    }, [gameState?.currentTurn, gameState?.gameState, myPlayerId]);

    // Round win chime — only when the round result is new.
    useEffect(() => {
        if (!roundResult) {
            prevRoundWinnerRef.current = null;
            return;
        }

        const key = `${roundResult.roundNumber}:${roundResult.roundWinner?.id ?? ''}`;
        if (prevRoundWinnerRef.current === key) return;
        prevRoundWinnerRef.current = key;

        playSound('roundWin');
    }, [roundResult]);

    // Game over fanfare, or a minor cadence if someone else took it.
    useEffect(() => {
        if (!gameOver) {
            gameOverPlayedRef.current = false;
            return;
        }
        if (gameOverPlayedRef.current) return;
        gameOverPlayedRef.current = true;

        const winnerId = gameOver.winner?.id;
        playSound(winnerId && winnerId === myPlayerId ? 'gameWin' : 'gameLose');
    }, [gameOver, myPlayerId]);
};

export default useGameSounds;
