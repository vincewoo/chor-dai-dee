// The 32px ‹ button at the top-left of a drill-in screen's HUD row. One
// component rather than the seven inline copies it replaced, so the tab-root
// rule has a single home: no onClick means the screen is a tab root — the
// persistent tab bar is the way out — and the button renders nothing at all
// (see CLAUDE.md's navigation model).
function BackButton({ onClick }) {
    if (!onClick) return null;
    return (
        <button
            onClick={onClick}
            aria-label="Back"
            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >‹</button>
    );
}

export default BackButton;
