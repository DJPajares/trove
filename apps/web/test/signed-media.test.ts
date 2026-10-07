import { expect, test } from 'vitest';

import { moveHighlightOrder } from '../lib/memories/highlights.ts';
import {
  SIGNED_MEDIA_REFRESH_INTERVAL_MS,
  shouldRefreshSignedMedia,
} from '../lib/memories/signed-media.ts';

const BASE = {
  canDecodeHeic: false,
  contentType: 'image/jpeg',
  lastRefreshAt: null,
  now: 1_000_000,
  online: true,
  url: 'https://project.supabase.co/storage/v1/object/sign/memory-photos/a.jpg?token=x',
};

test('an expired signed link is worth one refresh', () => {
  expect(shouldRefreshSignedMedia(BASE)).toBe(true);
});

test('failures a fresh link cannot fix stay quiet', () => {
  expect(shouldRefreshSignedMedia({ ...BASE, url: 'blob:https://trove.app/123' })).toBe(false);
  expect(shouldRefreshSignedMedia({ ...BASE, url: 'data:image/png;base64,AAAA' })).toBe(false);
  expect(shouldRefreshSignedMedia({ ...BASE, url: null })).toBe(false);
  expect(shouldRefreshSignedMedia({ ...BASE, online: false })).toBe(false);
  expect(shouldRefreshSignedMedia({ ...BASE, contentType: 'image/heic' })).toBe(false);
  expect(
    shouldRefreshSignedMedia({ ...BASE, canDecodeHeic: true, contentType: 'image/heic' }),
  ).toBe(true);
});

test('at most one refresh a minute, whatever fails', () => {
  const justNow = { ...BASE, lastRefreshAt: BASE.now - 1_000 };
  expect(shouldRefreshSignedMedia(justNow)).toBe(false);
  expect(
    shouldRefreshSignedMedia({
      ...BASE,
      lastRefreshAt: BASE.now - SIGNED_MEDIA_REFRESH_INTERVAL_MS,
    }),
  ).toBe(true);
});

test('a Highlight moves one step in the curated order, and never past either end', () => {
  const order = ['a', 'b', 'c'];
  expect(moveHighlightOrder(order, 'b', -1)).toStrictEqual(['b', 'a', 'c']);
  expect(moveHighlightOrder(order, 'b', 1)).toStrictEqual(['a', 'c', 'b']);
  expect(moveHighlightOrder(order, 'a', -1)).toBeNull();
  expect(moveHighlightOrder(order, 'c', 1)).toBeNull();
  expect(moveHighlightOrder(order, 'missing', 1)).toBeNull();
});
