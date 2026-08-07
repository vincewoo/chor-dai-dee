import { useState } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import BackButton from './BackButton';
import ReviewMoment from './ReviewMoment';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// Game review: the handful of decisions in one finished game worth a second
// look. Same shell language as StatsV2 / LeaderboardV2 (surface wash, suit
// watermarks, HUD row, card sections); all fetching lives in the GameReview
// container.
//
// The page deliberately reads as a set of moments rather than a table of
// scores. A player can act on "you had a forced win and led a six instead" and
// cannot act on a percentile, so every entry leads with a sentence, shows the
// position, and only then offers the numbers.
//
// Each moment stays collapsed to its headline until opened. Six expanded cards
// with four hands apiece is a wall, and the ranking already did the work of
// deciding what to read first. The card itself is ReviewMoment, shared with the
// cross-game training page.

// Reasons the server can decline, each with something the player can do about
// it. A review is missing far more often than it is wrong - most games predate
// logging or have aged out - so these are phrased as facts, not failures.
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

const UNAVAILABLE = {
    no_tape: {
        title: 'No review for this game',
        body: 'Move-by-move history is only kept for recent games. This one is past that window, or was played before reviews existed.',
    },
    game_in_progress: {
        title: 'This game is still going',
        body: 'Reviews open up once a game finishes — they show every hand at the table, so they have to wait for the end.',
    },
    not_a_participant: {
        title: 'You did not play in this game',
        body: 'Reviews are only available for your own games.',
    },
    logging_disabled: {
        title: 'Reviews are switched off',
        body: 'Game history recording is disabled on this server.',
    },
};


function GameReviewV2({
    highlights = [],
    summary,
    gameMode,
    totalRounds,
    fourColor = false,
    loading,
    error,
    errorReason,
    onBack,
}) {
    const { acc, soft, surface, rm } = useTableTheme();
    // The first moment opens by default: the ranking already decided it is the
    // one to read, and a page of collapsed rows gives no reason to tap.
    const [openIndex, setOpenIndex] = useState(0);

    const shell = (children) => (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    watermarks={[
                        { suit: 'H', size: 150, rotate: -14, style: { top: 220, left: -46 } },
                        { suit: 'D', size: 165, rotate: 12, opacity: 0.03, style: { top: 460, right: -52 } },
                    ]}
                />
            }
        >
            {/* pb-9 with no safe-area inset: AppShell's tab bar sits below this screen
                in flow and owns the bottom safe-area inset. */}
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-9 pt-safe-18 md:max-w-[720px] md:px-8">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <BackButton onClick={onBack} />
                        <div style={{ color: TEXT, fontWeight: 800, fontSize: 17 }}>Review</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>
                {children}
            </div>
        </ScreenShell>
    );

    if (loading) {
        return shell(
            <div className="mt-6" style={card}>
                <div style={{ color: MUTED, fontSize: 13, fontWeight: 600 }}>Replaying the game…</div>
            </div>
        );
    }

    if (error) {
        const known = UNAVAILABLE[errorReason];
        return shell(
            <div className="mt-6" style={card}>
                <div style={{ color: TEXT, fontWeight: 800, fontSize: 16 }}>
                    {known ? known.title : 'Could not load the review'}
                </div>
                <div className="mt-2" style={{ color: MUTED, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                    {known ? known.body : error}
                </div>
                <button
                    onClick={onBack}
                    className="mt-4 w-full"
                    style={{ padding: '12px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.38)', color: TEXT, fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
                >Back</button>
            </div>
        );
    }

    const errors = highlights.filter((h) => h.tone === 'bad').length;
    const graded = summary?.decisionsWithAChoice || 0;

    return shell(
        <>
            <div
                className="mt-4"
                style={{ ...card, padding: '13px 14px', ...(rm ? {} : { animation: 'cddToast .35s ease-out both' }) }}
            >
                <div style={{ color: TEXT, fontWeight: 800, fontSize: 15 }}>
                    {highlights.length === 0
                        ? 'Nothing stood out'
                        : errors === 0
                            ? 'A clean game'
                            : `${errors} moment${errors === 1 ? '' : 's'} worth a look`}
                </div>
                <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, marginTop: 3 }}>
                    {totalRounds} round{totalRounds === 1 ? '' : 's'} · {gameMode === 'short' ? 'short' : 'standard'} game
                    {graded > 0 && ` · ${graded} real decisions`}
                </div>
            </div>

            {highlights.length === 0 ? (
                <div className="mt-3" style={card}>
                    <div style={{ color: MUTED, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                        No decision in this game was clearly better played another way. Forced moves and
                        close calls aren&apos;t counted — only choices where one option was plainly stronger.
                    </div>
                </div>
            ) : (
                highlights.map((h, i) => (
                    <ReviewMoment
                        key={`${h.roundNumber}-${h.ply}`}
                        h={h}
                        index={i}
                        fourColor={fourColor}
                        acc={acc}
                        rm={rm}
                        open={openIndex === i}
                        onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
                    />
                ))
            )}

            {/* Said once, at the bottom, rather than hedged on every card. The
                yardstick is a strong heuristic, not a solver, and Big 2 is a
                game of hidden information - some good plays will grade badly. */}
            <div className="mt-4" style={{ color: FAINT, fontSize: 10, fontWeight: 600, lineHeight: 1.6, textAlign: 'center' }}>
                Moves are compared against how the bot values the position. It plays well but it
                isn&apos;t perfect, and it can&apos;t see the cards you couldn&apos;t either.
            </div>
        </>
    );
}

export default GameReviewV2;
