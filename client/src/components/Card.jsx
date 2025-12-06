import React from 'react';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../constants';
import { motion } from 'framer-motion';

// Card sizes scale with viewport - base size is roughly 4vmin x 6vmin
const Card = ({ rank, suit, selected, onClick, isBack, index, size = 'normal' }) => {
    // Size variants for different contexts
    const sizeClasses = {
        small: 'w-[3vmax] h-[4.5vmax] text-[0.8vmax]',
        normal: 'w-[4vmax] h-[6vmax] text-[1vmax]',
        large: 'w-[5vmax] h-[7.5vmax] text-[1.2vmax]'
    };

    const sizeClass = sizeClasses[size] || sizeClasses.normal;

    if (isBack) {
        return (
            <motion.div
                className={`${sizeClass} bg-blue-800 rounded-lg border-2 border-white shadow-md m-[0.25vmax]`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.05 }}
            />
        );
    }

    return (
        <motion.div
            className={`${sizeClass} bg-white rounded-lg border-2 shadow-md m-[0.25vmax] flex flex-col items-center justify-center cursor-pointer select-none
                ${selected ? 'border-yellow-400 -translate-y-[1vmax] ring-2 ring-yellow-400' : 'border-gray-300 hover:-translate-y-[0.5vmax]'}
                ${SUIT_COLORS[suit]}`}
            onClick={onClick}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            whileTap={{ scale: 0.95 }}
        >
            <div className="font-bold" style={{ fontSize: '1.2em' }}>{rank}</div>
            <div style={{ fontSize: '1.5em' }}>{SUIT_SYMBOLS[suit]}</div>
        </motion.div>
    );
};

export default Card;
