import { memo } from 'react';
import { SUIT_SYMBOLS } from '../../constants';

/**
 * Face-up opponent cards, shown only in spectator (god-view) mode on desktop.
 *
 * Deliberately not Card.jsx: these sit in the same tight fans as FaceDownCard
 * (3.3vmax x 4.5vmax with heavy negative margins) and must stay non-interactive.
 * Card.jsx is sized for the player's own hand and is unconditionally clickable.
 * Geometry here mirrors FaceDownCard exactly so the fans line up.
 *
 * `colorClass` is the caller's Tailwind color class from the suit-color context,
 * so four-color mode works the same as everywhere else.
 */

const FaceUpCardHorizontalBase = ({ card, colorClass }) => (
    <div className={`w-[18px] h-[26px] md:w-[3.3vmax] md:h-[4.5vmax] border-2 border-white rounded-xl shadow-sm -ml-3 md:-ml-[1.5vmax] relative overflow-hidden bg-white flex flex-col items-center justify-center leading-none ${colorClass}`}>
        <span className="font-bold text-[9px] md:text-[1.1vmax]">{card.rank}</span>
        <span className="text-[9px] md:text-[1.1vmax]">{SUIT_SYMBOLS[card.suit]}</span>
    </div>
);

export const FaceUpCardHorizontal = memo(FaceUpCardHorizontalBase);

// Left/right seats. Face-down cards can sit in a landscape box because they have
// no content, but a face-up card has to stay readable - so these keep the same
// stacking rhythm while showing rank+suit upright on a wide card.
const FaceUpCardVerticalBase = ({ card, colorClass }) => (
    <div className={`w-[26px] h-[18px] md:w-[4.5vmax] md:h-[2.4vmax] border-2 border-white rounded-lg shadow-sm -mt-1 md:-mt-[0.5vmax] relative overflow-hidden bg-white flex items-center justify-center gap-[0.3vmax] leading-none ${colorClass}`}>
        <span className="font-bold text-[9px] md:text-[1.1vmax]">{card.rank}</span>
        <span className="text-[9px] md:text-[1.1vmax]">{SUIT_SYMBOLS[card.suit]}</span>
    </div>
);

export const FaceUpCardVertical = memo(FaceUpCardVerticalBase);
