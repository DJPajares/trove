'use client';

import { useEffect, useState } from 'react';

import type { TripModeContext } from '@/lib/itinerary/api';
import { nextTripModeBoundary, refreshDelayMs } from '@/lib/itinerary/trip-mode-clock';

/**
 * A key that changes when Trip Mode's answer to "what now?" has gone stale.
 *
 * Trip Mode reads a verdict the server computes from its own clock, so the tab
 * only has to know *when* to ask again. Rather than poll — the context endpoint
 * can reach Routes and Places, which cost real money per call — this waits for
 * the first moment that verdict stops holding, and asks once.
 *
 * Staleness is measured from `contextAt`, the instant the server answered, not
 * from now: the question is whether a boundary has passed *since* this answer
 * was given.
 *
 * Returns a number to feed into a fetch effect's dependencies, mirroring
 * `useOfflineDataRefreshKey`.
 */
export function useTripModeClock(input: { context: TripModeContext | null; enabled: boolean }) {
  const { context, enabled } = input;
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled || !context) return;

    // The moment this answer stops holding.
    const staleAt = nextTripModeBoundary(context, new Date(context.contextAt));
    const refresh = () => setRefreshKey((current) => current + 1);
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      // A hidden tab has no one to mislead, and an offline one cannot ask.
      if (document.hidden || !navigator.onLine) return;
      timer = window.setTimeout(refresh, refreshDelayMs(staleAt, new Date()));
    };

    // Coming back to a tab that sat hidden through a boundary needs an answer
    // now. Coming back to one that did not is a glance, not a new moment — and
    // refetching for it would spend a Routes call to redraw the same screen.
    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        return;
      }
      if (staleAt && staleAt.getTime() <= Date.now()) {
        refresh();
        return;
      }
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', schedule);
      window.removeEventListener('offline', schedule);
    };
  }, [context, enabled]);

  return refreshKey;
}
