'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  editorialSubjectKey,
  readCachedEditorialImages,
  resolveEditorialImages,
  type EditorialImageReference,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { queryKeys } from '@/lib/query/keys';

const EMPTY_IMAGES: ReadonlyMap<string, EditorialImageReference[]> = new Map();

/**
 * Resolves a surface's editorial photography, keyed by subject.
 *
 * It starts empty so first paint is the branded fallback rather than a hole,
 * and it never surfaces a failure: an unresolved subject is simply absent from
 * the map. Callers pass the subjects they still need - a trip with its own
 * cover should not be in the list at all - and read the result back with
 * `editorialSubjectKey`.
 *
 * Two caches sit behind this, and they answer different questions. The module
 * memo inside `resolveEditorialImages` dedupes across *overlapping* subject
 * lists within a session, so a screen asking for a subject another screen
 * already resolved costs nothing. The query below dedupes and persists an
 * *exact* list, so returning to a screen after a reload paints its photography
 * without a round trip. Photography changes on a 90-day cadence, so neither is
 * ever refetched on a timer.
 */
export function useEditorialImages(subjects: EditorialSubject[]) {
  // The subjects array is rebuilt on every render, so everything below keys on
  // what is actually being asked for rather than on the array's identity.
  const subjectKeys = subjects.map(editorialSubjectKey).sort();
  const subjectSignature = subjectKeys.join('\n');

  const { data } = useQuery({
    // Offline the request can only fail, and hotlinked photography could not
    // have been bundled into a local trip copy anyway.
    enabled: subjectKeys.length > 0 && !(typeof navigator !== 'undefined' && !navigator.onLine),
    queryFn: async () => {
      const resolved = await resolveEditorialImages(subjects);
      // A Map does not survive the JSON round trip this cache is persisted
      // through, so what is stored is a plain record.
      return Object.fromEntries(resolved) as Record<string, EditorialImageReference[]>;
    },
    queryKey: queryKeys.editorialImages(subjectKeys),
  });

  return useMemo(() => {
    if (!subjectSignature) return EMPTY_IMAGES;

    // The session memo wins where it has an answer, because it stays correct
    // across overlapping subject lists that the query key cannot share.
    const images = new Map(Object.entries(data ?? {}));
    for (const [key, references] of readCachedEditorialImages(subjects)) {
      images.set(key, references);
    }

    return images.size > 0 ? images : EMPTY_IMAGES;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, subjectSignature]);
}
