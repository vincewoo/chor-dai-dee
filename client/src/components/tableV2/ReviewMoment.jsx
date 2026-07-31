import PileCardGlyph from './PileCardGlyph';

// One reviewed decision, rendered as a collapsible card.
//
// Shared by the single-game review (GameReviewV2) and the cross-game training
// page (TrainingV2), on the same reasoning as RoundLogRows: two surfaces
// showing the same thing must not be able to drift apart.
//
// The comparison is the whole point, so the move made and the move the bot
// preferred sit directly above one another at the same card size - the eye
// should be able to spot the difference without reading anything.

const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.4)';
const GOOD = '#6ee7a8';
const BAD = '#ff8f70';

const card = {
    background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
};

const CardRow = ({ cards, fourColor, scale = 0.72, dim = false }) => (
    <div className="flex flex-wrap items-center gap-[3px]" style={dim ? { opacity: 0.55 } : undefined}>
        {cards.map((c, i) => (
            <PileCardGlyph key={`${c.rank}${c.suit}${i}`} rank={c.rank} suit={c.suit}
                fourColor={fourColor} size="log" scale={scale} />
        ))}
    </div>
);

const Label = ({ children }) => (
    <div style={{ color: FAINT, fontSize: 10, fontWeight: 800, letterSpacing: 1.4, marginBottom: 5 }}>
        {children}
    </div>
);

/**
 * One moment.
 *
 * The comparison is the whole point, so the move made and the move the bot
 * preferred sit directly above one another with the same card size - the eye
 * should be able to spot the difference without reading anything.
 */
function ReviewMoment({ h, fourColor, acc, index, rm, open, onToggle, context = null }) {
    const tone = h.tone === 'good' ? GOOD : BAD;
    const madeADifferentMove = h.bestMove && h.bestMove !== 'pass'
        ? h.bestMove !== (h.cardsPlayed || []).map((c) => `${c.rank}${c.suit}`).join(' ')
        : h.action !== 'pass';

    return (
        <div
            className="mt-[10px]"
            style={{
                ...card,
                padding: 0,
                borderColor: `${tone}44`,
                ...(rm ? {} : { animation: `cddToast .35s ${0.04 * index}s ease-out both` }),
            }}
        >
            <button
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full items-center gap-[10px] text-left"
                style={{ padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
                <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 3, background: tone, flexShrink: 0, minHeight: 30 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: tone, fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>{h.title}</div>
                    <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                        Round {h.roundNumber}
                        {h.rank > 1 && ` · your move ranked ${h.rank} of ${h.optionCount}`}
                        {h.rank === 1 && ' · top-ranked move'}
                        {/* Which game this came from. Only the training page
                            passes it; inside one game's review it is noise. */}
                        {context && ` · ${context}`}
                    </div>
                </div>
                <div style={{ color: FAINT, fontSize: 15, flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: rm ? undefined : 'transform .2s ease' }}>›</div>
            </button>

            {open && (
                <div style={{ padding: '0 14px 14px' }}>
                    <div style={{ color: 'rgba(244,245,247,.72)', fontSize: 12, fontWeight: 600, lineHeight: 1.5, marginBottom: 12 }}>
                        {h.detail}
                    </div>

                    <div style={{ background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: 12 }}>
                        {/* The hand held at that moment — without it the table,
                            the move and the alternative can't be judged. */}
                        {h.hand?.length > 0 && (
                            <div className="mb-3">
                                <Label>YOUR HAND</Label>
                                <CardRow cards={h.hand} fourColor={fourColor} scale={0.6} />
                            </div>
                        )}
                        <Label>{h.pile ? 'ON THE TABLE' : 'YOU WERE ON LEAD'}</Label>
                        {h.pile
                            ? <CardRow cards={h.pile.cards} fourColor={fourColor} />
                            : <div style={{ color: FAINT, fontSize: 11, fontWeight: 600 }}>Nothing to beat — free choice.</div>}

                        <div className="mt-3">
                            <Label>YOU PLAYED</Label>
                            {h.action === 'pass'
                                ? <div style={{ color: TEXT, fontSize: 13, fontWeight: 800 }}>Passed</div>
                                : <CardRow cards={h.cardsPlayed} fourColor={fourColor} />}
                        </div>

                        {madeADifferentMove && (
                            <div className="mt-3">
                                <Label style={{ color: acc }}>BETTER</Label>
                                {h.bestMove === 'pass'
                                    ? <div style={{ color: acc, fontSize: 13, fontWeight: 800 }}>Pass</div>
                                    : <CardRow cards={h.bestMoveCards || []} fourColor={fourColor} />}
                            </div>
                        )}
                    </div>

                    {h.bestMoveFactors?.length > 0 && (
                        <div className="mt-3">
                            <Label>WHY</Label>
                            <div className="flex flex-col gap-[3px]">
                                {h.bestMoveFactors.map((f, i) => (
                                    <div key={i} className="flex items-baseline justify-between gap-2">
                                        <span style={{ color: 'rgba(244,245,247,.68)', fontSize: 11, fontWeight: 600 }}>{f.factor}</span>
                                        <span style={{ color: f.points >= 0 ? GOOD : BAD, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                                            {f.points >= 0 ? '+' : ''}{Math.round(f.points)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* The half a live hint could never give. */}
                    <div className="mt-3">
                        <Label>WHAT YOU COULDN&apos;T SEE</Label>
                        <div className="flex flex-col gap-[6px]">
                            {/* opponentHands is rotated to the reviewed seat
                                (0 = you, always null) so these labels hold
                                from any chair. */}
                            {h.opponentHands.map((oppHand, offset) => oppHand && (
                                <div key={offset} className="flex items-center gap-[7px]">
                                    <span style={{ color: FAINT, fontSize: 10, fontWeight: 800, width: 44, flexShrink: 0 }}>
                                        {['You', 'Next', 'Across', 'Prev'][offset]}
                                    </span>
                                    <CardRow cards={oppHand} fourColor={fourColor} scale={0.56} dim />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ReviewMoment;
