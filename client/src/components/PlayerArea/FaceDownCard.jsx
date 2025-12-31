/**
 * Face-down card component - displays the back of a playing card
 * Uses a crimson gradient with diagonal stripe pattern
 */

/**
 * Horizontal face-down card (used for top player)
 */
export const FaceDownCardHorizontal = ({ index }) => (
    <div
        key={index}
        className="w-[18px] h-[26px] md:w-[3.3vmax] md:h-[4.5vmax] border-2 border-white rounded-xl shadow-sm -ml-3 md:-ml-[1.5vmax] relative overflow-hidden"
        style={{
            background: `
                repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
            `
        }}
    >
        <div className="absolute inset-[8%] border border-white rounded-lg" />
    </div>
);

/**
 * Vertical face-down card (used for left/right players)
 */
export const FaceDownCardVertical = ({ index }) => (
    <div
        key={index}
        className="w-[26px] h-[18px] md:w-[4.5vmax] md:h-[3.3vmax] border-2 border-white rounded-xl shadow-sm -mt-2.5 md:-mt-[1.2vmax] relative overflow-hidden"
        style={{
            background: `
                repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 8px),
                linear-gradient(135deg, #c41e3a 0%, #dc143c 50%, #c41e3a 100%)
            `
        }}
    >
        <div className="absolute inset-[8%] border border-white rounded-lg" />
    </div>
);
