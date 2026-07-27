import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ALERT_RED } from '../../theme/tableTheme';
import PileCardGlyph from './PileCardGlyph';

// The coach: an owl who sits on the left edge of the Pass/Play row and tells
// you what to play, then tells you what you should have played.
//
// Two surfaces, one character:
//   - CoachButton, rendered inside ControlsRow next to Pass and Play, so the
//     ask sits exactly where the decision is made.
//   - CoachBubble, the speech bubble floating above the controls. It shows
//     either a hint you asked for or a note about the move you just made.
//
// Both are presentational. Every word, and the ranking behind it, comes from
// server/game/Coach.js — the client never second-guesses the suggestion.
//
// Suits are the one thing to be careful with here. The bubble's prose is
// suit-free by construction (Coach.js describes moves in ranks and shapes only,
// because the Pusoy Dos lens remaps suits per viewer), and the cards themselves
// are drawn with PileCardGlyph, which applies the lens. Never render a suit
// symbol straight from the payload.

export const COACH_EMOJI = '🦉';

const BAD_TONE = ALERT_RED;

/**
 * The owl button. Lives on the left edge of the Pass/Play row.
 *
 * Disabled off-turn rather than hidden: a control that appears and disappears
 * under your thumb is worse than one that greys out, and its absence would
 * read as the coach setting having switched itself off.
 */
export const CoachButton = memo(function CoachButton({ onAsk, canAsk, busy, acc }) {
    const live = canAsk && !busy;
    return (
        <button
            onClick={onAsk}
            disabled={!live}
            aria-label="Ask the coach what to play"
            title={canAsk ? 'Ask the coach' : 'The coach speaks up on your turn'}
            style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, lineHeight: 1,
                border: `1px solid ${live ? `${acc}88` : 'rgba(255,255,255,.12)'}`,
                background: live ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.28)',
                cursor: live ? 'pointer' : 'default',
                opacity: live ? 1 : 0.45,
                // Deliberately unanimated. The Play button beside it already
                // pulses to say "act now"; a second competing animation in the
                // same row would make neither of them mean anything.
                boxShadow: live ? '0 6px 14px rgba(0,0,0,.35)' : 'none',
            }}
        >
            <span style={{ filter: busy ? 'grayscale(1)' : 'none' }}>{COACH_EMOJI}</span>
        </button>
    );
});

/** The suggested / better move, drawn as real cards so the suit lens applies. */
function CardRow({ cards, fourColor, pusoyMode }) {
    if (!cards || cards.length === 0) return null;
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            {cards.map(c => (
                <PileCardGlyph
                    key={`${c.rank}-${c.suit}`}
                    rank={c.rank}
                    suit={c.suit}
                    fourColor={fourColor}
                    pusoyMode={pusoyMode}
                    size="log"
                />
            ))}
        </div>
    );
}

/**
 * The speech bubble.
 *
 * `message` is whatever the coach last said: a hint (`source: 'hint'`) or an
 * unprompted note about the move just made (`source: 'note'`). One slot for
 * both, because two stacked bubbles from the same character would be a
 * conversation the player did not have.
 */
const CoachBubble = memo(function CoachBubble({
    message, onDismiss, fourColor, pusoyMode, acc, rm, style,
}) {
    const bad = message?.tone === 'bad';
    const edge = bad ? BAD_TONE : acc;

    return (
        <AnimatePresence>
            {message && (
                <motion.div
                    key={message.id}
                    initial={rm ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
                    animate={rm ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={rm ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: rm ? 0.12 : 0.22 }}
                    role="status"
                    aria-live="polite"
                    style={{
                        position: 'absolute', bottom: 'calc(100% + 8px)', left: 10, right: 10,
                        zIndex: 60, pointerEvents: 'auto',
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '11px 12px', borderRadius: 14,
                        // Translucent so the table stays readable behind the
                        // coach, but blurred rather than merely faded: plain
                        // alpha let the pile cards and the accent-gold status
                        // banner read straight through the text. The blur keeps
                        // the sense of what is behind without any of its edges.
                        // Where backdrop-filter is unsupported the alpha alone
                        // still has to carry legibility, hence .82 and not less.
                        background: 'rgba(10,13,17,.82)',
                        backdropFilter: 'blur(16px) saturate(115%)',
                        WebkitBackdropFilter: 'blur(16px) saturate(115%)',
                        border: `1px solid ${edge}55`,
                        boxShadow: `0 12px 28px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04) inset`,
                        maxHeight: 220, overflowY: 'auto',
                        ...style,
                    }}
                >
                    <div
                        aria-hidden="true"
                        style={{
                            flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 18, background: `${edge}22`, border: `1px solid ${edge}44`,
                        }}
                    >
                        {COACH_EMOJI}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 13.5,
                            color: edge, marginBottom: 2,
                        }}>
                            {message.headline}
                        </div>
                        <div style={{
                            fontFamily: "'Outfit',sans-serif", fontSize: 12.5, lineHeight: 1.42,
                            color: 'rgba(244,245,247,.82)',
                        }}>
                            {message.detail}
                        </div>

                        {/* A note names the move you missed; a hint's cards are
                            already selected in your hand, so it does not. */}
                        {message.bestMoveLabel && (
                            <div style={{
                                fontFamily: "'Outfit',sans-serif", fontSize: 12.5, lineHeight: 1.42,
                                color: 'rgba(244,245,247,.95)', marginTop: 6,
                            }}>
                                Better: <strong>{message.bestMoveLabel}</strong>
                            </div>
                        )}
                        <CardRow cards={message.bestMoveCards} fourColor={fourColor} pusoyMode={pusoyMode} />

                        {message.factors?.length > 0 && (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                                {message.factors.map((f, i) => (
                                    <span
                                        key={i}
                                        style={{
                                            fontFamily: "'Outfit',sans-serif", fontSize: 10,
                                            padding: '2px 7px', borderRadius: 999,
                                            background: 'rgba(255,255,255,.07)',
                                            color: 'rgba(244,245,247,.62)',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {f.factor}
                                        {f.points !== null && f.points !== undefined && (
                                            <span style={{ opacity: 0.7 }}>
                                                {' '}{f.points > 0 ? '+' : ''}{f.points}
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Said only where MoveQuality reports the cost model is
                            not the model the bot itself uses — small hands the
                            endgame solver owns. Presenting a guess as a
                            correction is the one thing a coach must not do. */}
                        {message.confident === false && (
                            <div style={{
                                fontFamily: "'Outfit',sans-serif", fontSize: 10.5, marginTop: 7,
                                color: 'rgba(244,245,247,.45)', fontStyle: 'italic',
                            }}>
                                Close endgame — treat this as an opinion, not a rule.
                            </div>
                        )}
                    </div>

                    <button
                        onClick={onDismiss}
                        aria-label="Dismiss the coach"
                        style={{
                            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                            color: 'rgba(244,245,247,.45)', fontSize: 17, lineHeight: 1, padding: '0 2px',
                        }}
                    >
                        ×
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
});

export default CoachBubble;
