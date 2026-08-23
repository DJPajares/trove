'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the day plan is shown as places alone.
 *
 * Travel legs and the day's totals answer "how far apart is all this?", which is
 * a question a traveller asks while building the day and stops asking once it
 * holds together. After that the same rows are two thirds of the list standing
 * between them and the order they are actually travelling in. This hides them.
 *
 * The preference is a view, not a fact about the trip: it belongs to the device
 * the traveller is reading on rather than to their account, so it lives in local
 * storage the way `home-experience` keeps its dismissed prompts. It is read
 * after mount rather than during render — the server has no storage to read, and
 * a first paint that disagreed with the markup would flash the legs on and off.
 */
const COMPACT_ITINERARY_KEY = 'trove.itinerary-compact';

export function useCompactItinerary() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem(COMPACT_ITINERARY_KEY) === 'true');
    } catch {
      // A blocked storage only costs the traveller the remembered choice.
    }
  }, []);

  const setCompactItinerary = useCallback((next: boolean) => {
    setCompact(next);
    try {
      window.localStorage.setItem(COMPACT_ITINERARY_KEY, String(next));
    } catch {
      // The choice still holds for this session.
    }
  }, []);

  return { compact, setCompactItinerary };
}
