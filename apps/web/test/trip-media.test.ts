import { expect, test } from 'vitest';

import { resolveTripMediaSource } from '../lib/media/trip-media.ts';

test('an existing trip cover leads the media precedence', () => {
  expect(
    resolveTripMediaSource({
      coverUrl: 'https://assets.example/trip-cover.jpg',
      memoryUrl: 'blob:memory-photo',
    }),
  ).toStrictEqual({ kind: 'trip-cover', url: 'https://assets.example/trip-cover.jpg' });
});

test('already-loaded Memory media is used when no trip cover exists', () => {
  expect(resolveTripMediaSource({ memoryUrl: 'blob:memory-photo' })).toStrictEqual({
    kind: 'memory',
    url: 'blob:memory-photo',
  });
});

test('missing or blank media resolves to the branded fallback', () => {
  expect(resolveTripMediaSource({})).toStrictEqual({ kind: 'fallback' });
  expect(resolveTripMediaSource({ coverUrl: '  ', memoryUrl: '' })).toStrictEqual({
    kind: 'fallback',
  });
});

test('media resolution has no provider-backed or fetching path', () => {
  const implementation = resolveTripMediaSource.toString();
  expect(implementation).not.toMatch(/fetch|google|provider/i);

  const source = resolveTripMediaSource({ coverUrl: 'https://assets.example/cover.jpg' });
  expect(source).not.toHaveProperty('provider');
});
