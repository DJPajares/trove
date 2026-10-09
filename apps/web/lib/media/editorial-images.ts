import type { TrovePlaceCategory } from '@/lib/place-categories';
import { contextualEditorialSubjectKey, type EditorialImageContext } from '@trove/types';
import { getBrowserSession } from '@/lib/supabase/client';

/**
 * Attribution travels with the photograph rather than beside it. The API drops
 * any image it cannot credit, so a reference in hand always has a photographer
 * and a provider page to link back to.
 */
export type EditorialImageAttribution = {
  photographerName: string;
  photographerUrl: string;
  providerName: string;
  providerPageUrl: string;
};

export type EditorialImageMatchKind = 'exact' | 'generic' | 'contextual';

/**
 * A reference to a photograph, never the photograph. `sourceUrl` is the
 * provider's unsized hotlink, `dominantColor` is what a frame paints while one loads, and
 * `width`/`height` let a frame reserve the space before any byte arrives.
 */
export type EditorialImageReference = {
  altText: string | null;
  attribution: EditorialImageAttribution;
  dominantColor: string | null;
  externalPhotoId: string;
  height: number | null;
  matchKind?: EditorialImageMatchKind;
  sourceUrl: string;
  width: number | null;
};

/**
 * What a surface asks a photograph for. `placeId` and `tripId` are optional and
 * only tell the service which row may remember the answer, so the next render
 * of that row costs nothing.
 */
export type EditorialSubject = {
  context?: EditorialImageContext;
  category?: TrovePlaceCategory;
  name: string;
  placeId?: string;
  tripId?: string;
};

type EditorialImageResult =
  | {
      images: EditorialImageReference[];
      matchKind: EditorialImageMatchKind;
      status: 'ok';
      subjectKey: string;
    }
  | { status: 'empty'; subjectKey: string }
  | { code: string; status: 'unavailable'; subjectKey: string };

/** The API's own ceiling. A screen asking for more than this is a fan-out. */
export const MAX_EDITORIAL_IMAGE_SUBJECTS = 25;

/** Mirrors the API's shared fallback pool size. */
export const MAX_GENERIC_IMAGES = 8;

/**
 * Mirrors the API's resolution version, and belongs in the query key for the
 * same reason it exists on the server: an answer is only meaningful for the
 * resolution that produced it. Photography is never refetched on a timer, so a
 * client holding a persisted answer from an older resolution would keep showing
 * it - which is how a widened fallback pool still rendered a single photograph.
 */
export const EDITORIAL_IMAGE_RESOLUTION_VERSION = 4;

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

/**
 * Mirrors `editorialSubjectKey` in the API exactly, because the same key has to
 * name the same photograph on both sides: the client dedupes a screen's
 * subjects with it and the server caches its answers under it.
 */
export function editorialSubjectKey(subject: {
  context?: EditorialImageContext;
  category?: TrovePlaceCategory;
  name: string;
  placeId?: string;
}) {
  if (subject.context) return contextualEditorialSubjectKey(subject.name, subject.context);
  if (subject.placeId) return `place:${subject.placeId.toLowerCase()}`;

  const name = subject.name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `${subject.category ?? 'destination'}:${name}`;
}

/**
 * Answers already given this session, keyed by subject. Editorial imagery is
 * deterministic for a subject and changes on a 90-day cadence, so re-rendering
 * a list or returning to a route must not ask again.
 */
const resolvedImages = new Map<string, EditorialImageReference[] | null>();
const inFlightImages = new Map<string, Promise<EditorialImageReference[] | null | undefined>>();

/** Reads session-cached imagery without starting work, so revisiting a route paints it immediately. */
export function readCachedEditorialImages(subjects: EditorialSubject[]) {
  const cached = new Map<string, EditorialImageReference[]>();
  for (const subject of subjects) {
    const key = editorialSubjectKey(subject);
    const references = resolvedImages.get(key);
    if (references) cached.set(key, references);
  }
  return cached;
}

/** A confirmed miss is settled too; an outage is deliberately never cached. */
export function areEditorialImagesCached(subjects: readonly EditorialSubject[]) {
  return subjects.every(
    (subject) => !subject.name.trim() || resolvedImages.has(editorialSubjectKey(subject)),
  );
}

/** Test seam, and the only way this module's memory is ever discarded. */
export function resetEditorialImageCache() {
  resolvedImages.clear();
  inFlightImages.clear();
}

/** The stable representative image used by every non-gallery surface. */
export function primaryEditorialImage(images: readonly EditorialImageReference[] | undefined) {
  return images?.[0] ?? null;
}

/**
 * Spreads a seed over a pool without clustering short ids. FNV-1a, because the
 * only property needed is that two trip ids differing in one character land
 * somewhere unrelated.
 */
function seedIndex(seed: string, length: number) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash) % length;
}

/**
 * The photograph a cover should show.
 *
 * An exact match is a picture of the place, so it stays the first one - the
 * representative image, the same for everybody, which is what makes editorial
 * imagery deterministic. A generic answer is not a picture of anywhere: it is
 * one draw from a pool shared by every subject with nothing of its own, and
 * taking the first of those is why every trip wore the same photograph.
 *
 * The seed is what keeps the draw honest. A trip seeded on its own id shows the
 * same photograph forever, while the trip beside it shows a different one.
 */
export function editorialCoverImage(
  images: readonly EditorialImageReference[] | undefined,
  seed: string,
) {
  if (!images?.length) return null;
  if (images[0]?.matchKind !== 'generic') return images[0] ?? null;

  return images[seedIndex(seed, images.length)] ?? null;
}

async function getAccessToken() {
  const session = await getBrowserSession();
  return session?.access_token ?? null;
}

async function requestEditorialImages(subjects: EditorialSubject[], accessToken: string) {
  const response = await fetch(`${apiUrl}/editorial-images/resolve`, {
    body: JSON.stringify({ subjects }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  // 204 is the kill switch and a missing provider key alike, and both mean the
  // same thing here: there is no photograph, render the branded fallback.
  if (response.status === 204 || !response.ok) return [];

  const body = (await response.json()) as { images?: EditorialImageResult[] };
  return body.images ?? [];
}

/**
 * Resolves a screen's worth of subjects to photographs.
 *
 * Photography is decoration, so every failure here - offline, signed out, rate
 * limited, provider outage, kill switch - is answered with an absence rather
 * than an error. A caller receives the subjects that resolved and nothing else,
 * and the media frame turns the missing ones into the branded fallback.
 *
 * A resolve costs at most one request, whatever it is handed. Callers should
 * still ask only for what a screen shows, but no call site can turn a long
 * list into a fan-out by forgetting to.
 */
export async function resolveEditorialImages(subjects: EditorialSubject[]) {
  const resolved = new Map<string, EditorialImageReference[]>();
  const pending = new Map<string, EditorialSubject>();
  const waiting = new Map<string, Promise<EditorialImageReference[] | null | undefined>>();
  for (const subject of subjects) {
    if (!subject.name.trim()) continue;
    const key = editorialSubjectKey(subject);
    if (resolvedImages.has(key)) {
      const cached = resolvedImages.get(key);
      if (cached) resolved.set(key, cached);
    } else if (inFlightImages.has(key)) {
      waiting.set(key, inFlightImages.get(key)!);
    } else if (!pending.has(key)) {
      pending.set(key, subject);
    }
  }

  const batch = [...pending.values()].slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
  if (batch.length) {
    // Register before awaiting auth so overlapping surface batches share the
    // same work even when the session itself has not returned yet.
    const work = (async () => {
      const results = new Map<string, EditorialImageReference[] | null>();
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return results;
        for (const image of await requestEditorialImages(batch, accessToken)) {
          if (image.status === 'ok') {
            const matchKind: EditorialImageMatchKind =
              image.matchKind === 'generic'
                ? 'generic'
                : image.matchKind === 'contextual'
                  ? 'contextual'
                  : 'exact';
            const references = image.images
              .slice(0, matchKind === 'generic' ? MAX_GENERIC_IMAGES : image.images.length)
              .map((reference) => ({ ...reference, matchKind }));
            resolvedImages.set(image.subjectKey, references);
            results.set(image.subjectKey, references);
          } else if (image.status === 'empty') {
            resolvedImages.set(image.subjectKey, null);
            results.set(image.subjectKey, null);
          }
        }
      } catch {
        // Outages are not negative answers and remain retryable next visit.
      }
      return results;
    })();
    for (const subject of batch) {
      const key = editorialSubjectKey(subject);
      const promise = work.then((results) => results.get(key));
      inFlightImages.set(key, promise);
      waiting.set(key, promise);
      void promise.finally(() => {
        if (inFlightImages.get(key) === promise) inFlightImages.delete(key);
      });
    }
  }

  await Promise.all(
    [...waiting].map(async ([key, promise]) => {
      const references = await promise;
      if (references) resolved.set(key, references);
    }),
  );
  return resolved;
}

/** Viewed-row lists may overflow one batch. Resolve them serially, with the same cache and cap. */
export async function resolveEditorialImageBatches(subjects: EditorialSubject[]) {
  const unique = [
    ...new Map(subjects.map((subject) => [editorialSubjectKey(subject), subject])).values(),
  ];
  const images = new Map<string, EditorialImageReference[]>();
  for (let offset = 0; offset < unique.length; offset += MAX_EDITORIAL_IMAGE_SUBJECTS) {
    const batch = await resolveEditorialImages(
      unique.slice(offset, offset + MAX_EDITORIAL_IMAGE_SUBJECTS),
    );
    for (const [key, references] of batch) images.set(key, references);
  }
  return images;
}
