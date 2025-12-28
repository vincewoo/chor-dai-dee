import { createContext, useContext, useState, useEffect } from 'react';

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

    const [isLoading, setIsLoading] = useState(false);

    // Load preferences from server when user logs in
    useEffect(() => {
        if (user?.id) {
            let cancelled = false;
            setIsLoading(true);
            fetch(`${API_URL}/api/preferences/${user.id}`)
                .then(res => res.json())
                .then(data => {
                    if (!cancelled) {
                        setFourColorMode(data.fourColorMode);
                        setAutoPass(data.autoPass);
                        // Also update localStorage
                        localStorage.setItem('fourColorMode', data.fourColorMode);
                        localStorage.setItem('autoPass', data.autoPass);
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

    // Save preferences to server when they change
    useEffect(() => {
        if (user?.id && !isLoading) {
            const savePreferences = async () => {
                try {
                    await fetch(`${API_URL}/api/preferences/${user.id}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ fourColorMode, autoPass }),
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
    }, [fourColorMode, autoPass, user?.id, isLoading]);

    const toggleFourColorMode = () => {
        setFourColorMode(prev => !prev);
    };

    const toggleAutoPass = () => {
        setAutoPass(prev => !prev);
    };

    return (
        <UserPreferencesContext.Provider value={{
            fourColorMode,
            autoPass,
            toggleFourColorMode,
            toggleAutoPass,
            setAutoPass,
            isLoading
        }}>
            {children}
        </UserPreferencesContext.Provider>
    );
};
