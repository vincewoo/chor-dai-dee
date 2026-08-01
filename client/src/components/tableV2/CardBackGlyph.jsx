import { memo } from 'react';
import { SUIT_SHAPES } from './suitShapes';
import { FAN_CARD_W, FAN_CARD_H } from './fanGeometry';

// The back of a card, drawn from the table's own tokens: the felt gradient
// inset inside the white card edge, a gold lattice, and a gold diamond.
//
// It exists so an opponent's hand can be drawn as cards rather than as a
// number. Nothing about it is card-specific — every back is identical, which is
// the point: the fan carries the count, not the identity.
const CardBackGlyph = memo(function CardBackGlyph({ width = FAN_CARD_W, height = FAN_CARD_H, style }) {
    return (
        <div
            style={{
                boxSizing: 'border-box',
                width, height,
                background: '#ffffff',
                borderRadius: 10.4,
                boxShadow: '0 7px 16px rgba(0,0,0,.45)',
                position: 'relative',
                overflow: 'hidden',
                ...style,
            }}
        >
            <div style={{
                position: 'absolute', inset: 4, borderRadius: 7, overflow: 'hidden',
                background: 'radial-gradient(ellipse 120% 90% at 50% 32%,#1a5c3b 0%,#124d2f 46%,#0c3a23 78%,#082718 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(255,201,77,.4)',
            }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage:
                        'repeating-linear-gradient(45deg,rgba(255,201,77,.2) 0 1px,transparent 1px 9px),' +
                        'repeating-linear-gradient(-45deg,rgba(255,201,77,.2) 0 1px,transparent 1px 9px)',
                }} />
                {/* Drawn as a path for the same reason as SuitWatermark: iOS
                    resolves ♦ to Apple Color Emoji, which ignores `fill`. */}
                <svg
                    viewBox="0 0 100 100"
                    width={24}
                    height={24}
                    aria-hidden="true"
                    focusable="false"
                    style={{
                        position: 'absolute', left: '50%', top: '50%',
                        transform: 'translate(-50%,-50%)', fill: 'rgba(255,201,77,.55)',
                    }}
                >
                    {SUIT_SHAPES.D}
                </svg>
            </div>
        </div>
    );
});

export default CardBackGlyph;
