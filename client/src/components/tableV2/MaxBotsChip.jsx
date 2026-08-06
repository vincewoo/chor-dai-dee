import { useTableTheme } from '../../theme/tableTheme';

// The badge for a game whose bots were pinned to max difficulty by the waiting
// room's toggle, drawn wherever a finished game is summarised: `GameOverV2` at
// the moment it ends, then the activity feed, the home screen's Recent list and
// the score dialog that list opens.
//
// Accent gold rather than the warm red QUIT wears or the faint grey of PRIVATE.
// Those two are caveats on a game; this is the opposite - an opt-in, host-chosen
// challenge against the known-strongest opponent, and the reason to surface it
// at all is that it is worth showing off.
//
// Deliberately the ONLY difficulty a viewer is ever shown. Every other game runs
// `adaptive`, whose strength is a continuous temperature derived from the
// table's private skill calibration; the feed is public, so rendering that would
// publish every player's hidden estimate to everyone else. See
// docs/BOT-DIFFICULTY.md.
//
// Whether to draw it is never decided here. For a recorded game the server
// computes it once (`max_bots`, db.getActivityFeed), which also answers whether
// the game seated a bot for the setting to apply to; `GameOverV2` applies the
// same two-part gate to the live room.
function MaxBotsChip() {
    const { acc } = useTableTheme();

    return (
        <span
            title="Bots were set to max difficulty"
            style={{
                background: `${acc}1f`,
                border: `1px solid ${acc}55`,
                color: acc,
                fontFamily: "'Outfit',sans-serif",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: .6,
                padding: '3px 8px',
                borderRadius: 7,
                whiteSpace: 'nowrap',
                flexShrink: 0,
            }}
        >
            ⚔️ MAX BOTS
        </span>
    );
}

export default MaxBotsChip;
