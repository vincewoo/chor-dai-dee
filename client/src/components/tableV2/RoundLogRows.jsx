import PileCardGlyph from './PileCardGlyph';
import { getAvatarEmoji, getAvatarTile } from '../../utils/avatars';
import { describeHand } from '../../theme/tableTheme';

// The per-play rows of the round log, most recent first, with a divider at the
// head of each trick. Shared by the mobile bottom sheet (RoundLogSheet) and the
// persistent desktop rail (RoundLogPanel) so there is one renderer.
//
// The reverse-chronological order is deliberate (the play you tapped to review
// is the top row), but on its own it reads like a story told backwards — a
// trick-opening pass at the top of the list looks illegal. Each row therefore
// carries its chronological move number, so the direction is legible from any
// row, not just from a header the reader may have scrolled past.
function RoundLogRows({ log, acc, fourColor, pusoyMode, emptyText = 'No plays yet.' }) {
    const rows = [...log].reverse();
    const total = rows.length;

    if (rows.length === 0) {
        return (
            <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 13, textAlign: 'center', padding: '18px 0' }}>
                {emptyText}
            </div>
        );
    }

    return rows.map((e, i) => {
        const showHead = i === 0 || rows[i - 1].trick !== e.trick;
        const moveNo = total - i; // chronological: #1 opened the round
        return (
            <div key={e.key || `${e.trick}-${e.playOrder}`}>
                {showHead && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.1)' }} />
                        <div style={{ color: 'rgba(244,245,247,.45)', fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>TRICK {e.trick}</div>
                        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.1)' }} />
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '8px 12px' }}>
                    <div style={{ width: 24, flexShrink: 0, textAlign: 'right', color: 'rgba(244,245,247,.35)', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        #{moveNo}
                    </div>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: getAvatarTile(e.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                        {getAvatarEmoji(e.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#f4f5f7', fontWeight: 700, fontSize: 12 }}>{e.name}</div>
                        <div style={{ color: e.isPass ? 'rgba(244,245,247,.4)' : acc, fontWeight: 600, fontSize: 11 }}>
                            {e.isPass ? 'Passed' : describeHand(e.handType, e.cards)}
                        </div>
                    </div>
                    {!e.isPass && (
                        <div style={{ display: 'flex' }}>
                            {e.cards.map((c, j) => (
                                <PileCardGlyph
                                    key={`${c.rank}-${c.suit}`}
                                    rank={c.rank}
                                    suit={c.suit}
                                    fourColor={fourColor}
                                    pusoyMode={pusoyMode}
                                    size="log"
                                    style={{ marginLeft: j === 0 ? 0 : -10 }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    });
}

export default RoundLogRows;
