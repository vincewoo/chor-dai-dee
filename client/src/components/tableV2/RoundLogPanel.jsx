import RoundLogRows from './RoundLogRows';

// Persistent round-log rail for the desktop table. Same rows as the mobile
// bottom sheet, always on screen instead of behind a tap.
function RoundLogPanel({ log, acc, fourColor, pusoyMode }) {
    return (
        <aside
            style={{
                display: 'flex', flexDirection: 'column', minHeight: 0,
                background: 'linear-gradient(180deg,rgba(0,0,0,.42),rgba(0,0,0,.26))',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 20,
                boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '14px 16px 10px' }}>
                <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>
                    PLAYED THIS ROUND
                </div>
                <div style={{ color: 'rgba(244,245,247,.35)', fontSize: 11, fontWeight: 700 }}>
                    {log.length} {log.length === 1 ? 'play' : 'plays'} · newest first
                </div>
            </div>
            <div
                className="scrollbar-thin"
                style={{ overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}
            >
                <RoundLogRows log={log} acc={acc} fourColor={fourColor} pusoyMode={pusoyMode} emptyText="Nothing played yet this round." />
            </div>
        </aside>
    );
}

export default RoundLogPanel;
