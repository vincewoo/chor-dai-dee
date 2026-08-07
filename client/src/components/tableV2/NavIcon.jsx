// Stroke icons rather than emoji: the nav has to sit on one line at 320px, and
// emoji would drag their own colour and metrics into the bar. NavIcon is shared
// with HomeScreenV2's header buttons (help, signIn), which is why the map holds
// more than the four tabs.
const NAV_ICONS = {
    home: <><path d="M4 11.5 12 4.6l8 6.9" /><path d="M6.4 9.7v9.1a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V9.7" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1 1-1.1 1.9" /><path d="M12 16.8h.01" /></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 5.5H5.5V7a3 3 0 0 0 3 3" /><path d="M16 5.5h2.5V7a3 3 0 0 1-3 3" /><path d="M12 13v3.5" /><path d="M9 20h6" /></>,
    pulse: <path d="M3 12.5h4l2.5-7 4 14 2.5-7h5" />,
    bars: <><path d="M5 20v-8" /><path d="M12 20V4" /><path d="M19 20v-5" /></>,
    signIn: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 8.5l4 3.5-4 3.5" /><path d="M19 12H9" /></>,
};

export function NavIcon({ name, size = 19 }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {NAV_ICONS[name]}
        </svg>
    );
}

export default NavIcon;
