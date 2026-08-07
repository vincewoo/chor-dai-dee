import { useMemo, useState } from 'react';

// The game-over drill-in: how the deal treated each seat, round by round.
//
// Each cell carries both halves of the question on separate channels -- the
// number is the deal's absolute strength (percentile of all possible hands),
// the colour is where it placed at this table. They usually agree; the reason
// to show both is the rounds where they don't, which is where "won without the
// cards" actually lives.
//
// Rank compares all four dealt hands, so it only exists here: the server sends
// dealLuck on game_over alone, never on round_over or in room state, or it
// would be a live read on opponents' holdings.

const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';

// Two facts per cell, on two channels that do not collide: the *number* is how
// strong the deal was in absolute terms (percentile of all possible deals), and
// the *colour* is where it placed at this table. A player can read either one
// alone -- "I kept drawing 70s" or "I kept coming last" -- and the interesting
// case is when they disagree.
//
// Ordered best to worst and borrowed from the palette already in use for scores
// (ScoreCorner's green/amber/red ramp) so the screen stays one system.
const RANK_COLORS = ['#f0b429', '#6ee7a8', '#ffab6b', '#ff8f70'];
const rankColor = (rank, acc) => (rank === 1 ? acc : RANK_COLORS[rank - 1] || MUTED);

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
                        {['best at table', '2nd', '3rd', 'worst'].map((label, i) => (
                            <span key={label} className="flex items-center gap-[4px]" style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: rankColor(i + 1, acc), display: 'inline-block' }} />
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
                                                            color: cell ? rankColor(cell.rank, acc) : FAINT,
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
