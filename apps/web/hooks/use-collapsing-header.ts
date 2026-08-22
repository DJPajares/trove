'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { nextHeaderScrollState, type HeaderScrollState } from '@/lib/shell/collapsing-header';

function useIsCompactViewport() {
  // Server-rendered markup has no viewport, and the header renders expanded, so
  // false is the honest starting answer either way.
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    // Tailwind's `md`, the breakpoint the whole shell already pivots on.
    const query = window.matchMedia('(width < 48rem)');
    const sync = () => setIsCompact(query.matches);

    sync();
    query.addEventListener('change', sync);

    return () => query.removeEventListener('change', sync);
  }, []);

  return isCompact;
}

/**
 * Collapses the app header while the traveller scrolls down a long day plan and
 * returns it the moment they scroll up.
 *
 * Only runs on compact viewports: on a desktop the header is not competing for
 * the space, and toggling `--header-offset` there would move anything anchored
 * beneath the header for no reason.
 */
export function useCollapsingHeader({ enabled = true }: { enabled?: boolean } = {}) {
  const isCompact = useIsCompactViewport();
  const active = enabled && isCompact;

  const [collapsed, setCollapsed] = useState(false);
  const stateRef = useRef<HeaderScrollState>({ collapsed: false, lastOffset: 0 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      stateRef.current = { collapsed: false, lastOffset: 0 };
      setCollapsed(false);

      return;
    }

    const read = () => {
      frameRef.current = null;

      const next = nextHeaderScrollState(stateRef.current, window.scrollY);

      stateRef.current = next;
      setCollapsed(next.collapsed);
    };

    const handleScroll = () => {
      // One read per frame; scroll fires far more often than the header changes.
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(read);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    read();

    return () => {
      window.removeEventListener('scroll', handleScroll);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active]);

  /**
   * Keyboard focus must never land on a control that has been scrolled out of
   * sight, so anything focusable inside the header can force it back.
   */
  const reveal = useCallback(() => {
    stateRef.current = { ...stateRef.current, collapsed: false };
    setCollapsed(false);
  }, []);

  return { collapsed, reveal };
}
