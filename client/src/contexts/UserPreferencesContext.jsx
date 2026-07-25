import { createContext, useContext, useState, useEffect } from 'react';
import { setSoundEnabled as applySoundEnabled, setSoundVolume as applySoundVolume } from '../utils/sounds';

const UserPreferencesContext = createContext();

// Determine API URL based on environment
const API_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');

export const useUserPreferences = () => {
    const context = useContext(UserPreferencesContext);
    if (!context) {
        throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
    }
    return context;
};

export const UserPreferencesProvider = ({ children, user }) => {
    const [fourColorMode, setFourColorMode] = useState(() => {
        const saved = localStorage.getItem('fourColorMode');
        return saved === 'true';
    });

    const [autoPass, setAutoPass] = useState(() => {
        const saved = localStorage.getItem('autoPass');
        return saved === 'true';
    });

    const [voiceChatEnabled, setVoiceChatEnabled] = useState(() => {
        const saved = localStorage.getItem('voiceChatEnabled');
        return saved !== 'false'; // Default to true
    });

    // ---- v2 mobile table theme preferences ----
    const [tableTheme, setTableTheme] = useState(() => {
        const saved = localStorage.getItem('tableTheme');
        return saved === 'ink' ? 'ink' : 'felt';
    });

    const [accentColor, setAccentColor] = useState(() => {
        const saved = localStorage.getItem('accentColor');
        return ['gold', 'mint', 'coral', 'violet'].includes(saved) ? saved : 'gold';
    });

    const [soundEnabled, setSoundEnabled] = useState(() => {
        const saved = localStorage.getItem('soundEnabled');
        return saved !== 'false'; // Default to on
    });

    const [soundVolume, setSoundVolume] = useState(() => {
        const saved = parseFloat(localStorage.getItem('soundVolume'));
        return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.6;
    });

    const [reducedMotion, setReducedMotion] = useState(() => {
        const saved = localStorage.getItem('reducedMotion');
        if (saved === 'true') return true;
        if (saved === 'false') return false;
        // No stored override: default to the OS setting.
        return typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;
    });

    const [isLoading, setIsLoading] = useState(false);

    // Load preferences from server when user logs in (skip for guests)
    useEffect(() => {
        if (user?.id && !user?.isGuest) {
            let cancelled = false;
            // Syncing from an external system (the preferences API) — the
            // loading flag + fetched data are the intended effect payload.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsLoading(true);
            fetch(`${API_URL}/api/preferences/${user.id}`)
                .then(res => res.json())
                .then(data => {
                    if (!cancelled) {
                        setFourColorMode(data.fourColorMode);
                        setAutoPass(data.autoPass);
                        if (data.voiceChatEnabled !== undefined) {
                            setVoiceChatEnabled(data.voiceChatEnabled);
                        }
                        if (data.tableTheme !== undefined) {
                            setTableTheme(data.tableTheme);
                        }
                        if (data.accentColor !== undefined) {
                            setAccentColor(data.accentColor);
                        }
                        if (data.reducedMotion !== undefined) {
                            setReducedMotion(data.reducedMotion);
                        }
                        if (data.soundEnabled !== undefined) {
                            setSoundEnabled(data.soundEnabled);
                        }
                        if (data.soundVolume !== undefined) {
                            setSoundVolume(data.soundVolume);
                        }
                        // Also update localStorage
                        localStorage.setItem('fourColorMode', data.fourColorMode);
                        localStorage.setItem('autoPass', data.autoPass);
                        if (data.voiceChatEnabled !== undefined) {
                            localStorage.setItem('voiceChatEnabled', data.voiceChatEnabled);
                        }
                        if (data.tableTheme !== undefined) {
                            localStorage.setItem('tableTheme', data.tableTheme);
                        }
                        if (data.accentColor !== undefined) {
                            localStorage.setItem('accentColor', data.accentColor);
                        }
                        if (data.reducedMotion !== undefined) {
                            localStorage.setItem('reducedMotion', data.reducedMotion);
                        }
                        if (data.soundEnabled !== undefined) {
                            localStorage.setItem('soundEnabled', data.soundEnabled);
                        }
                        if (data.soundVolume !== undefined) {
                            localStorage.setItem('soundVolume', data.soundVolume);
                        }
                    }
                })
                .catch(err => {
                    console.error('Error loading preferences:', err);
                    // Keep localStorage values on error
                })
                .finally(() => {
                    if (!cancelled) {
                        setIsLoading(false);
                    }
                });
            return () => {
                cancelled = true;
            };
        }
    }, [user?.id]);

    // Save preferences to server when they change (skip for guests)
    useEffect(() => {
        if (user?.id && !user?.isGuest && !isLoading) {
            const savePreferences = async () => {
                try {
                    await fetch(`${API_URL}/api/preferences/${user.id}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ fourColorMode, autoPass, voiceChatEnabled, tableTheme, accentColor, reducedMotion, soundEnabled, soundVolume }),
                    });
                } catch (err) {
                    console.error('Error saving preferences:', err);
                }
            };
            savePreferences();
        }

        // Also save to localStorage
        localStorage.setItem('fourColorMode', fourColorMode);
        localStorage.setItem('autoPass', autoPass);
        localStorage.setItem('voiceChatEnabled', voiceChatEnabled);
        localStorage.setItem('tableTheme', tableTheme);
        localStorage.setItem('accentColor', accentColor);
        localStorage.setItem('reducedMotion', reducedMotion);
        localStorage.setItem('soundEnabled', soundEnabled);
        localStorage.setItem('soundVolume', soundVolume);
    }, [fourColorMode, autoPass, voiceChatEnabled, tableTheme, accentColor, reducedMotion, soundEnabled, soundVolume, user?.id, isLoading]);

    // Mirror sound settings into the audio engine, which keeps its own state so
    // that playSound() callers don't have to thread preferences through props.
    useEffect(() => {
        applySoundEnabled(soundEnabled);
    }, [soundEnabled]);

    useEffect(() => {
        applySoundVolume(soundVolume);
    }, [soundVolume]);

    const toggleFourColorMode = () => {
        setFourColorMode(prev => !prev);
    };

    const toggleAutoPass = () => {
        setAutoPass(prev => !prev);
    };

    const toggleVoiceChat = () => {
        setVoiceChatEnabled(prev => !prev);
    };

    const toggleReducedMotion = () => {
        setReducedMotion(prev => !prev);
    };

    const toggleSound = () => {
        setSoundEnabled(prev => !prev);
    };


    return (
        <UserPreferencesContext.Provider value={{
            fourColorMode,
            autoPass,
            voiceChatEnabled,
            tableTheme,
            accentColor,
            reducedMotion,
            soundEnabled,
            soundVolume,
            toggleFourColorMode,
            toggleAutoPass,
            toggleVoiceChat,
            toggleReducedMotion,
            toggleSound,
            setAutoPass,
            setTableTheme,
            setAccentColor,
            setReducedMotion,
            setSoundEnabled,
            setSoundVolume,
            isLoading
        }}>
            {children}
        </UserPreferencesContext.Provider>
    );
};
