import { createContext, useContext, useState, useEffect } from 'react';
import { SUIT_COLORS, SUIT_COLORS_4 } from '../constants';

const SuitColorContext = createContext();

export const useSuitColors = () => {
    const context = useContext(SuitColorContext);
    if (!context) {
        throw new Error('useSuitColors must be used within a SuitColorProvider');
    }
    return context;
};

export const SuitColorProvider = ({ children }) => {
    const [fourColorMode, setFourColorMode] = useState(() => {
        const saved = localStorage.getItem('fourColorMode');
        return saved === 'true';
    });

    useEffect(() => {
        localStorage.setItem('fourColorMode', fourColorMode);
    }, [fourColorMode]);

    const suitColors = fourColorMode ? SUIT_COLORS_4 : SUIT_COLORS;

    const toggleFourColorMode = () => {
        setFourColorMode(prev => !prev);
    };

    return (
        <SuitColorContext.Provider value={{ suitColors, fourColorMode, toggleFourColorMode }}>
            {children}
        </SuitColorContext.Provider>
    );
};
