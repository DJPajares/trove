'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ATLAS_TRIP_PICKS_KEY,
  addAtlasTripPick,
  readAtlasTripPicks,
  removeAtlasTripPick,
  writeAtlasTripPicks,
  type AtlasTripPick,
  type AtlasTripPickInput,
} from '@/lib/atlas/picks';

const PICKS_EVENT = 'trove:atlas-trip-picks-changed';

function notifyPicksChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PICKS_EVENT));
  }
}

/**
 * Shared device-local Trip picks state across all Atlas pages and the floating
 * tray (PRD 40.4). Stored only in localStorage; never synced or mixed with Saved.
 */
export function useAtlasTripPicks() {
  const [picks, setPicks] = useState<AtlasTripPick[]>([]);

  useEffect(() => {
    const sync = () => setPicks(readAtlasTripPicks());
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === ATLAS_TRIP_PICKS_KEY) sync();
    };
    window.addEventListener(PICKS_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PICKS_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const togglePick = useCallback((input: AtlasTripPickInput) => {
    const current = readAtlasTripPicks();
    const existing = current.find(
      (pick) =>
        pick.countryCode === input.countryCode.toUpperCase() &&
        pick.destinationSlug === input.destinationSlug &&
        pick.kind === input.kind &&
        pick.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    );
    const next = existing
      ? removeAtlasTripPick(current, existing.id)
      : addAtlasTripPick(current, input).picks;
    writeAtlasTripPicks(next);
    setPicks(next);
    notifyPicksChanged();
  }, []);

  const removePick = useCallback((id: string) => {
    const next = removeAtlasTripPick(readAtlasTripPicks(), id);
    writeAtlasTripPicks(next);
    setPicks(next);
    notifyPicksChanged();
  }, []);

  const clearPicks = useCallback(() => {
    writeAtlasTripPicks([]);
    setPicks([]);
    notifyPicksChanged();
  }, []);

  return { clearPicks, picks, removePick, togglePick };
}
