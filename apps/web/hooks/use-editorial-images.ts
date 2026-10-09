'use client';

import { onlineManager, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import {
  editorialSubjectKey,
  areEditorialImagesCached,
  readCachedEditorialImages,
  resolveEditorialImages,
  resolveEditorialImageBatches,
  type EditorialImageReference,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { queryKeys } from '@/lib/query/keys';

const EMPTY_IMAGES: ReadonlyMap<string, EditorialImageReference[]> = new Map();
const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const readOnline = () =>
  onlineManager.isOnline() && (typeof navigator === 'undefined' || navigator.onLine);
const serverOnline = () => true;

/**
 * Resolves a surface's editorial photography, keyed by subject.
 *
 * Missing subjects stay absent from the map. Resolution state lets surfaces
 * distinguish an in-flight choice from a completed miss or unavailable work,
 * rather than briefly painting a fallback while a better photograph resolves.
 *
 * Two caches sit behind this, and they answer different questions. The module
 * memo inside `resolveEditorialImages` dedupes across *overlapping* subject
 * lists within a session, so a screen asking for a subject another screen
 * already resolved costs nothing. The query below dedupes and persists an
 * *exact* list, so returning to a screen after a reload paints its photography
 * without a round trip. Photography changes on a 90-day cadence, so neither is
 * ever refetched on a timer.
 */
export function useEditorialImageResolution(
  subjects: EditorialSubject[],
  { progressive = false }: { progressive?: boolean } = {},
) {
  // The subjects array is rebuilt on every render; the query identity stays
  // tied to what is actually being asked for.
  const subjectKeys = subjects.map(editorialSubjectKey).sort();
  const online = useSyncExternalStore(subscribeOnline, readOnline, serverOnline);

  const { data, isError, fetchStatus } = useQuery({
    // Offline the request can only fail, and hotlinked photography could not
    // have been bundled into a local trip copy anyway.
    enabled: subjectKeys.length > 0 && online,
    queryFn: async () => {
      const resolved = await (progressive
        ? resolveEditorialImageBatches(subjects)
        : resolveEditorialImages(subjects));
      // A Map does not survive the JSON round trip this cache is persisted
      // through, so what is stored is a plain record.
      return Object.fromEntries(resolved) as Record<string, EditorialImageReference[]>;
    },
    queryKey: [...queryKeys.editorialImages(subjectKeys), ...(progressive ? ['progressive'] : [])],
  });

  // Read the bounded session cache in the same render as readiness. Another
  // overlapping query can fill it before this query publishes its own data;
  // memoizing only on that data could settle the header with an older map.
  const images = new Map(Object.entries(data ?? {}));
  for (const [key, references] of readCachedEditorialImages(subjects)) {
    images.set(key, references);
  }
  const isResolved =
    subjectKeys.length === 0 || data !== undefined || areEditorialImagesCached(subjects);
  const status = isResolved
    ? 'resolved'
    : !online || fetchStatus === 'paused'
      ? 'offline'
      : isError
        ? 'unavailable'
        : 'pending';
  return {
    images: images.size > 0 ? images : EMPTY_IMAGES,
    isResolved: status !== 'pending',
    status,
  };
}

export function useEditorialImages(
  subjects: EditorialSubject[],
  options?: { progressive?: boolean },
) {
  return useEditorialImageResolution(subjects, options).images;
}
