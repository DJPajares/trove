import { beforeEach, expect, test } from 'vitest';

import { resetEditorialImageBudget } from '../src/services/editorial-image-budget.js';
import { editorialSceneScore } from '../src/services/editorial-image-matching.js';
import type { EditorialImageSubject } from '../src/services/editorial-images.js';
import {
  buildPexelsQuery,
  PexelsEditorialImageProvider,
} from '../src/services/pexels-editorial-images.js';
import { getProviderCallCounts, resetProviderCallCounts } from '../src/services/provider-usage.js';

function photo(id: number, alt: string, width = 2400, height = 1350) {
  return {
    id,
    alt,
    width,
    height,
    photographer: 'Example Photographer',
    photographer_url: 'https://www.pexels.com/@example',
    url: `https://www.pexels.com/photo/example-${id}/`,
    src: { original: `https://images.pexels.com/photos/${id}/example.jpeg` },
  };
}

async function select(photos: unknown[], subject: EditorialImageSubject = { name: 'Kyoto' }) {
  let requests = 0;
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'test-key',
    hourlyBudget: 150,
    fetcher: async (input) => {
      requests += 1;
      const url = new URL(input);
      expect(url.searchParams.get('orientation')).toBe('landscape');
      expect(url.searchParams.get('per_page')).toBe(subject.kind === 'generic' ? '16' : '15');
      return Response.json({ photos, next_page: 'https://api.pexels.com/v1/search?page=2' });
    },
  });
  const images = await provider.search(subject);
  expect(requests).toBe(1);
  expect(getProviderCallCounts()['pexels:search']).toBe(1);
  return images.map((image) => image.externalPhotoId);
}

beforeEach(() => {
  resetEditorialImageBudget();
  resetProviderCallCounts();
});

test.each([
  'Portrait of a smiling woman in Kyoto',
  'Close-up of a man in front of Kyoto temple',
  'Selfie at Kyoto temple',
  'Fashion model posing beside Kyoto architecture',
  'A stylish woman wearing a dress on a Kyoto street',
  'Couple looking at the camera in Kyoto',
])('excludes people-focused imagery: %s', async (alt) => {
  expect(await select([photo(1, alt), photo(2, 'Kyoto temple courtyard with visitors')])).toEqual([
    '2',
  ]);
});

test.each([
  'Kyoto streetscape with people walking in the distance',
  'Aerial view of Kyoto market crowds',
  'Kyoto National Portrait Gallery exterior with people on the street',
  'Kyoto fashion district architecture and pedestrians',
  'Close-up of Kyoto temple architecture with tourists in the distance',
])('retains place-first imagery with incidental people: %s', async (alt) => {
  expect(await select([photo(1, alt)])).toEqual(['1']);
});

test('landscape selection beats a stronger text match and never admits a different destination', async () => {
  expect(
    await select(
      [
        photo(1, 'Kyoto Japan temple skyline', 1350, 2400),
        photo(2, 'Kyoto temple courtyard', 2400, 1600),
        photo(3, 'Paris France skyline'),
      ],
      { name: 'Kyoto', address: 'Kyoto, Kyoto, Japan' },
    ),
  ).toEqual(['2']);
});

test('scene focus, cover shape, resolution and provider order rank verified landscapes', async () => {
  expect(
    await select([
      photo(1, 'Kyoto Japan photograph'),
      photo(2, 'Kyoto temple skyline', 4000, 800),
      photo(3, 'Kyoto temple skyline', 800, 450),
      photo(4, 'Kyoto temple skyline'),
      photo(5, 'Kyoto temple skyline'),
    ]),
  ).toEqual(['4', '5', '3']);
});

test('shared generic pools omit portraits even when fewer than eight landscapes remain', async () => {
  expect(
    await select(
      [
        photo(1, 'Woman posing on holiday'),
        photo(2, 'Coastline at sunset'),
        photo(3, 'Mountain landscape', 1350, 2400),
      ],
      { name: 'travel destination', kind: 'generic', category: 'destination' },
    ),
  ).toEqual(['2']);
});

test('fallbacks use square, unknown dimensions, then portrait scenery without a retry', async () => {
  expect(
    await select([
      photo(1, 'Kyoto temple', 1350, 2400),
      photo(2, 'Kyoto temple', 1500, 1500),
      { ...photo(3, 'Kyoto temple'), width: undefined, height: undefined },
    ]),
  ).toEqual(['2', '3']);
});

test('a lone taller place photograph remains a usable fallback', async () => {
  expect(await select([photo(1, 'Kyoto temple', 1350, 2400)])).toEqual(['1']);
});

test('an entirely people-focused response is empty without paging or a broader search', async () => {
  expect(await select([photo(1, 'Kyoto selfie'), photo(2, 'Woman posing in Kyoto')])).toEqual([]);
});

test('missing captions remain neutral, and photographer names or loose tags cannot reject a scene', () => {
  expect(editorialSceneScore({ altText: null })).toBe(0);
  expect(editorialSceneScore({ altText: 'Kyoto skyline', metadata: ['portrait', 'woman'] })).toBe(
    1,
  );
  expect(
    editorialSceneScore({ providerPageUrl: 'https://www.pexels.com/photo/woman-posing-123/' }),
  ).toBe(-1);
});

test('person words in place names do not turn a landmark into a portrait', async () => {
  expect(
    await select([photo(1, 'Man Mo Temple exterior in Hong Kong')], { name: 'Man Mo Temple' }),
  ).toEqual(['1']);
});

test('scene filtering cannot weaken day geography and theme requirements', async () => {
  expect(
    await select(
      [
        photo(1, 'Tokyo Japan cityscape during the day'),
        photo(2, 'Kyoto Japan skyline at night'),
        photo(3, 'Woman posing in Tokyo Japan at night'),
        photo(4, 'Tokyo Japan cityscape illuminated at night'),
      ],
      { name: 'Tokyo', context: { area: 'Tokyo', countryCode: 'JP', theme: 'nightlife' } },
    ),
  ).toEqual(['4']);
});

test('queries preserve geographic and theme anchors and add positive scene terms', () => {
  expect(buildPexelsQuery({ name: 'Kyoto' })).toBe('Kyoto scenery');
  expect(buildPexelsQuery({ name: 'Tokyo', context: { area: 'Tokyo', countryCode: 'JP' } })).toBe(
    'Tokyo Japan scenery',
  );
  expect(
    buildPexelsQuery({
      name: 'Shopping in Tokyo',
      context: { area: 'Tokyo', countryCode: 'JP', theme: 'shopping' },
    }),
  ).toBe('Tokyo Japan shopping streetscape');
  expect(
    buildPexelsQuery({
      name: 'Ubud',
      context: { area: 'Ubud', countryCode: 'ID', theme: 'nature' },
    }),
  ).toBe('Ubud Indonesia nature landscape');
});
