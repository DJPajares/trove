import { expect, test } from 'vitest';

import type { EditorialImageReference } from '../lib/media/editorial-images.ts';
import { resolvePlaceMediaSource, resolveTripMediaSource } from '../lib/media/trip-media.ts';

const editorial: EditorialImageReference = {
  altText: 'A canal at dusk',
  attribution: {
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://provider.example/ada',
    providerName: 'pexels',
    providerPageUrl: 'https://provider.example/photo/1',
  },
  dominantColor: '#2f4858',
  externalPhotoId: '1',
  height: 800,
  sourceUrl: 'https://images.pexels.com/photos/1/photo.jpeg',
  width: 1200,
};

test('an existing trip cover leads the media precedence', () => {
  expect(
    resolveTripMediaSource({
      coverUrl: 'https://assets.example/trip-cover.jpg',
      editorial,
      memoryUrl: 'blob:memory-photo',
    }),
  ).toStrictEqual({ kind: 'trip-cover', url: 'https://assets.example/trip-cover.jpg' });
});

test('already-loaded Memory media is used when no trip cover exists', () => {
  expect(resolveTripMediaSource({ editorial, memoryUrl: 'blob:memory-photo' })).toStrictEqual({
    kind: 'memory',
    url: 'blob:memory-photo',
  });
});

test('an editorial photograph is used only once the traveller has given none', () => {
  expect(resolveTripMediaSource({ coverUrl: '  ', editorial, memoryUrl: '' })).toStrictEqual({
    kind: 'editorial',
    reference: editorial,
  });
});

test('missing or blank media resolves to the branded fallback', () => {
  expect(resolveTripMediaSource({})).toStrictEqual({ kind: 'fallback' });
  expect(resolveTripMediaSource({ coverUrl: '  ', editorial: null, memoryUrl: '' })).toStrictEqual({
    kind: 'fallback',
  });
});

test('a place has only the editorial rung and the fallback below it', () => {
  expect(resolvePlaceMediaSource({ editorial })).toStrictEqual({
    kind: 'editorial',
    reference: editorial,
  });
  expect(resolvePlaceMediaSource({})).toStrictEqual({ kind: 'fallback' });
});

test('media resolution stays synchronous and has no Places-backed path', () => {
  for (const resolver of [resolveTripMediaSource, resolvePlaceMediaSource]) {
    const implementation = resolver.toString();
    expect(implementation).not.toMatch(/await|fetch|google|places/i);
  }

  const source = resolveTripMediaSource({ coverUrl: 'https://assets.example/cover.jpg' });
  expect(source).not.toHaveProperty('provider');
});
