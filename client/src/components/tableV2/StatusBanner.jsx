import { memo } from 'react';

// The status banner above the hand. Communicates whose turn it is / what to do.
const StatusBanner = memo(function StatusBanner({
    isMyTurn, mustBeat, trickWinPending, trickWinnerName,
    currentPlayerName, isFirstLead, acc, accGrad, rm,
}) {
    let text;
    let mine = false;

    if (trickWinPending) {
        text = trickWinnerName ? `${trickWinnerName} wins the trick` : 'Trick won';
    } else if (isMyTurn && mustBeat) {
        text = 'Your turn — beat it or pass';
        mine = true;
    } else if (isMyTurn) {
        text = isFirstLead ? 'Your turn — lead with 3♦' : 'Your turn';
        mine = true;
    } else {
        text = `${currentPlayerName || 'Opponent'} is thinking…`;
    }

    return (
        <div style={{ position: 'absolute', bottom: 308, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
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
