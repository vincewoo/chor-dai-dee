import { createContext, useContext } from 'react';
import { SUIT_COLORS, SUIT_COLORS_4 } from '../constants';
import { useUserPreferences } from './UserPreferencesContext';

const SuitColorContext = createContext();

export const useSuitColors = () => {
    const context = useContext(SuitColorContext);
    if (!context) {
        throw new Error('useSuitColors must be used within a SuitColorProvider');
    }
    return context;
};

export const SuitColorProvider = ({ children }) => {
    const { fourColorMode, toggleFourColorMode } = useUserPreferences();

    const suitColors = fourColorMode ? SUIT_COLORS_4 : SUIT_COLORS;

    return (
        <SuitColorContext.Provider value={{ suitColors, fourColorMode, toggleFourColorMode }}>
            {children}
        </SuitColorContext.Provider>
    );
};
