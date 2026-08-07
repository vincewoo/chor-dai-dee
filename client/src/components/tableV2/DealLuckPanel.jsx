import { useMemo, useState } from 'react';

// The game-over drill-in: how the deal treated each seat, round by round.
//
// Each cell is one deal's strength as a percentile of all possible hands, with
// the colour banding that same number so a whole game reads as a heat map.
// Where a player placed at the table stays in the cell tooltip.
//
// Rank compares all four dealt hands, so it only exists here: the server sends
// dealLuck on game_over alone, never on round_over or in room state, or it
// would be a live read on opponents' holdings.

const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';

// Colour is absolute strength, the same thing the number says, so the grid can
// be read as a heat map without doing arithmetic: the yellow rows are the
// players who got the cards. Deliberately NOT the rank at the table -- rank is
// relative, so in a round where everyone was dealt scraps somebody still comes
// first, and colouring that gold would say "good hand" about a bad one.
//
// Thirds of the percentile scale. The bands are wide on purpose: percentile is
// coarse (raw spans -9..19, so adjacent percentiles share values) and a finer
// ramp would imply precision the metric does not have.
const STRONG_AT = 67;
const WEAK_AT = 34;
const strengthColor = (percentile, acc) => {
    if (percentile >= STRONG_AT) return acc;
    if (percentile < WEAK_AT) return '#ff8f70';
    return MUTED;
};

function DealLuckPanel({ rows, dealLuck, acc, rm }) {
    const [open, setOpen] = useState(false);

    // The union of rounds anyone was dealt into, not 1..roundNumber: a player
    // who joined mid-game has fewer, and a round in flight when the server
    // restarted was never scored at all.
    const rounds = useMemo(() => {
        const seen = new Set();
        for (const entry of Object.values(dealLuck || {})) {
            for (const r of entry.rounds || []) seen.add(r.round);
        }
        return [...seen].sort((a, b) => a - b);
    }, [dealLuck]);

    if (!dealLuck || rounds.length === 0) return null;

    return (
        <div className="mt-5">
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    width: '100%', padding: '9px 0', borderRadius: 12,
                    border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.28)',
                    color: MUTED, fontFamily: "'Outfit',sans-serif",
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                }}
            >
                Deal luck by round
                <span
                    aria-hidden="true"
                    style={{
                        fontSize: 11, display: 'inline-block',
                        transform: open ? 'rotate(180deg)' : 'none',
                        transition: rm ? undefined : 'transform .2s ease',
                    }}
                >▾</span>
            </button>

            {open && (
                <div
                    style={{
                        marginTop: 8, borderRadius: 14, padding: '12px 14px',
                        background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.09)',
                        ...(rm ? {} : { animation: 'cddToast .3s ease-out both' }),
                    }}
                >
                    <div style={{ color: FAINT, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
                        Deal strength each round &mdash; percentile of all possible hands
                    </div>
                    <div className="mb-[9px] flex flex-wrap items-center gap-x-[10px] gap-y-1">
                        {[[`${STRONG_AT}+ strong`, STRONG_AT], [`${WEAK_AT}–${STRONG_AT - 1} average`, WEAK_AT], [`under ${WEAK_AT} weak`, 0]].map(([label, at]) => (
                            <span key={label} className="flex items-center gap-[4px]" style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: strengthColor(at, acc), display: 'inline-block' }} />
                                {label}
                            </span>
                        ))}
                    </div>

                    {/* A standard game can run well past ten rounds, so the grid
                        scrolls inside itself rather than widening the page. */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: rounds.length * 30 + 120 }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', color: FAINT, fontSize: 10, fontWeight: 700, padding: '0 8px 6px 0' }} />
                                    {rounds.map(n => (
                                        <th
                                            key={n}
                                            style={{ color: FAINT, fontSize: 10, fontWeight: 700, padding: '0 0 6px', minWidth: 26 }}
                                        >R{n}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const entry = dealLuck[r.name];
                                    const byRound = new Map(
                                        (entry?.rounds || []).map(x => [x.round, x]));
                                    return (
                                        <tr key={r.key}>
                                            <td
                                                className="truncate"
                                                style={{
                                                    color: r.isYou ? acc : '#f4f5f7',
                                                    fontSize: 12, fontWeight: 700,
                                                    padding: '4px 8px 4px 0', maxWidth: 110,
                                                }}
                                            >{r.name}</td>
                                            {rounds.map(n => {
                                                const cell = byRound.get(n);
                                                return (
                                                    <td
                                                        key={n}
                                                        style={{
                                                            textAlign: 'center', padding: '4px 0',
                                                            fontSize: 12, fontWeight: 800,
                                                            // Unknown, not average: a seat that was
                                                            // never dealt this round has no deal.
                                                            color: cell ? strengthColor(cell.percentile, acc) : FAINT,
                                                        }}
                                                        // percentileFor uses the mid-rank
                                                        // convention, so it returns halves;
                                                        // rounded here rather than at the
                                                        // source so the mean stays exact.
                                                        title={cell
                                                            ? `Round ${n}: ${cell.tierLabel}, stronger than ${Math.round(cell.percentile)}% of deals (${cell.rank} of 4 at the table)`
                                                            : undefined}
                                                    >{cell ? Math.round(cell.percentile) : '–'}</td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

export default DealLuckPanel;
