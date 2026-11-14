'use client';

import { useCallback, useEffect, useState } from 'react';

export type ItineraryView = 'detailed' | 'simple';

const ITINERARY_VIEW_KEY = 'trove.itinerary-view';

/**
 * What a trip opens in before the traveller has chosen: a finished trip is
 * read, not built, so it opens Simple; a trip still ahead opens Detailed.
 */
export function defaultItineraryView(completed: boolean): ItineraryView {
  return completed ? 'simple' : 'detailed';
}

/**
 * How a day's stops are shown: Detailed, the cards a day is built with, or
 * Simple, the plain list it is read from.
 *
 * Like the compact travel preference it is a view rather than a fact about the
 * trip, so it belongs to the device and lives in local storage, read after
 * mount. A choice, once made, holds for every trip; until then each trip
 * opens in its own default.
 */
export function useItineraryView(completed: boolean) {
  const [chosen, setChosen] = useState<ItineraryView | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ITINERARY_VIEW_KEY);
      if (stored === 'simple' || stored === 'detailed') setChosen(stored);
    } catch {
      // A blocked storage only costs the traveller the remembered choice.
    }
  }, []);

  const setView = useCallback((next: ItineraryView) => {
    setChosen(next);
    try {
      window.localStorage.setItem(ITINERARY_VIEW_KEY, next);
    } catch {
      // The choice still holds for this session.
    }
  }, []);

  return { setView, view: chosen ?? defaultItineraryView(completed) };
}
