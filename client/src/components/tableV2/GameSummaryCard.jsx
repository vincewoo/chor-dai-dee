import { useTableTheme } from '../../theme/tableTheme';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { ordinalSuffix } from '../../utils/gameSummary';
import MaxBotsChip from './MaxBotsChip';
import RoundReviewPanel from './RoundReviewPanel';

// One finished (or abandoned) game, expandable in place. The Activity feed and
// the home screen's Recent list both draw it, from the same `/api/activity` row
// via `buildGameCard`.
//
// The two differ only in their *collapsed header*, which is the `variant`:
//   'feed'    — a bordered card in a grid, chips row + winner line, self-glow.
//   'compact' — a hairline row inside the home screen's frosted shell, whose
//               meta line names the opponents ("beat Bot 3, Bot 4") rather than
//               the duration. Home queries `status=completed`, so the QUIT and
//               PRIVATE chips could never fire there and the mode chip would
//               only repeat the "Short ·" already leading its meta line.
//
// The expanded body — standings, deal strength, the round-review grid and the
// route into the move review — is identical and unconditional, because that is
// the part that drifted: home used to open a legacy dialog that had none of it.
//
// Expansion state lives in the parent list so the cards behave as an accordion;
// the review itself is fetched by the parent (`useRoundReviews`) on expand.

const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.5)';
const FAINT = 'rgba(244,245,247,.38)';
const FONT = "'Outfit',sans-serif";

const chip = {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: .6,
    padding: '3px 8px',
    borderRadius: 7,
    whiteSpace: 'nowrap',
};

function GameSummaryCard({
    card,
    variant = 'feed',
    username,
    expanded = false,
    onToggle,
    // undefined = not loaded yet, null = this game predates the feature.
    review = null,
    onReview,
    // 'compact' only: the first row in the shell draws no separator.
    isFirst = false,
    // 'feed' only: staggers the entry animation down the grid.
    index = 0,
}) {
    const { acc, soft, rm } = useTableTheme();
    const compact = variant === 'compact';

    // Games swept out of the historic 'in_progress' backlog never had
    // participants written, so there are no standings to open.
    const canExpand = card.participants.length > 0;
    const open = canExpand && expanded;

    const toggle = () => {
        if (!canExpand) return;
        onToggle?.(open ? null : card.id);
    };

    const container = compact
        ? {
            width: '100%',
            padding: '12px 14px',
            boxSizing: 'border-box',
            borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,.07)',
            background: 'none',
            fontFamily: FONT,
            cursor: canExpand ? 'pointer' : 'default',
        }
        : {
            background: card.hasMe
                ? 'linear-gradient(160deg,rgba(0,0,0,.52),rgba(0,0,0,.34))'
                : 'rgba(0,0,0,.34)',
            border: `1px solid ${card.hasMe ? `${acc}55` : 'rgba(255,255,255,.09)'}`,
            borderRadius: 16,
            padding: '12px 14px',
            cursor: canExpand ? 'pointer' : 'default',
            boxShadow: card.hasMe ? `0 0 16px ${soft}` : 'none',
            fontFamily: FONT,
            ...(rm ? {} : { animation: `cddToast .35s ${(Math.min(index, 8) * 0.04).toFixed(2)}s ease-out both` }),
        };

    const chevron = canExpand && (
        <span
            aria-hidden="true"
            style={{
                color: FAINT,
                fontSize: 12,
                display: 'inline-block',
                flexShrink: 0,
                transform: open ? 'rotate(180deg)' : 'none',
                transition: rm ? undefined : 'transform .2s ease',
            }}
        >▾</span>
    );

    // An abandoned game has no winner, so it gets a door instead of a crowned
    // avatar. Home only ever asks for completed games, but the card does not
    // depend on its caller's filter to stay honest.
    const winnerAvatar = (size, emojiSize, crownSize) => (
        <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: size, height: size, borderRadius: size === 38 ? 12 : 11, background: card.abandoned ? 'rgba(255,143,112,.14)' : getAvatarTile(card.winnerName || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: emojiSize, ...(compact ? { border: '1.5px solid rgba(12,32,22,.65)' } : {}) }}>
                {card.abandoned ? '🚪' : getAvatarEmoji(card.winnerName || '?')}
            </div>
            {!card.abandoned && (
                <span aria-hidden="true" style={{ position: 'absolute', top: compact ? -7 : -8, left: compact ? -5 : -4, fontSize: crownSize }}>👑</span>
            )}
        </div>
    );

    const compactMeta = [
        card.mode === 'short' ? 'Short' : 'Standard',
        card.rounds ? `${card.rounds} round${card.rounds === 1 ? '' : 's'}` : null,
        card.participants.length > 1
            ? `beat ${card.participants.slice(1).map((p) => p.username).join(', ')}`
            : null,
    ].filter(Boolean).join(' · ');

    return (
        // A div with button semantics, not a <button>: the expanded body
        // contains the round review's own toggle and the review link, and a
        // button inside a button is not parseable HTML. Keyboard and ARIA
        // behaviour are kept by hand so this is a change of element, not of
        // affordance.
        <div
            role={canExpand ? 'button' : undefined}
            tabIndex={canExpand ? 0 : undefined}
            onClick={(e) => {
                // A click on a control inside the expanded body must not also
                // toggle the card underneath it.
                if (e.target.closest('button')) return;
                toggle();
            }}
            onKeyDown={(e) => {
                // Only the card's own key events. The expanded body holds the
                // round review's toggle, and Enter/Space on that bubbles up
                // here -- which swallowed the keypress and collapsed the whole
                // card instead of opening the grid, leaving the inner control
                // reachable by mouse only.
                if (e.target !== e.currentTarget) return;
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                toggle();
            }}
            aria-expanded={canExpand ? open : undefined}
            className="text-left"
            style={container}
        >
            {compact ? (
                <div className="flex items-center" style={{ gap: 11 }}>
                    {winnerAvatar(32, 18, 12)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ color: card.abandoned ? MUTED : TEXT, fontWeight: 700, fontSize: 14 }}>
                            {card.abandoned
                                ? 'Nobody finished'
                                : (card.winnerName ? `${card.winnerName} won` : 'Game finished')}
                        </div>
                        <div className="truncate" style={{ color: MUTED, fontSize: 11, fontWeight: 600 }}>{compactMeta}</div>
                    </div>
                    {/* Outside the truncating block, so a long winner name
                        shortens instead of hiding the badge. */}
                    {card.maxBots && <MaxBotsChip />}
                    <span style={{ color: FAINT, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{card.when}</span>
                    {chevron}
                </div>
            ) : (
                <>
                    {/* Meta row. Wraps rather than overflows: mode is always
                        there, and a game can carry all three of QUIT, PRIVATE
                        and MAX BOTS at once, which does not fit one line beside
                        the timestamp at 320px. */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-[6px]" style={{ minWidth: 0 }}>
                            <span style={{ ...chip, background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(244,245,247,.75)' }}>
                                {card.mode === 'short' ? '⚡ SHORT' : '🏆 STANDARD'}
                            </span>
                            {card.abandoned && (
                                <span style={{ ...chip, background: 'rgba(255,143,112,.15)', border: '1px solid rgba(255,143,112,.35)', color: '#ff8f70' }}>
                                    QUIT
                                </span>
                            )}
                            {card.isPrivate && (
                                <span style={{ ...chip, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: MUTED }}>
                                    PRIVATE
                                </span>
                            )}
                            {card.maxBots && <MaxBotsChip />}
                        </div>
                        <span style={{ color: 'rgba(244,245,247,.42)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {card.when || 'In progress'}
                        </span>
                    </div>

                    <div className="mt-[10px] flex items-center gap-[11px]">
                        {winnerAvatar(38, 21, 14)}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="truncate" style={{ color: card.abandoned ? 'rgba(244,245,247,.6)' : (card.winnerIsMe ? acc : TEXT), fontWeight: 700, fontSize: 14 }}>
                                {card.abandoned ? 'Nobody finished' : (card.winnerName || 'No winner')}
                                {!card.abandoned && card.winnerIsMe && <span style={{ color: MUTED, fontWeight: 600 }}> · you</span>}
                            </div>
                            <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 11, fontWeight: 600 }}>
                                {/* Games swept from the historic 'in_progress'
                                    backlog have no participant rows at all. */}
                                {card.participants.length > 0
                                    ? `${card.participants.length} players`
                                    : 'Players unknown'}
                                {card.rounds ? ` · ${card.rounds} round${card.rounds === 1 ? '' : 's'}` : ''}
                                {card.duration ? ` · ${card.duration}` : ''}
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {card.highlights > 0 && (
                                <span style={{ color: acc, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>⭐ {card.highlights}</span>
                            )}
                            {chevron}
                        </div>
                    </div>
                </>
            )}

            {open && (
                <div className="mt-3 flex flex-col gap-[6px]" style={{ borderTop: '1px solid rgba(255,255,255,.09)', paddingTop: 10 }}>
                    {card.participants.map((p, idx) => {
                        const first = p.placement === 1;
                        const isMe = p.username === username;
                        const deal = review?.[p.username];
                        return (
                            <div key={`${p.username}-${idx}`} className="flex items-center gap-[10px]">
                                <div style={{ width: 16, textAlign: 'center', color: first ? acc : 'rgba(244,245,247,.4)', fontWeight: 800, fontSize: 12 }}>
                                    {p.placement ?? '–'}
                                </div>
                                <div style={{ width: 26, height: 26, borderRadius: 9, background: getAvatarTile(p.username), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                                    {getAvatarEmoji(p.username)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="truncate" style={{ color: isMe ? acc : TEXT, fontWeight: 700, fontSize: 12 }}>
                                        {p.username}
                                        {p.isBot ? <span style={{ color: 'rgba(244,245,247,.4)', fontWeight: 600 }}> · bot</span> : null}
                                    </div>
                                    {/* Placement is the number in the left gutter, so naming
                                        it again here spends the line on nothing -- same
                                        reasoning as the game-over standings. It survives only
                                        for an abandoned game, where the gutter shows a dash
                                        because there is no final standing. */}
                                    <div style={{ color: 'rgba(244,245,247,.4)', fontSize: 10, fontWeight: 600 }}>
                                        {[
                                            // No placement means no gutter number to be
                                            // redundant with, so this still earns its space.
                                            p.placement
                                                ? null
                                                : (card.abandoned ? 'Score when abandoned' : 'Unranked'),
                                            // Nothing recorded for this game: fall back to the
                                            // placement rather than leaving an empty line.
                                            (!deal?.dealRank && p.placement)
                                                ? (first ? 'Winner' : `${p.placement}${ordinalSuffix(p.placement)} place`)
                                                : null,
                                            // What they did, then the cards they did it with.
                                            p.roundsWon
                                                ? `${p.roundsWon} round${p.roundsWon === 1 ? '' : 's'} won`
                                                : null,
                                            deal?.dealRank
                                                ? `Deal strength: ${deal.dealRank}${ordinalSuffix(deal.dealRank)}`
                                                  + ` (${deal.avgPercentile}${ordinalSuffix(deal.avgPercentile)} pct)`
                                                : null,
                                        ].filter(Boolean).join(' · ')}
                                    </div>
                                </div>
                                <div style={{ color: TEXT, fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
                                    {p.score ?? 0} <span style={{ color: 'rgba(244,245,247,.4)', fontSize: 10, fontWeight: 600 }}>pts</span>
                                </div>
                            </div>
                        );
                    })}

                    {/* The same panel the game-over screen draws, from the same
                        recorded data, so the two cannot describe one game
                        differently. Absent for games played before it was
                        recorded. */}
                    <div onClick={(e) => e.stopPropagation()}>
                        <RoundReviewPanel
                            rows={card.participants.map((p) => ({
                                key: p.username,
                                name: p.username,
                                isYou: p.username === username,
                            }))}
                            roundReview={review}
                            acc={acc}
                            rm={rm}
                        />
                    </div>

                    {card.canReview && onReview && (
                        <button
                            onClick={() => onReview(card.id)}
                            style={{ marginTop: 8, width: '100%', padding: '11px 0', borderRadius: 12, border: `1px solid ${acc}66`, background: `${acc}18`, color: acc, fontFamily: FONT, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                        >🔍 Review my moves</button>
                    )}
                </div>
            )}
        </div>
    );
}

export default GameSummaryCard;
