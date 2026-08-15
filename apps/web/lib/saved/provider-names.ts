'use client';

import { useEffect, useState } from 'react';

import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
} from './api';

/** The minimum a surface needs to know to resolve a Place's current name. */
export type ResolvableProviderPlace = {
  id: string;
  kind: 'custom' | 'provider';
  name: string | null;
  providerRefs: Array<{ externalPlaceId: string; provider: 'google' }>;
};

/**
 * Trove owns Place identity but never stores a provider's name, so a Google-backed
 * Place arrives with `name: null` and the current name is resolved on demand. Every
 * surface that lists Places needs the same short dance — check the session cache,
 * fetch what is missing, fill it in — so it lives here once, keyed by the Trove
 * Place id the rest of the app already caches under.
 *
 * Returns only what has resolved so far; callers keep their own fallback for the
 * offline and unavailable cases rather than showing a half-filled list.
 */
export function useProviderPlaceNames(places: ResolvableProviderPlace[]) {
  const [names, setNames] = useState<Record<string, string>>({});

  // A stable key keeps the effect from re-running on every parent render.
  const pendingKey = places
    .filter((place) => place.kind === 'provider' && !place.name)
    .map((place) => `${place.id}:${place.providerRefs[0]?.externalPlaceId ?? ''}`)
    .sort()
    .join(',');

  useEffect(() => {
    if (!pendingKey) return;
    let active = true;

    const pending = pendingKey.split(',').flatMap((entry) => {
      const [placeId, externalPlaceId] = entry.split(':');
      return placeId && externalPlaceId ? [{ externalPlaceId, placeId }] : [];
    });

    for (const { externalPlaceId, placeId } of pending) {
      const cached = getCachedProviderPlaceDetails(placeId);
      if (cached) {
        setNames((current) => ({ ...current, [placeId]: cached.name }));
        continue;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) continue;

      void getProviderPlaceDetails(externalPlaceId)
        .then((result) => {
          if (!active || result.status !== 'ok' || !result.place) return;
          cacheProviderPlaceDetails(placeId, result.place);
          setNames((current) => ({ ...current, [placeId]: result.place!.name }));
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [pendingKey]);

  return names;
}
