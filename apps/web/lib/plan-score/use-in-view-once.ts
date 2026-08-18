'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks whether the observed element has ever entered the viewport, and
 * keeps returning `true` afterward even once it scrolls back out — this is
 * for gating a fetch on first visibility, not for repeatedly toggling a
 * visual state.
 *
 * `ref` is a callback ref rather than `useRef` on purpose: the sentinel this
 * hook watches sits inside content gated on data that loads after first
 * render, so a plain ref can still be null the one time the effect runs. A
 * callback ref re-fires when the node actually attaches, whenever that is.
 */
export function useInViewOnce<T extends Element>(rootMargin = '200px') {
  const [node, setNode] = useState<T | null>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const ref = useCallback((element: T | null) => setNode(element), []);

  useEffect(() => {
    if (hasBeenVisible || !node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setHasBeenVisible(true);
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible, node, rootMargin]);

  return { hasBeenVisible, ref };
}
