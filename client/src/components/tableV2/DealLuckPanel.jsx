import { useMemo, useState } from 'react';

// The game-over drill-in: how the deal treated each seat, round by round.
//
// Two different questions, deliberately answered by two different numbers. The
// standings row carries the *absolute* tier (Rough -> Premium), which means the
// same thing from one game to the next. This grid carries the per-round *rank*
// at the table, which needs no calibration and is the legible form -- "won
// holding the worst hand" reads without any statistical literacy.
//
// Rank compares all four dealt hands, so it only exists here: the server sends
// dealLuck on game_over alone, never on round_over or in room state, or it
// would be a live read on opponents' holdings.

const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';
const WORST = '#ff8f70';

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

    const rankColor = (rank) => {
        if (rank === 1) return acc;
        if (rank === 4) return WORST;
        return MUTED;
    };

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
                    <div style={{ color: FAINT, fontSize: 10, fontWeight: 700, marginBottom: 9 }}>
                        Rank of each player&rsquo;s dealt hand, 1 = best at the table
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
                                                            // never dealt this round has no rank.
                                                            color: cell ? rankColor(cell.rank) : FAINT,
                                                        }}
                                                        title={cell ? `Round ${n}: ${cell.tierLabel}` : undefined}
                                                    >{cell ? cell.rank : '–'}</td>
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
