import { useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import ReviewMoment from './ReviewMoment';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// Worked examples of one kind of decision, drawn from recent games.
//
// The per-game review answers "how did that game go". This answers "show me
// what this number means" — the question every statistic provokes and which the
// stats page had no way to answer. It is reached from the numbers themselves,
// so the topic arrives already chosen and the tabs are there to move sideways
// rather than to pick a starting point.
//
// Cards are ReviewMoment, shared with the single-game review, plus a line
// saying which game each came from.

const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.4)';

const card = {
    background: 'linear-gradient(160deg,rgba(0,0,0,.42),rgba(0,0,0,.26))',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
};

const TOPICS = [
    {
        id: 'mistakes',
        label: 'Mistakes',
        blurb: 'Choices where a clearly better option was on the table.',
        empty: 'No clear mistakes in your recent games. Either you are playing well or there is not much history yet.',
    },
    {
        id: 'gambles',
        label: 'Gambles',
        blurb: 'Cards you committed that the table could have beaten — and what happened.',
        empty: 'No gambles worth showing yet. These appear when you spend a high card that was likely to be beaten.',
    },
    {
        id: 'best',
        label: 'Good calls',
        blurb: 'Positions you read correctly when it was not obvious.',
        empty: 'Nothing to show here yet. These appear when you find the top move in a genuinely hard spot.',
    },
];

function relativeDay(ms) {
    if (!ms) return null;
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

function TrainingV2({
    topic,
    onSetTopic,
    examples = [],
    gamesSearched = 0,
    totalFound = 0,
    fourColor = false,
    loading,
    error,
    onBack,
    onOpenGame,
}) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const [openIndex, setOpenIndex] = useState(0);

    const active = TOPICS.find((t) => t.id === topic) || TOPICS[0];

    const pill = (on) => ({
        flex: 1,
        padding: '9px 0',
        borderRadius: 12,
        border: `1px solid ${on ? acc : 'rgba(255,255,255,.14)'}`,
        background: on ? accGrad : 'rgba(0,0,0,.38)',
        color: on ? '#0b0d10' : MUTED,
        fontFamily: "'Outfit',sans-serif",
        fontWeight: 800,
        fontSize: 13,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    });

    return (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    watermarks={[
                        { suit: 'C', size: 150, rotate: -14, style: { top: 220, left: -46 } },
                        { suit: 'S', size: 165, rotate: 12, opacity: 0.03, style: { top: 460, right: -52 } },
                    ]}
                />
            }
        >
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-36 pt-safe-18 md:max-w-[720px] md:px-8">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: TEXT, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div style={{ color: TEXT, fontWeight: 800, fontSize: 17 }}>Training</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>

                <div className="mt-4 flex gap-[7px]">
                    {TOPICS.map((t) => (
                        <button key={t.id} onClick={() => { onSetTopic(t.id); setOpenIndex(0); }} style={pill(t.id === topic)}>
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="mt-3" style={{ ...card, padding: '12px 14px' }}>
                    <div style={{ color: 'rgba(244,245,247,.72)', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>
                        {active.blurb}
                    </div>
                    {!loading && !error && (
                        <div style={{ color: FAINT, fontSize: 11, fontWeight: 600, marginTop: 5 }}>
                            {totalFound === 0
                                ? `Searched your last ${gamesSearched} game${gamesSearched === 1 ? '' : 's'}`
                                : `${totalFound} found across your last ${gamesSearched} game${gamesSearched === 1 ? '' : 's'}${totalFound > examples.length ? ` · showing the top ${examples.length}` : ''}`}
                        </div>
                    )}
                </div>

                {loading && (
                    <div className="mt-3" style={card}>
                        <div style={{ color: MUTED, fontSize: 13, fontWeight: 600 }}>Replaying your recent games…</div>
                    </div>
                )}

                {!loading && error && (
                    <div className="mt-3" style={card}>
                        <div style={{ color: TEXT, fontWeight: 800, fontSize: 15 }}>Couldn&apos;t load examples</div>
                        <div className="mt-2" style={{ color: MUTED, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{error}</div>
                    </div>
                )}

                {!loading && !error && examples.length === 0 && (
                    <div className="mt-3" style={card}>
                        <div style={{ color: MUTED, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{active.empty}</div>
                    </div>
                )}

                {!loading && !error && examples.map((h, i) => (
                    <div key={`${h.gameId}-${h.roundNumber}-${h.ply}`}>
                        <ReviewMoment
                            h={h}
                            index={i}
                            fourColor={fourColor}
                            acc={acc}
                            rm={rm}
                            open={openIndex === i}
                            onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
                            context={relativeDay(h.playedAt)}
                        />
                        {openIndex === i && onOpenGame && (
                            <button
                                onClick={() => onOpenGame(h.gameId)}
                                className="mt-[6px] w-full"
                                style={{ padding: '9px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(0,0,0,.3)', color: MUTED, fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                            >
                                See the rest of that game →
                            </button>
                        )}
                    </div>
                ))}

                <div className="mt-4" style={{ color: FAINT, fontSize: 10, fontWeight: 600, lineHeight: 1.6, textAlign: 'center' }}>
                    Moves are compared against how the bot values the position. It plays well but it
                    isn&apos;t perfect, and it can&apos;t see the cards you couldn&apos;t either.
                </div>
            </div>
        </ScreenShell>
    );
}

export default TrainingV2;
