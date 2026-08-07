import { useMemo, useState } from 'react';

// The game-over drill-in: a round-by-round scoreboard, with the deal that
// produced each score underneath it.
//
// Points are the primary reading — this is a review of how the game was
// actually lost — and the deal percentile sits under each one as the context
// that says whether a bad round was bad luck or bad play. A 39 under a 12 is a
// different story from a 39 under an 88, and neither number tells it alone.
//
// The per-round deal comparison (`rank`) exists only here: the server sends
// roundReview on game_over alone, never on round_over or in room state, or it
// would be a live read on opponents' holdings. See DealStrength.rankTable.

const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';

// Colour bands the deal percentile, not the points: the points are already
// legible as a number, and banding them would double up. Deliberately not the
// rank at the table either — rank is relative, so in a round where all four
// hands were scraps somebody still places first, and colouring that gold would
// call a bad hand good.
//
// Thirds of the scale. Wide on purpose: raw deal strength spans -9..19 and
// adjacent percentiles share values, so a finer ramp would imply precision the
// metric does not have.
const STRONG_AT = 67;
const WEAK_AT = 34;
const strengthColor = (percentile, acc) => {
    if (percentile >= STRONG_AT) return acc;
    if (percentile < WEAK_AT) return '#ff8f70';
    return MUTED;
};

function RoundReviewPanel({ rows, roundReview, acc, rm }) {
    const [open, setOpen] = useState(false);

    // The union of rounds anyone was dealt into, not 1..roundNumber: a player
    // who joined mid-game has fewer, and a round in flight when the server
    // restarted was never scored at all.
    const rounds = useMemo(() => {
        const seen = new Set();
        for (const entry of Object.values(roundReview || {})) {
            for (const r of entry.rounds || []) seen.add(r.round);
        }
        return [...seen].sort((a, b) => a - b);
    }, [roundReview]);

    if (!roundReview || rounds.length === 0) return null;

    const cellNum = { fontSize: 13, fontWeight: 800, lineHeight: 1.15 };
    const cellPct = { fontSize: 9, fontWeight: 700, lineHeight: 1.3 };

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
                Round by round
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
                    <div style={{ color: FAINT, fontSize: 10, fontWeight: 700, marginBottom: 5 }}>
                        Points scored each round, over the strength of the deal that round
                    </div>
                    <div className="mb-[10px] flex flex-wrap items-center gap-x-[10px] gap-y-1">
                        <span className="flex items-center gap-[4px]" style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: acc, display: 'inline-block' }} />
                            won the round
                        </span>
                        <span style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>deal:</span>
                        {[[`${STRONG_AT}+`, STRONG_AT], [`${WEAK_AT}–${STRONG_AT - 1}`, WEAK_AT], [`under ${WEAK_AT}`, 0]].map(([label, at]) => (
                            <span key={label} className="flex items-center gap-[4px]" style={{ color: FAINT, fontSize: 10, fontWeight: 700 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: strengthColor(at, acc), display: 'inline-block' }} />
                                {label}
                            </span>
                        ))}
                    </div>

                    {/* A standard game can run past fifteen rounds, so the grid
                        scrolls inside itself rather than widening the page. */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: rounds.length * 34 + 150 }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '0 8px 6px 0' }} />
                                    {rounds.map(n => (
                                        <th key={n} style={{ color: FAINT, fontSize: 10, fontWeight: 700, padding: '0 0 6px', minWidth: 30 }}>R{n}</th>
                                    ))}
                                    <th style={{ color: FAINT, fontSize: 10, fontWeight: 700, padding: '0 0 6px 10px', minWidth: 38 }}>TOTAL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const entry = roundReview[r.name];
                                    const byRound = new Map((entry?.rounds || []).map(x => [x.round, x]));
                                    return (
                                        <tr key={r.key}>
                                            <td
                                                className="truncate"
                                                style={{
                                                    color: r.isYou ? acc : TEXT, fontSize: 12, fontWeight: 700,
                                                    padding: '5px 8px 5px 0', maxWidth: 110,
                                                }}
                                            >{r.name}</td>
                                            {rounds.map(n => {
                                                const cell = byRound.get(n);
                                                return (
                                                    <td
                                                        key={n}
                                                        style={{
                                                            textAlign: 'center', padding: '3px 1px',
                                                            background: cell?.won ? `${acc}1f` : undefined,
                                                            borderRadius: cell?.won ? 6 : undefined,
                                                        }}
                                                        title={cell
                                                            ? `Round ${n}: ${cell.points ?? '—'} pts, dealt ${cell.tierLabel} `
                                                              + `(stronger than ${Math.round(cell.percentile)}% of deals, `
                                                              + `${cell.rank} of 4 at the table)`
                                                            : undefined}
                                                    >
                                                        {/* Points, then the deal that produced them.
                                                            A dealt-but-never-scored round shows a dash:
                                                            0 is the winner's score, so it cannot be the
                                                            placeholder for "unknown". */}
                                                        <div style={{ ...cellNum, color: cell?.won ? acc : TEXT }}>
                                                            {cell ? (cell.points ?? '–') : '–'}
                                                        </div>
                                                        <div style={{ ...cellPct, color: cell ? strengthColor(cell.percentile, acc) : FAINT }}>
                                                            {cell ? Math.round(cell.percentile) : '–'}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                            <td style={{ textAlign: 'center', padding: '3px 0 3px 10px' }}>
                                                <div style={{ ...cellNum, color: TEXT }}>{entry?.totalPoints ?? '–'}</div>
                                                <div style={{ ...cellPct, color: FAINT }}>
                                                    {entry?.roundsWon ? `${entry.roundsWon}W` : ''}
                                                </div>
                                            </td>
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

export default RoundReviewPanel;
