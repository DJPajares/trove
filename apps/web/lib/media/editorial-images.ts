import type { TrovePlaceCategory } from '@/lib/place-categories';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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
  sourceUrl: string;
  width: number | null;
};

/**
 * What a surface asks a photograph for. `placeId` and `tripId` are optional and
 * only tell the service which row may remember the answer, so the next render
 * of that row costs nothing.
 */
export type EditorialSubject = {
  category?: TrovePlaceCategory;
  name: string;
  placeId?: string;
  tripId?: string;
};

type EditorialImageResult =
  | { images: EditorialImageReference[]; status: 'ok'; subjectKey: string }
  | { status: 'empty'; subjectKey: string }
  | { code: string; status: 'unavailable'; subjectKey: string };

/** The API's own ceiling. A screen asking for more than this is a fan-out. */
export const MAX_EDITORIAL_IMAGE_SUBJECTS = 25;

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

/**
 * Mirrors `editorialSubjectKey` in the API exactly, because the same key has to
 * name the same photograph on both sides: the client dedupes a screen's
 * subjects with it and the server caches its answers under it.
 */
export function editorialSubjectKey(subject: { category?: TrovePlaceCategory; name: string }) {
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

/** Test seam, and the only way this module's memory is ever discarded. */
export function resetEditorialImageCache() {
  resolvedImages.clear();
}

/** The stable representative image used by every non-gallery surface. */
export function primaryEditorialImage(images: readonly EditorialImageReference[] | undefined) {
  return images?.[0] ?? null;
}

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  return data.session.access_token;
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
  for (const subject of subjects) {
    if (!subject.name.trim()) continue;

    const key = editorialSubjectKey(subject);
    if (resolvedImages.has(key)) {
      const cached = resolvedImages.get(key);
      if (cached) resolved.set(key, cached);
      continue;
    }
    if (!pending.has(key)) pending.set(key, subject);
  }

  if (pending.size === 0) return resolved;

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return resolved;

    // One resolve is one request, always. Splitting the overflow into parallel
    // requests would turn a screen that asked for too much into several times
    // the cost, silently - so the cap is enforced here rather than trusted to
    // every call site, and the subjects past it render the branded fallback.
    const batch = [...pending.values()].slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);

    for (const image of await requestEditorialImages(batch, accessToken)) {
      if (image.status === 'ok') {
        resolvedImages.set(image.subjectKey, image.images);
        resolved.set(image.subjectKey, image.images);
        continue;
      }

      // An outage is not an answer, so only a definitive "no photograph" is
      // remembered; retrying an unavailable subject on the next screen is
      // cheaper than showing a fallback for the rest of the session.
      if (image.status === 'empty') resolvedImages.set(image.subjectKey, null);
    }
  } catch {
    return resolved;
  }

  return resolved;
}
