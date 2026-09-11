import { expect, test } from 'vitest';

import {
  avatarTarget,
  memoryPhotoTarget,
  reservationImageTarget,
  scaledDimensions,
  shouldKeepEncoded,
  tripCoverTarget,
  webpFileName,
} from '../lib/media/compress-image.ts';
import { memoryPhotoPath } from '../lib/memories/storage.ts';

test('a phone photograph is scaled to the target on its long edge', () => {
  expect(scaledDimensions(4032, 3024, 2048)).toStrictEqual({ height: 1536, width: 2048 });
});

test('the long edge is the constraint whichever way the phone was held', () => {
  expect(scaledDimensions(3024, 4032, 2048)).toStrictEqual({ height: 2048, width: 1536 });
});

/**
 * The regression that would quietly make storage worse rather than better:
 * bytes spent inventing pixels the source never had.
 */
test('an image smaller than the target is left alone rather than enlarged', () => {
  expect(scaledDimensions(2000, 2000, 2048)).toStrictEqual({ height: 2000, width: 2000 });
  expect(scaledDimensions(800, 600, 512)).toStrictEqual({ height: 384, width: 512 });
});

test('an image already exactly at the target is not resampled for nothing', () => {
  expect(scaledDimensions(2048, 1536, 2048)).toStrictEqual({ height: 1536, width: 2048 });
});

/** A canvas of zero height cannot be encoded, so a panorama must not round to it. */
test('a panorama keeps a drawable short edge', () => {
  expect(scaledDimensions(4000, 3, 2048)).toStrictEqual({ height: 2, width: 2048 });
});

test('the scaled edge rounds rather than truncates', () => {
  expect(scaledDimensions(4032, 3025, 2048).height).toBe(1537);
});

test('a re-encoded photo is renamed for the format it now holds', () => {
  expect(webpFileName('IMG_1234.JPG')).toBe('IMG_1234.webp');
  expect(webpFileName('IMG_1234.HEIC')).toBe('IMG_1234.webp');
});

test('only the last segment of a dotted name is the extension', () => {
  expect(webpFileName('holiday.photo.jpeg')).toBe('holiday.photo.webp');
});

test('a name with no extension gains one rather than losing its name', () => {
  expect(webpFileName('screenshot')).toBe('screenshot.webp');
});

test('a name that is only an extension still produces a usable file name', () => {
  expect(webpFileName('photo.')).toBe('photo.webp');
  expect(webpFileName('')).toBe('photo.webp');
});

/**
 * The stored object takes its extension from the file name, so building the
 * path before compressing would name every object `.jpg` while it held WebP.
 */
test('a prepared name carries the format through to the stored object path', () => {
  const path = memoryPhotoPath('user', 'trip', 'memory', 'photo', webpFileName('IMG_1234.JPG'));
  expect(path).toBe('user/trip/memory/photo.webp');
});

test('an encode is kept only when it actually saved bytes', () => {
  expect(shouldKeepEncoded(3_000_000, 350_000)).toBe(true);
  // A flat-colour PNG and an already-optimised WebP both genuinely grow.
  expect(shouldKeepEncoded(40_000, 52_000)).toBe(false);
  // Equal is not worth a generation of quality.
  expect(shouldKeepEncoded(40_000, 40_000)).toBe(false);
  // An empty result is a failed encode, not a spectacular one.
  expect(shouldKeepEncoded(3_000_000, 0)).toBe(false);
});

/**
 * Storage media renders `unoptimized`, so the stored object is delivered
 * verbatim and these numbers are the real resolution rather than a hint.
 * `deviceSizes` in `next.config.ts` stops at 2048 for the same reason.
 */
test('no surface asks for more pixels than any layout can use', () => {
  const targets = [memoryPhotoTarget, tripCoverTarget, avatarTarget, reservationImageTarget];
  for (const target of targets) {
    expect(target.maxEdge).toBeLessThanOrEqual(2048);
    expect(target.quality).toBeGreaterThan(0);
    expect(target.quality).toBeLessThanOrEqual(1);
  }
});
