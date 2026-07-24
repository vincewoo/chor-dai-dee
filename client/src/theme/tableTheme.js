// Theme tokens for the v2 mobile game table redesign.
// Values mirror the claude.ai/design mockup "Game Table Redesign v2".

import { useMemo } from 'react';
import { useUserPreferences } from '../contexts/UserPreferencesContext';

// Accent palettes: acc = primary, dark = gradient end, soft = translucent glow
export const ACCENTS = {
    gold:   { acc: '#ffc94d', dark: '#e09a10', soft: 'rgba(255,201,77,.18)' },
    mint:   { acc: '#6ee7a8', dark: '#2fae70', soft: 'rgba(110,231,168,.14)' },
    coral:  { acc: '#ff8f70', dark: '#e25a38', soft: 'rgba(255,143,112,.14)' },
    violet: { acc: '#a48fff', dark: '#7257e8', soft: 'rgba(164,143,255,.14)' },
};

export const ACCENT_KEYS = ['gold', 'mint', 'coral', 'violet'];

// Surfaces: base = felt/ink background gradient, tint = overlay applied on top
const FELT_BASE = 'radial-gradient(ellipse 120% 90% at 50% 32%,#2f8f5b 0%,#1f6b45 46%,#124d2f 78%,#0c3a23 100%)';
export const SURFACES = {
    felt: {
        base: FELT_BASE,
        tint: 'radial-gradient(ellipse at 50% 38%,rgba(0,0,0,0) 48%,rgba(0,0,0,.45) 100%)',
    },
    ink: {
        base: FELT_BASE,
        tint: 'linear-gradient(180deg,#15181e 0%,#101216 55%,#0b0d10 100%)',
    },
};

export const SURFACE_KEYS = ['felt', 'ink'];

// Pile / log card suit colors (hex, used only by v2 components).
export const PILE_SUIT_COLORS = {
    fourColor: { D: '#2f6fe4', H: '#e0434f', C: '#2f9e5b', S: '#1c2026' },
    standard:  { D: '#e0434f', H: '#e0434f', C: '#1c2026', S: '#1c2026' },
};

export const SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };

// Face-card center emoji (kept for readability, matching the desktop Card.jsx).
export const FACE_EMOJI = { K: '🫅', Q: '👸', J: '🤴' };

const RANK_PLURAL = (rank) => (rank === '6' ? '6es' : rank + 's');

// Human-readable description of a played hand, given the server hand type.
// `type` is the server HAND_TYPE constant (e.g. 'PAIR', 'FULL_HOUSE') or 'pass'.
export function describeHand(type, cards) {
    if (!type || type === 'pass') return 'Passed';
    const RANK_ORDER = { '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':12 };
    const list = Array.isArray(cards) ? cards : [];
    const ranks = list.map(c => c.rank);
    const highCard = list.reduce(
        (a, b) => (RANK_ORDER[b.rank] > RANK_ORDER[a?.rank] ? b : a),
        list[0]
    );
    const counts = {};
    ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const findByCount = (n) => Object.keys(counts).find(r => counts[r] === n);

    switch (type) {
        case 'SINGLE':
            return 'Single ' + (ranks[0] || '');
        case 'PAIR':
            return 'Pair of ' + RANK_PLURAL(ranks[0] || '');
        case 'TRIPLE':
            return 'Triple ' + RANK_PLURAL(ranks[0] || '');
        case 'STRAIGHT':
            return 'Straight, ' + (highCard?.rank || '') + ' high';
        case 'FLUSH':
            return 'Flush, ' + (highCard?.rank || '') + ' high';
        case 'FULL_HOUSE':
            return 'Full House, ' + RANK_PLURAL(findByCount(3) || '') + ' full';
        case 'QUADS':
            return 'Four of a Kind, ' + RANK_PLURAL(findByCount(4) || '');
        case 'STRAIGHT_FLUSH':
            return 'Straight Flush, ' + (highCard?.rank || '') + ' high';
        default:
            return list.length + (list.length === 1 ? ' card' : ' cards');
    }
}

export const isPass = (lastPlayed) => !!lastPlayed && lastPlayed.type === 'pass';

// Resolves theme values from user preferences. Falls back to gold/felt.
export function useTableTheme() {
    const { accentColor, tableTheme, reducedMotion } = useUserPreferences();
    return useMemo(() => {
        const a = ACCENTS[accentColor] || ACCENTS.gold;
        const surface = SURFACES[tableTheme] || SURFACES.felt;
        return {
            acc: a.acc,
            dark: a.dark,
            soft: a.soft,
            accGrad: `linear-gradient(135deg,${a.acc},${a.dark})`,
            surface,
            rm: !!reducedMotion,
        };
    }, [accentColor, tableTheme, reducedMotion]);
}
