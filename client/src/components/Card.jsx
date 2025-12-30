import { SUIT_SYMBOLS, SUIT_COLORS } from '../constants';
import { motion } from 'framer-motion';
import { useSuitColors } from '../contexts/SuitColorContext';
import React, { memo } from 'react';
import { areCardPropsEqual } from '../utils/memoUtils';

// Pip layout positions for number cards (as percentages of the pip container)
// Container is inset 12% from card edges, so these are relative to that inner area
const PIP_LAYOUTS = {
    'A': [{ x: 50, y: 50, scale: 2.2 }],
    '2': [
        { x: 50, y: 20 },
        { x: 50, y: 80, flip: true }
    ],
    '3': [
        { x: 50, y: 15 },
        { x: 50, y: 50 },
        { x: 50, y: 85, flip: true }
    ],
    '4': [
        { x: 25, y: 20 },
        { x: 75, y: 20 },
        { x: 25, y: 80, flip: true },
        { x: 75, y: 80, flip: true }
    ],
    '5': [
        { x: 25, y: 20 },
        { x: 75, y: 20 },
        { x: 50, y: 50 },
        { x: 25, y: 80, flip: true },
        { x: 75, y: 80, flip: true }
    ],
    '6': [
        { x: 25, y: 17 },
        { x: 75, y: 17 },
        { x: 25, y: 50 },
        { x: 75, y: 50 },
        { x: 25, y: 83, flip: true },
        { x: 75, y: 83, flip: true }
    ],
    '7': [
        { x: 25, y: 15 },
        { x: 75, y: 15 },
        { x: 50, y: 32 },
        { x: 25, y: 50 },
        { x: 75, y: 50 },
        { x: 25, y: 85, flip: true },
        { x: 75, y: 85, flip: true }
    ],
    '8': [
        { x: 25, y: 15 },
        { x: 75, y: 15 },
        { x: 50, y: 32 },
        { x: 25, y: 50 },
        { x: 75, y: 50 },
        { x: 50, y: 68, flip: true },
        { x: 25, y: 85, flip: true },
        { x: 75, y: 85, flip: true }
    ],
    '9': [
        { x: 25, y: 12 },
        { x: 75, y: 12 },
        { x: 25, y: 37 },
        { x: 75, y: 37 },
        { x: 50, y: 50 },
        { x: 25, y: 63, flip: true },
        { x: 75, y: 63, flip: true },
        { x: 25, y: 88, flip: true },
        { x: 75, y: 88, flip: true }
    ],
    '10': [
        { x: 25, y: 10 },
        { x: 75, y: 10 },
        { x: 50, y: 26 },
        { x: 25, y: 36 },
        { x: 75, y: 36 },
        { x: 25, y: 64, flip: true },
        { x: 75, y: 64, flip: true },
        { x: 50, y: 74, flip: true },
        { x: 25, y: 90, flip: true },
        { x: 75, y: 90, flip: true }
    ]
};

// Face card component using emojis
const FaceCard = ({ rank }) => {
    // K = Person with crown, Q = Princess, J = Prince
    const faceEmoji = rank === 'K' ? '🫅' : rank === 'Q' ? '👸' : '🤴';

    return (
        <div className="absolute inset-[8%] flex flex-col items-center justify-center overflow-hidden">
            {/* Single smaller emoji on small screens */}
            <span className="md:hidden" style={{ fontSize: '1.75em', lineHeight: 1 }}>{faceEmoji}</span>
            {/* Top emoji (only on md+ screens) */}
            <span className="hidden md:block" style={{ fontSize: '4em', lineHeight: 0.9 }}>{faceEmoji}</span>
            {/* Bottom emoji (inverted, only on md+ screens) */}
            <span className="hidden md:block rotate-180" style={{ fontSize: '4em', lineHeight: 0.9 }}>{faceEmoji}</span>
        </div>
    );
};

const Card = ({ rank, suit, selected, onClick, isBack, index, size = 'normal', forceTraditionalColors = false, dynamicWidth = null, dynamicHeight = null }) => {
    const { suitColors: contextSuitColors } = useSuitColors();

    // Use traditional red-black colors if forced, otherwise use context colors
    const suitColors = forceTraditionalColors ? SUIT_COLORS : contextSuitColors;

    const sizeClasses = {
        small: 'w-[18px] h-[26px] md:w-[3vmax] md:h-[4.5vmax]',
        normal: 'w-[32px] h-[48px] md:w-[4vmax] md:h-[6vmax]',
        large: 'w-[62px] h-[93px] md:w-[5vmax] md:h-[7.5vmax]',
        xlarge: 'w-[64px] h-[98px] md:w-[5.5vmax] md:h-[8.25vmax]'
    };

    const fontSizes = {
        small: { corner: 'text-[6px] md:text-[0.55vmax]', pip: 'text-[8px] md:text-[0.7vmax]' },
        normal: { corner: 'text-[10px] md:text-[0.7vmax]', pip: 'text-[12px] md:text-[0.9vmax]' },
        large: { corner: 'text-[14px] md:text-[0.85vmax]', pip: 'text-[16px] md:text-[1.1vmax]' },
        xlarge: { corner: 'text-[16px] md:text-[0.95vmax]', pip: 'text-[18px] md:text-[1.2vmax]' }
    };

    // When dynamicWidth is provided, use inline styles for mobile sizing
    // Otherwise fall back to Tailwind size classes
    const useDynamicSizing = dynamicWidth !== null;
    const dynamicStyle = useDynamicSizing ? {
        width: `${dynamicWidth}px`,
        height: `${dynamicHeight || dynamicWidth * 1.53}px`,
    } : {};

    // Scale font sizes proportionally when using dynamic sizing
    // Base: 64px width = 16px corner font, 18px pip font
    const fontScale = useDynamicSizing ? (dynamicWidth / 64) : 1;
    const dynamicCornerFontSize = useDynamicSizing ? `${16 * fontScale}px` : null;
    const dynamicPipFontSize = useDynamicSizing ? `${18 * fontScale}px` : null;

    // Only apply sizeClass when not using dynamic sizing (desktop uses md: prefixed classes)
    const sizeClass = useDynamicSizing ? 'md:w-[5.5vmax] md:h-[8.25vmax]' : (sizeClasses[size] || sizeClasses.normal);
    const fontSize = fontSizes[size] || fontSizes.normal;
    const suitSymbol = SUIT_SYMBOLS[suit];
    const color = suitColors[suit];
    const isFaceCard = ['J', 'Q', 'K'].includes(rank);
    const pipLayout = PIP_LAYOUTS[rank];

    if (isBack) {
        return (
            <motion.div
                className={`${sizeClass} rounded-xl border-2 border-white shadow-md md:m-[0.25vmax] relative overflow-hidden`}
                style={{
                    ...dynamicStyle,
                    background: `
                        repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                        repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                        linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
                    `
                }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.05 }}
            >
                {/* Inner white border frame */}
                <div className="absolute inset-[4%] border border-white rounded-lg" />
            </motion.div>
        );
    }

    return (
        <motion.div
            className={`${sizeClass} bg-white rounded-xl border-2 shadow-md md:m-[0.25vmax] relative cursor-pointer select-none overflow-hidden
                ${selected ? 'border-yellow-400 -translate-y-[1vmax] ring-2 ring-yellow-400' : 'border-gray-300 hover:-translate-y-[0.5vmax]'}`}
            style={dynamicStyle}
            onClick={onClick}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            whileTap={{ scale: 0.95 }}
        >
            {/* Top-left corner */}
            <div
                className={`absolute top-[4%] left-[8%] flex flex-col items-center leading-none ${color} ${useDynamicSizing ? '' : fontSize.corner}`}
                style={useDynamicSizing ? { fontSize: dynamicCornerFontSize } : undefined}
            >
                <span className="font-bold">{rank}</span>
                <span className="text-[1.1em]">{suitSymbol}</span>
            </div>

            {/* Bottom-right corner (rotated) */}
            <div
                className={`absolute bottom-[4%] right-[8%] flex flex-col items-center leading-none rotate-180 ${color} ${useDynamicSizing ? '' : fontSize.corner}`}
                style={useDynamicSizing ? { fontSize: dynamicCornerFontSize } : undefined}
            >
                <span className="font-bold">{rank}</span>
                <span className="text-[1.1em]">{suitSymbol}</span>
            </div>

            {/* Center content */}
            {/* On mobile (< md), show simplified large emoji. On desktop, show detailed pips/faces */}
            {rank === 'A' ? (
                /* Aces always use large centered suit */
                <div className="absolute inset-[12%]">
                    <div
                        className={`absolute ${color} ${useDynamicSizing ? '' : fontSize.pip}`}
                        style={{
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%) scale(2.2)',
                            ...(useDynamicSizing ? { fontSize: dynamicPipFontSize } : {})
                        }}
                    >
                        {suitSymbol}
                    </div>
                </div>
            ) : isFaceCard ? (
                <>
                    {/* Mobile: Single face emoji */}
                    <div className="md:hidden absolute inset-[12%]">
                        <div
                            className="absolute"
                            style={{
                                left: '50%',
                                top: '50%',
                                transform: 'translate(-50%, -50%)',
                                fontSize: useDynamicSizing ? `${1.75 * fontScale}em` : '1.75em',
                                lineHeight: 1
                            }}
                        >
                            {rank === 'K' ? '🫅' : rank === 'Q' ? '👸' : '🤴'}
                        </div>
                    </div>
                    {/* Desktop: Detailed face card rendering */}
                    <div className="hidden md:block">
                        <FaceCard rank={rank} />
                    </div>
                </>
            ) : (
                <>
                    {/* Mobile: Large centered suit for number cards */}
                    <div className="md:hidden absolute inset-[12%]">
                        <div
                            className={`absolute ${color} ${useDynamicSizing ? '' : fontSize.pip}`}
                            style={{
                                left: '50%',
                                top: '50%',
                                transform: 'translate(-50%, -50%) scale(2.2)',
                                ...(useDynamicSizing ? { fontSize: dynamicPipFontSize } : {})
                            }}
                        >
                            {suitSymbol}
                        </div>
                    </div>
                    {/* Desktop: Pip layout for number cards */}
                    <div className="hidden md:block absolute inset-[12%]">
                        {pipLayout && pipLayout.map((pip, i) => (
                            <div
                                key={i}
                                className={`absolute ${color} ${fontSize.pip}`}
                                style={{
                                    left: `${pip.x}%`,
                                    top: `${pip.y}%`,
                                    transform: `translate(-50%, -50%) ${pip.flip ? 'rotate(180deg)' : ''} scale(${pip.scale || 1})`
                                }}
                            >
                                {suitSymbol}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </motion.div>
    );
};

export default memo(Card, areCardPropsEqual);
