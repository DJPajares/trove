'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Tracks which of many keyed elements have ever entered the viewport, using
 * one shared `IntersectionObserver` rather than one per row. A key stays in
 * `visibleKeys` once seen — this gates work on first visibility (e.g. "ask
 * for this row's data now that it's on screen"), not a toggling visual state.
 *
 * `observe(key)` returns a callback ref; attach it to the element a key
 * belongs to.
 */
export function useVisibleKeys(rootMargin = '400px') {
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(new Set());
  const elements = useRef(new Map<string, Element>());

  const observer = useMemo(
    () =>
      new IntersectionObserver(
        (entries) => {
          const newlyVisible = entries
            .filter((entry) => entry.isIntersecting)
            .map((entry) => entry.target.getAttribute('data-visible-key'))
            .filter((key): key is string => key !== null);
          if (newlyVisible.length === 0) return;

          setVisibleKeys((prev) => {
            if (newlyVisible.every((key) => prev.has(key))) return prev;
            return new Set([...prev, ...newlyVisible]);
          });
        },
        { rootMargin },
      ),
    [rootMargin],
  );

  useEffect(() => () => observer.disconnect(), [observer]);

  const observe = useCallback(
    (key: string) => (element: Element | null) => {
      const previous = elements.current.get(key);
      if (previous) {
        observer.unobserve(previous);
        elements.current.delete(key);
      }

      if (element) {
        element.setAttribute('data-visible-key', key);
        observer.observe(element);
        elements.current.set(key, element);
      }
    },
    [observer],
  );

  return { observe, visibleKeys };
}
