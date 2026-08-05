import { memo } from 'react';
import { SUIT_SYMBOLS } from '../../theme/tableTheme';
import { displaySuit } from '../../utils/suitLens';

// The status banner above the hand. Communicates whose turn it is / what to do.
// `placement` positions the banner absolutely; the default (null) renders it
// in normal flow, which is what both tables do — each places it in its bottom
// section above the controls, where it cannot collide with the pile.
const StatusBanner = memo(function StatusBanner({
    isMyTurn, mustBeat, trickWinPending, trickWinnerName,
    currentPlayerName, isFirstLead, acc, accGrad, rm, pusoyMode,
    placement = null, endgameNotice = null,
}) {
    let text;
    let mine = false;

    if (trickWinPending) {
        text = trickWinnerName ? `${trickWinnerName} wins the trick` : 'Trick won';
    } else if (isMyTurn && endgameNotice) {
        // The highest-single endgame rule is live and constrains this turn.
        // It outranks the ordinary turn prompt because it is the thing the
        // player has to know before choosing, and it names no card — the
        // Pusoy Dos lens would make any suit in it wrong for half the table.
        // No "Your turn —" prefix: the accent fill and pulse already say that,
        // and the row has to hold one line at 320px.
        text = endgameNotice;
        mine = true;
    } else if (isMyTurn && mustBeat) {
        text = 'Your turn — beat it or pass';
        mine = true;
    } else if (isMyTurn) {
        // The opener is always the underlying 3♦; under the Pusoy Dos lens that
        // card is drawn — and named here — as 3♣.
        text = isFirstLead
            ? `Your turn — lead with 3${SUIT_SYMBOLS[displaySuit('D', pusoyMode)]}`
            : 'Your turn';
        mine = true;
    } else {
        text = `${currentPlayerName || 'Opponent'} is thinking…`;
    }

    return (
        <div style={{
            ...(placement ? { position: 'absolute', ...placement } : null),
            display: 'flex', justifyContent: 'center', zIndex: 30,
        }}>
            <div style={{
                padding: '7px 20px', borderRadius: 12, fontWeight: 800, fontSize: 14,
                background: mine ? accGrad : 'rgba(0,0,0,.5)',
                color: mine ? '#0b0d10' : 'rgba(244,245,247,.75)',
                border: `1px solid ${mine ? acc : 'rgba(255,255,255,.1)'}`,
                animation: mine && !rm ? 'cddPulse 1.6s ease-in-out infinite' : 'none',
                whiteSpace: 'nowrap',
            }}>
                {text}
            </div>
        </div>
    );
});

export default StatusBanner;
