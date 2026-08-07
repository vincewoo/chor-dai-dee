import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoice } from '../contexts/VoiceContext';

// The one way an identity is dropped. Lobby (the guest Sign-in pill) and
// Profile (Log out) both sign out, and each used to carry its own copy of
// this — nothing forced a voice-teardown fix in one into the other.
export function useLogout(setUser) {
    const navigate = useNavigate();
    const voiceContext = useVoice();
    return useCallback(() => {
        // Drop the mic/peer connections before the identity goes away,
        // otherwise the WebRTC session outlives the user it was opened for.
        if (voiceContext?.voiceEnabled) {
            voiceContext.leaveVoiceRoom();
        }
        setUser(null);
        navigate('/');
    }, [voiceContext, setUser, navigate]);
}

export default useLogout;
