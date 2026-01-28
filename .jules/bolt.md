## 2025-02-14 - Responsive Card Rendering Optimization
**Learning:** React components that render both mobile and desktop layouts (hiding one with CSS) significantly increase DOM node count, especially when the component is repeated many times (like cards in a hand). Conditionally rendering based on viewport size (via JS) reduces this overhead.
**Action:** When optimizing components with distinct responsive layouts, prefer conditional JS rendering over CSS display toggling if the component is heavy or frequent. Ensure `React.memo` comparison functions are updated to include the responsive state prop (e.g., `isDesktop`).

## 2025-02-14 - Bot Move Selection Optimization
**Learning:** Optimizing nested loops O(N*M*K) to O(N*M) with a frequency map provided a modest 1.26x speedup for the specific calculation. V8 optimizes small array traversals very well, so the overhead of object map creation/lookup partially offsets the algorithmic gain for small N (N<30).
**Action:** For hot paths with nested loops, use pre-calculated maps/sets, but benchmark to confirm gains vs object allocation overhead.
