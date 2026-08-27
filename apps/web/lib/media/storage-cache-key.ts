/**
 * How a Supabase Storage object is named in the image cache.
 *
 * The API mints a fresh signed URL on every serialization, so the same photo
 * arrives under a different `?token=` each time a screen refetches. Left alone
 * that means every entry is a miss, and the cache fills with copies of one
 * image. Stripping the signing parameters makes the storage path the key, which
 * is what actually identifies the object.
 *
 * This module is the single implementation of that rule because two callers
 * need it and they cannot share a closure: the service worker applies it as a
 * `cacheKeyWillBeUsed` plugin, and the offline warm path has to apply it by
 * hand - `cache.add` fetches and stores in one step, and never consults a
 * strategy's plugins.
 */

export const USER_MEDIA_CACHE = 'trove-pwa-user-media';
export const EDITORIAL_IMAGE_CACHE = 'trove-pwa-editorial-images';
export const STATIC_IMAGE_CACHE = 'trove-pwa-static-images';

/** Caches holding one traveller's own media, and nobody else's. */
export const PRIVATE_MEDIA_CACHES = [USER_MEDIA_CACHE, EDITORIAL_IMAGE_CACHE];

const STORAGE_OBJECT_PATH = /^\/storage\/v1\/object\/(?:sign|public)\//;

/** Parameters that identify a grant rather than an object. */
const SIGNING_PARAMS = ['token', 'download'];

/**
 * Recognises a Supabase Storage object by its path rather than by its host.
 *
 * The host is not available here: the service worker is bundled by esbuild,
 * which does not perform Next's `NEXT_PUBLIC_*` substitution, so reading
 * `process.env` inside the worker leaves a runtime lookup for a `process` that
 * does not exist there - and because this runs at module scope, that is not a
 * dead rule but a `ReferenceError` that would take the whole worker down with
 * it, offline support included.
 *
 * Matching the path is no weaker in practice. This shape is specific to
 * Supabase Storage, it is only ever consulted for image requests, and Trove
 * loads storage objects from exactly one project. It also keeps working for a
 * self-hosted Supabase, which pinning the hostname would not.
 */
export function isSupabaseStorageObject(url: URL) {
  return STORAGE_OBJECT_PATH.test(url.pathname);
}

export function storageCacheKey(rawUrl: string) {
  const url = new URL(rawUrl);
  for (const param of SIGNING_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

/**
 * Forgets a stored object, found by the bucket and path that name it.
 *
 * Callers hold a storage path rather than a URL - the signed URL that was
 * cached has long since been replaced by a newer one - so this matches on the
 * path instead of reconstructing a key. The caches are bounded to a few hundred
 * entries and this only runs on a delete or a re-upload, so the scan is cheap.
 *
 * Two situations need it. The easy one to miss is re-upload: memory photos are
 * written with `upsert: true` to a path derived from their id, precisely so a
 * partially uploaded photo can be sent again - so unlike every other bucket,
 * one key can come to hold different bytes, and without this the half-written
 * image would be served for the rest of its expiry.
 *
 * The other is deletion, and it is a privacy point rather than hygiene: a
 * memory the traveller removed should not survive on their device.
 */
export async function forgetCachedMediaPath(bucket: string, path: string | null | undefined) {
  if (!path || typeof caches === 'undefined') return;

  const suffix = `/${bucket}/${path}`;

  try {
    const cache = await caches.open(USER_MEDIA_CACHE);
    await Promise.all(
      (await cache.keys())
        .filter((request) => new URL(request.url).pathname.endsWith(suffix))
        .map((request) => cache.delete(request)),
    );
  } catch {
    // A cache that cannot be opened has nothing stale in it to remove.
  }
}

/**
 * Forgets stored objects named by the signed URLs a screen is holding.
 *
 * The token is stripped first, so this finds the entry however many times the
 * URL has been re-signed since it was cached.
 */
export async function forgetCachedMediaUrls(urls: readonly (string | null | undefined)[]) {
  if (typeof caches === 'undefined') return;

  try {
    const cache = await caches.open(USER_MEDIA_CACHE);
    await Promise.all(
      urls
        .filter((url): url is string => Boolean(url))
        .map((url) => cache.delete(storageCacheKey(url))),
    );
  } catch {
    // A cache that cannot be opened has nothing stale in it to remove.
  }
}

/** Drops every cache holding media private to the signed-in traveller. */
export async function clearCachedMedia() {
  if (typeof caches === 'undefined') return;

  try {
    await Promise.all(PRIVATE_MEDIA_CACHES.map((cacheName) => caches.delete(cacheName)));
  } catch {
    // Sign-out continues; the caches are per-origin and will age out.
  }
}
