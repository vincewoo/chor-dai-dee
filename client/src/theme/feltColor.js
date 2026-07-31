// The felt gradient's outermost stop, and the one colour that has to exist
// outside the React tree.
//
// Anything painted beyond the app shell shows this: the safe-area bands in a
// standalone PWA (status bar, home indicator), the PWA splash, and browser
// chrome tinted by theme-color. Those consumers are the static index.html, the
// Node-side vite.config.js, and index.css — none of which can import
// theme/tableTheme.js (a browser-only ES module). So the value lives here, in
// a dependency-free module both Node and the browser can read, and the copies
// that remain (index.html's meta tags, index.css's body rule) are asserted
// against it by client/test/feltColor.test.js.
//
// Keep FELT_EDGE equal to the last stop of FELT_BASE in theme/tableTheme.js.
export const FELT_EDGE = '#0c3a23';

export default FELT_EDGE;
