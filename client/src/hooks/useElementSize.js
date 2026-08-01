import { useEffect, useRef, useState } from 'react';

/**
 * Measures an element's content box and keeps it current across resizes.
 *
 * Returns `[ref, { width, height }]`. Attach the ref to the element whose
 * *available* space you need — typically a full-width/height container, not a
 * shrink-wrapping flex row, which would report the size of its contents.
 *
 * The size object is kept in state rather than rebuilt each render, so it is
 * referentially stable between resizes and safe in a dependency array.
 */
export default function useElementSize() {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;

        const update = (width, height) => {
            setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
        };

        const rect = el.getBoundingClientRect();
        update(rect.width, rect.height);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                update(entry.contentRect.width, entry.contentRect.height);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return [ref, size];
}
