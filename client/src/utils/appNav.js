// The app's top-level destinations — the tabs AppShell renders in the phone
// bottom bar and the desktop header strip. Pure data + a pure matcher, so the
// node test runner can cover the routing table without a DOM.
export const APP_TABS = [
    { key: 'home', label: 'Home', icon: 'home', path: '/lobby' },
    { key: 'board', label: 'Leaders', icon: 'trophy', path: '/leaderboard' },
    { key: 'activity', label: 'Activity', icon: 'pulse', path: '/activity' },
    { key: 'stats', label: 'Stats', icon: 'bars', path: '/stats' },
];

// Which tab a pathname lights up. Drill-in pages highlight the tab they are
// conceptually under, not the one the user happened to arrive from — history
// can't be recovered from a pathname, and a stable mapping beats a bar whose
// highlight depends on how you got there:
//   profile/avatar are account pages reached from Home's header (avatar also
//   from Profile's avatar card);
//   a game review is a finished game, which is what Activity lists;
//   training drills are launched from the Stats page's topics.
const TAB_BY_PREFIX = [
    ['/lobby', 'home'],
    ['/profile', 'home'],
    ['/avatar', 'home'],
    ['/leaderboard', 'board'],
    ['/activity', 'activity'],
    ['/review', 'activity'],
    ['/stats', 'stats'],
    ['/training', 'stats'],
];

export function activeTabFor(pathname) {
    const hit = TAB_BY_PREFIX.find(
        ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
    return hit ? hit[1] : null;
}

// What a drill-in's back arrow should do, as data. React Router keys the
// initial history entry 'default'; on that entry — a deep link, or a fresh
// launch of the installed PWA straight onto a drill-in URL — popping would
// leave the app, so back falls through to the screen's natural parent instead,
// replacing so the fallback doesn't itself pile onto history. Pure so the node
// runner can pin the branch; useBackNavigation is the thin hook over it.
export function resolveBackTarget(locationKey, fallback = '/lobby') {
    if (locationKey === 'default') return { replaceTo: fallback };
    return { pop: true };
}
