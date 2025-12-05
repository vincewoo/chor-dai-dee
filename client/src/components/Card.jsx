import React from 'react';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../constants';
import { motion } from 'framer-motion';

const Card = ({ rank, suit, selected, onClick, isBack, index }) => {
    if (isBack) {
        return (
            <motion.div
                className="w-16 h-24 bg-blue-800 rounded-lg border-2 border-white shadow-md m-1"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.05 }}
            />
        );
    }

    return (
        <motion.div
            className={`w-16 h-24 bg-white rounded-lg border-2 shadow-md m-1 flex flex-col items-center justify-center cursor-pointer select-none
                ${selected ? 'border-yellow-400 -translate-y-4 ring-2 ring-yellow-400' : 'border-gray-300 hover:-translate-y-2'}
                ${SUIT_COLORS[suit]}`}
            onClick={onClick}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            whileTap={{ scale: 0.95 }}
        >
            <div className="text-xl font-bold">{rank}</div>
            <div className="text-2xl">{SUIT_SYMBOLS[suit]}</div>
        </motion.div>
    );
};

export default Card;
