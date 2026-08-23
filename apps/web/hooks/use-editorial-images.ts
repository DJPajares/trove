'use client';

import { useEffect, useState } from 'react';

import {
  editorialSubjectKey,
  resolveEditorialImages,
  type EditorialImageReference,
  type EditorialSubject,
} from '@/lib/media/editorial-images';

const EMPTY_IMAGES: ReadonlyMap<string, EditorialImageReference> = new Map();

/**
 * Resolves a surface's editorial photography, keyed by subject.
 *
 * It starts empty so first paint is the branded fallback rather than a hole,
 * and it never surfaces a failure: an unresolved subject is simply absent from
 * the map. Callers pass the subjects they still need - a trip with its own
 * cover should not be in the list at all - and read the result back with
 * `editorialSubjectKey`.
 */
export function useEditorialImages(subjects: EditorialSubject[]) {
  const [images, setImages] = useState(EMPTY_IMAGES);

  // The subjects array is rebuilt on every render, so the effect keys on what
  // is actually being asked for rather than on the array's identity.
  const subjectSignature = subjects
    .map(
      (subject) =>
        `${editorialSubjectKey(subject)}|${subject.tripId ?? ''}|${subject.placeId ?? ''}`,
    )
    .sort()
    .join('\n');

  useEffect(() => {
    if (!subjectSignature) return;
    // Offline, the request can only fail, and hotlinked photography could not
    // have been bundled into a local trip copy anyway.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    let active = true;
    void resolveEditorialImages(subjects).then((resolved) => {
      if (active && resolved.size > 0) setImages(resolved);
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectSignature]);

  return images;
}
