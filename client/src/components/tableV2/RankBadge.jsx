import { memo } from 'react';
import { publicRankColor, publicRankIndex } from '../../constants/publicRank';

// The rank insignia: a hex shield in the rank's colour with an emblem whose
// weight climbs the ladder. Drawn as SVG paths for the same reason
// SuitWatermark is — a glyph or emoji would be recoloured by the platform's
// colour font and would ignore the rank colour entirely on iOS.
//
// The emblem is chevrons, one per pair of ranks, and a crown at the top of the
// ladder. Seven chevrons would read as noise; three tiers of two plus a crown
// reads as a progression at badge size.
const chevronCount = (index) => (index < 0 ? 0 : Math.min(3, Math.floor(index / 2) + 1));

// Unranked has no colour of its own worth building a metal out of, so it falls
// through to the muted default from PUBLIC_RANK_COLORS.
function RankBadge({ rank, size = 148, dim = false, glow = true, style }) {
    const index = publicRankIndex(rank);
    const color = publicRankColor(rank);
    const chevrons = chevronCount(index);
    const isTop = index === 6;
    // Unique per rank so two badges on screen at once (the old one leaving, the
    // new one landing) never share a gradient id.
    const uid = `rank-${String(rank || 'unranked').toLowerCase()}`;

    return (
        <svg
            viewBox="0 0 120 132"
            width={size}
            height={size * (132 / 120)}
            aria-hidden="true"
            focusable="false"
            style={{
                display: 'block',
                opacity: dim ? 0.55 : 1,
                filter: glow && !dim ? `drop-shadow(0 0 26px ${color}88)` : undefined,
                ...style,
            }}
        >
            <defs>
                <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                    <stop offset="26%" stopColor={color} />
                    <stop offset="72%" stopColor={color} />
                    <stop offset="100%" stopColor="#0b0d10" stopOpacity="0.75" />
                </linearGradient>
                <linearGradient id={`${uid}-field`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,0,0,.42)" />
                    <stop offset="100%" stopColor="rgba(0,0,0,.72)" />
                </linearGradient>
            </defs>

            {/* Outer shield */}
            <path
                d="M60 3 L112 30 V78 Q112 96 60 129 Q8 96 8 78 V30 Z"
                fill={`url(#${uid}-metal)`}
                stroke="rgba(255,255,255,.55)"
                strokeWidth="1.6"
            />
            {/* Inner field, so the emblem sits on something darker than the rim */}
            <path
                d="M60 15 L101 36 V76 Q101 89 60 115 Q19 89 19 76 V36 Z"
                fill={`url(#${uid}-field)`}
                stroke={color}
                strokeWidth="1.4"
                strokeOpacity="0.7"
            />

            {/* Emblem */}
            {isTop ? (
                <g fill={color} stroke="rgba(255,255,255,.7)" strokeWidth="1.2" strokeLinejoin="round">
                    <path d="M36 76 L30 42 L48 57 L60 34 L72 57 L90 42 L84 76 Z" />
                    <rect x="36" y="80" width="48" height="9" rx="2.5" />
                </g>
            ) : (
                Array.from({ length: chevrons }, (_, i) => (
                    <path
                        key={i}
                        d="M60 42 L84 62 L76 70 L60 56 L44 70 L36 62 Z"
                        transform={`translate(0 ${i * 17 - (chevrons - 1) * 8.5}) scale(1)`}
                        fill={color}
                        stroke="rgba(255,255,255,.6)"
                        strokeWidth="1.1"
                        strokeLinejoin="round"
                        opacity={1 - i * 0.16}
                    />
                ))
            )}
        </svg>
    );
}

export default memo(RankBadge);
