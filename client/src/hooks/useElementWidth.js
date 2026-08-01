import useElementSize from './useElementSize';

/**
 * Measures an element's content width and keeps it current across resizes.
 *
 * Returns `[ref, width]`. Attach the ref to the element whose *available* width
 * you need — typically a full-width container, not a shrink-wrapping flex row,
 * which would report the width of its contents instead.
 *
 * A width-only view of useElementSize, so there is one ResizeObserver to reason
 * about rather than two that could drift.
 */
export default function useElementWidth() {
    const [ref, size] = useElementSize();
    return [ref, size.width];
}
