'use client';

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';

type LibraryView = { expanded: boolean; hasRendered: boolean; scrollY: number };

// A view belongs to this tab's account-scoped client, just like its read cache.
// Weak keys release it with that client; neither private data nor UI state is
// written to storage or shared with a different account.
const views = new WeakMap<QueryClient, LibraryView>();

export function useLibraryView(ready: boolean) {
  const client = useQueryClient();
  let view = views.get(client);
  if (!view) {
    view = { expanded: false, hasRendered: false, scrollY: 0 };
    views.set(client, view);
  }
  const saved = view;
  const [expanded, setExpanded] = useState(saved.expanded);
  const animateEntrance = !saved.hasRendered;

  useLayoutEffect(() => {
    if (!ready) return;
    saved.hasRendered = true;
    const top = saved.scrollY;
    const restore = () => window.scrollTo({ top, behavior: 'instant' });
    restore();
    // Run after the router's own commit-time scroll handling as well. This also
    // covers ordinary Back/Forward and links outside the primary navigation.
    const frame = window.requestAnimationFrame(restore);
    const remember = () => {
      saved.scrollY = window.scrollY;
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', remember);
    };
  }, [ready, saved]);

  return {
    animateEntrance,
    expanded,
    setExpanded: (next: boolean) => {
      saved.expanded = next;
      setExpanded(next);
    },
  };
}
