import { expect, test } from 'vitest';

import {
  isSupabaseStorageObject,
  PRIVATE_MEDIA_CACHES,
  STATIC_IMAGE_CACHE,
  storageCacheKey,
} from '../lib/media/storage-cache-key.ts';

const HOST = 'abcdefgh.supabase.co';
const signed = (path: string, token: string) =>
  `https://${HOST}/storage/v1/object/sign/${path}?token=${token}`;

/**
 * The whole point of the rule: the API re-mints a signed URL on every
 * serialization, so without this every refetch is a cache miss and the cache
 * fills with copies of one photograph.
 */
test('two signings of one object share a cache key', () => {
  const first = signed('trip-covers/user-1/cover-abc.jpg', 'eyJhbGciOi.FIRST');
  const second = signed('trip-covers/user-1/cover-abc.jpg', 'eyJhbGciOi.SECOND');

  expect(storageCacheKey(first)).toBe(storageCacheKey(second));
});

test('different objects keep different cache keys', () => {
  const cover = storageCacheKey(signed('trip-covers/user-1/cover-abc.jpg', 't'));
  const replacement = storageCacheKey(signed('trip-covers/user-1/cover-xyz.jpg', 't'));
  const otherUser = storageCacheKey(signed('trip-covers/user-2/cover-abc.jpg', 't'));

  expect(cover).not.toBe(replacement);
  expect(cover).not.toBe(otherUser);
});

test('strips only the signing parameters', () => {
  const key = storageCacheKey(
    `https://${HOST}/storage/v1/object/sign/memory-photos/user-1/a.jpg?token=abc&download=&width=800`,
  );

  expect(key).toContain('width=800');
  expect(key).not.toContain('token');
  expect(key).not.toContain('download');
});

/**
 * Matched by path, not by host. The worker is bundled by esbuild, which does
 * not substitute `NEXT_PUBLIC_*`, so a hostname read from `process.env` would
 * be a runtime lookup for a `process` the worker does not have - at module
 * scope that throws and takes the whole worker down, offline support included.
 */
test('matches signed and public storage objects by path', () => {
  const match = (raw: string) => isSupabaseStorageObject(new URL(raw));

  expect(match(signed('trip-covers/user-1/a.jpg', 't'))).toBe(true);
  expect(match(`https://${HOST}/storage/v1/object/public/trip-covers/a.jpg`)).toBe(true);
  // A self-hosted project is still Supabase Storage.
  expect(match('https://storage.example.com/storage/v1/object/sign/trip-covers/a.jpg')).toBe(true);

  expect(match(`https://${HOST}/rest/v1/trips`)).toBe(false);
  expect(match('https://images.pexels.com/photos/1/a.jpg')).toBe(false);
  expect(match('https://evil.example.com/x/storage/v1/object/sign/a.jpg')).toBe(false);
});

/**
 * Two accounts on one device must not see each other's photographs. The static
 * cache holds Trove's own icons and is deliberately not in this list.
 */
test('private media caches cover user media and editorial, but not static assets', () => {
  expect(PRIVATE_MEDIA_CACHES).toContain('trove-pwa-user-media');
  expect(PRIVATE_MEDIA_CACHES).toContain('trove-pwa-editorial-images');
  expect(PRIVATE_MEDIA_CACHES).not.toContain(STATIC_IMAGE_CACHE);
});
