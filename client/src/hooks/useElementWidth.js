import { useEffect, useRef, useState } from 'react';

/**
 * Measures an element's content width and keeps it current across resizes.
 *
 * Returns `[ref, width]`. Attach the ref to the element whose *available* width
 * you need — typically a full-width container, not a shrink-wrapping flex row,
 * which would report the width of its contents instead.
 */
export default function useElementWidth() {
    const ref = useRef(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;

        setWidth(el.getBoundingClientRect().width);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return [ref, width];
}
