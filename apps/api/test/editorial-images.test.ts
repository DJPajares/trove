import { beforeEach, expect, test } from 'vitest';

import {
  CachedEditorialImagesService,
  EDITORIAL_IMAGE_CACHE_TTL_MS,
  EDITORIAL_IMAGE_MISS_TTL_MS,
} from '../src/services/cached-editorial-images.js';
import { resetEditorialImageBudget } from '../src/services/editorial-image-budget.js';
import { editorialCoverFitScore } from '../src/services/editorial-image-matching.js';
import {
  detailedEditorialPlaceType,
  editorialMatchScore,
  genericEditorialSubject,
} from '../src/services/editorial-image-matching.js';
import {
  EDITORIAL_IMAGE_RESOLUTION_VERSION,
  editorialSubjectKey,
  EditorialImageProviderError,
  MAX_GENERIC_IMAGES,
  type EditorialImageProvider,
  type EditorialImageReference,
  type EditorialImageSubject,
} from '../src/services/editorial-images.js';
import { createEditorialImagesService } from '../src/services/editorial-images-runtime.js';
import {
  buildPexelsQuery,
  mapPexelsError,
  PexelsEditorialImageProvider,
} from '../src/services/pexels-editorial-images.js';
import { PROVIDER_CONCURRENCY_LIMIT } from '../src/services/concurrency.js';
import {
  getProviderCallCounts,
  resetProviderCallCounts,
  setProviderUsageSink,
  type ProviderUsageEvent,
} from '../src/services/provider-usage.js';

/**
 * Editorial imagery is free but rate limited, and it is the one media source
 * that reaches outside Trove. These tests hold the two invariants that make it
 * safe to put on every screen: a subject resolves to the same photograph every
 * time, and a subject already answered costs nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

type EditorialImageRow = {
  altText: string | null;
  dominantColor: string | null;
  externalPhotoId: string;
  height: number | null;
  id: string;
  photographerName: string;
  photographerUrl: string;
  position: number;
  providerPageUrl: string;
  sourceUrl: string;
  width: number | null;
};

type EditorialImageSetRow = {
  cachedAt: Date | null;
  id: string;
  images: EditorialImageRow[];
  missCode: string | null;
  missedAt: Date | null;
  resolutionVersion: number;
  subjectKey: string;
};

type CachedPlaceRow = {
  id: string;
  ownerId: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: Array<{
    cachedFormattedAddress: string | null;
    cachedLanguageCode: string | null;
    cachedName: string | null;
    cachedPrimaryType: string | null;
    cachedTypes: string[];
    provider: 'GOOGLE';
  }>;
};

const rows = new Map<string, EditorialImageSetRow>();
const places = new Map<string, CachedPlaceRow>();
const tripUpdates: { data: Record<string, unknown>; where: Record<string, unknown> }[] = [];
const placeUpdates: { data: Record<string, unknown>; where: Record<string, unknown> }[] = [];
let cacheReadFails = false;
let cacheWriteFails = false;

function blankRow(subjectKey: string): EditorialImageSetRow {
  return {
    cachedAt: null,
    id: `image-set-${rows.size + 1}`,
    images: [],
    missCode: null,
    missedAt: null,
    resolutionVersion: EDITORIAL_IMAGE_RESOLUTION_VERSION,
    subjectKey,
  };
}

function installStubPrisma() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    editorialImageSet: {
      findMany: async (args: { where: { subjectKey: { in: string[] } } }) =>
        cacheReadFails
          ? Promise.reject(new Error('cache read failed'))
          : args.where.subjectKey.in.flatMap((subjectKey) => {
              const row = rows.get(subjectKey);
              return row ? [row] : [];
            }),
      upsert: async (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { subjectKey: string };
      }) => {
        if (cacheWriteFails) throw new Error('cache write failed');
        const existing = rows.get(args.where.subjectKey) ?? blankRow(args.where.subjectKey);
        const data = rows.has(args.where.subjectKey) ? args.update : args.create;
        const { images, ...setData } = data;
        Object.assign(existing, setData);

        const nested = images as
          | { create?: Array<Record<string, unknown>>; deleteMany?: Record<string, never> }
          | undefined;
        if (nested?.deleteMany) existing.images = [];
        if (nested?.create) {
          existing.images = nested.create.map((image, index) => ({
            ...image,
            id: `image-${index + 1}`,
          })) as EditorialImageRow[];
        }
        rows.set(args.where.subjectKey, existing);
        return { id: existing.id };
      },
    },
    place: {
      findMany: async (args: {
        where: { id: { in: string[] }; OR: Array<{ ownerId: string | null }> };
      }) =>
        args.where.id.in.flatMap((id) => {
          const place = places.get(id);
          return place && args.where.OR.some(({ ownerId }) => ownerId === place.ownerId)
            ? [place]
            : [];
        }),
      updateMany: async (args: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        placeUpdates.push(args);
        return { count: 1 };
      },
    },
    trip: {
      updateMany: async (args: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        tripUpdates.push(args);
        return { count: 1 };
      },
    },
  };
}

function storePhotos(subjectKey: string, cachedAt: Date, count = 1) {
  const row = blankRow(subjectKey);

  rows.set(subjectKey, {
    ...row,
    cachedAt,
    images: Array.from({ length: count }, (_, position) => {
      const externalPhotoId = `photo-${position + 1}`;
      return {
        altText: 'A quiet street',
        dominantColor: '#123456',
        externalPhotoId,
        height: 650,
        id: `image-${externalPhotoId}`,
        photographerName: 'Ada Rivera',
        photographerUrl: 'https://www.pexels.com/@ada',
        position,
        providerPageUrl: `https://www.pexels.com/photo/${externalPhotoId}/`,
        sourceUrl: `https://images.example/${externalPhotoId}/original.jpg`,
        width: 940,
      };
    }),
  });
}

function reference(externalPhotoId: string): EditorialImageReference {
  return {
    altText: 'A quiet street',
    attribution: {
      photographerName: 'Ada Rivera',
      photographerUrl: 'https://www.pexels.com/@ada',
      providerName: 'pexels',
      providerPageUrl: `https://www.pexels.com/photo/${externalPhotoId}/`,
    },
    dominantColor: '#123456',
    externalPhotoId,
    height: 650,
    sourceUrl: 'https://images.example/original.jpg',
    width: 940,
  };
}

/** A provider that records every subject it was asked about. */
function countingProvider(
  answer: (subject: EditorialImageSubject) => EditorialImageReference[] = () => [
    reference('photo-1'),
  ],
) {
  const subjects: EditorialImageSubject[] = [];
  const provider: EditorialImageProvider = {
    name: 'pexels',
    async search(subject) {
      subjects.push(subject);
      return answer(subject);
    },
  };

  return { provider, subjects };
}

function failingProvider(code: 'provider_unavailable' | 'rate_limited') {
  let calls = 0;
  const provider: EditorialImageProvider = {
    name: 'pexels',
    async search() {
      calls += 1;
      throw new EditorialImageProviderError(code);
    },
  };

  return { calls: () => calls, provider };
}

const owner = { ownerId: 'owner-1' };

beforeEach(() => {
  rows.clear();
  places.clear();
  cacheReadFails = false;
  cacheWriteFails = false;
  tripUpdates.length = 0;
  placeUpdates.length = 0;
  resetEditorialImageBudget();
  resetProviderCallCounts();
  setProviderUsageSink(null);
  installStubPrisma();
});

test('the subject key normalises spelling and keeps categories apart', () => {
  expect(editorialSubjectKey({ name: '  Kyōto   Station ' })).toBe('destination:kyoto station');
  expect(editorialSubjectKey({ category: 'stay', name: 'Kyoto Station' })).toBe(
    'stay:kyoto station',
  );
  expect(editorialSubjectKey({ category: 'food_and_drink', name: 'Central' })).not.toBe(
    editorialSubjectKey({ category: 'transport', name: 'Central' }),
  );
  expect(editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'PLACE-A' })).toBe(
    'place:place-a',
  );
  expect(editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'place-a' })).not.toBe(
    editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'place-b' }),
  );
  expect(editorialSubjectKey({ category: 'food_and_drink', kind: 'generic', name: 'Bakery' })).toBe(
    'generic:food_and_drink:bakery',
  );
});

test('an exact Pexels request asks for enough candidates to verify the place', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({ photos: [] });
    },
    hourlyBudget: 150,
  });

  await provider.search({ category: 'stay', languageCode: 'pt', name: 'Lisbon' });

  const url = new URL(capturedUrl);
  expect(url.pathname).toBe('/v1/search');
  expect(url.searchParams.get('query')).toBe('Lisbon hotel');
  expect(url.searchParams.get('per_page')).toBe('15');
  expect(url.searchParams.get('locale')).toBe('pt-BR');
  expect(url.searchParams.get('orientation')).toBe('landscape');
  expect(url.searchParams.get('size')).toBe('large');
  expect((capturedInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
    'server-key',
  );
  expect(getProviderCallCounts()['pexels:search']).toBe(1);
});

test('a shared generic Pexels request asks for enough to fill the fallback pool', async () => {
  let capturedUrl = '';
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async (input) => {
      capturedUrl = String(input);
      return Response.json({ photos: [] });
    },
    hourlyBudget: 150,
  });

  await provider.search({ category: 'food_and_drink', kind: 'generic', name: 'bakery' });

  expect(Number(new URL(capturedUrl).searchParams.get('per_page'))).toBeGreaterThanOrEqual(
    MAX_GENERIC_IMAGES,
  );
});

test('a Pexels photo maps to a reference that can always be credited', async () => {
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        photos: [
          {
            alt: 'Lisbon tram on a hill',
            avg_color: '#5A6B7C',
            height: 4000,
            id: 4321,
            photographer: 'Ada Rivera',
            photographer_url: 'https://www.pexels.com/@ada',
            src: {
              large: 'https://images.example/large.jpg',
              large2x: 'https://images.example/large2x.jpg',
              medium: 'https://images.example/medium.jpg',
              original: 'https://images.example/original.jpg',
            },
            url: 'https://www.pexels.com/photo/tram-4321/',
            width: 6000,
          },
        ],
      }),
    hourlyBudget: 150,
  });

  const [image] = await provider.search({ name: 'Lisbon' });

  expect(image?.externalPhotoId).toBe('4321');
  expect(image?.attribution).toStrictEqual({
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://www.pexels.com/@ada',
    providerName: 'pexels',
    providerPageUrl: 'https://www.pexels.com/photo/tram-4321/',
  });
  expect(image?.sourceUrl).toBe('https://images.example/original.jpg');
  expect(image?.dominantColor).toBe('#5A6B7C');
  expect(image?.altText).toBe('Lisbon tram on a hill');
});

test('a photo Trove could not credit is treated as no photo at all', async () => {
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        photos: [
          {
            id: 1,
            photographer: '   ',
            src: { original: 'https://images.example/original.jpg' },
            url: 'https://www.pexels.com/photo/1/',
          },
        ],
      }),
    hourlyBudget: 150,
  });

  expect(await provider.search({ name: 'Nowhere' })).toStrictEqual([]);
});

test('provider failures map to codes a surface can degrade on', () => {
  expect(mapPexelsError(429, {}).code).toBe('rate_limited');
  expect(mapPexelsError(401, {}).code).toBe('configuration_missing');
  expect(mapPexelsError(400, {}).code).toBe('invalid_request');
  expect(mapPexelsError(503, {}).code).toBe('provider_unavailable');
});

test('a place query carries its category so a name alone is never the whole ask', () => {
  expect(buildPexelsQuery({ category: 'food_and_drink', name: 'Central' })).toBe(
    'Central restaurant',
  );
  expect(buildPexelsQuery({ category: 'other', name: 'Central' })).toBe('Central travel place');
  expect(
    buildPexelsQuery({
      address: '123 Main Street, Kyoto, Japan',
      category: 'food_and_drink',
      name: 'Central',
      primaryType: 'bakery',
      rawTypes: ['bakery', 'food', 'point_of_interest'],
    }),
  ).toBe('Central Kyoto Japan bakery restaurant');
});

test('only a meaningful type in the same category becomes a shared generic subject', () => {
  const bakery = {
    category: 'food_and_drink' as const,
    name: 'Central',
    primaryType: 'point_of_interest',
    rawTypes: ['point_of_interest', 'bakery', 'establishment'],
  };

  expect(detailedEditorialPlaceType(bakery)).toBe('bakery');
  expect(genericEditorialSubject(bakery)).toStrictEqual({
    category: 'food_and_drink',
    kind: 'generic',
    name: 'bakery',
    primaryType: 'bakery',
  });
  expect(
    genericEditorialSubject({ category: 'things_to_do', name: 'Central', rawTypes: ['bakery'] }),
  ).toMatchObject({ name: 'landmark', primaryType: null });
});

test('an exact photograph must name the place, and an ambiguous name must locate it', () => {
  expect(
    editorialMatchScore(
      { address: '68 Fukakusa, Kyoto, Japan', name: 'Fushimi Inari Taisha' },
      {
        altText: 'Fushimi Inari Taisha shrine in Kyoto',
        providerPageUrl: 'https://www.pexels.com/photo/shrine-12/',
      },
    ),
  ).toBeGreaterThan(100);
  expect(
    editorialMatchScore(
      { address: '68 Fukakusa, Kyoto, Japan', name: 'Fushimi Inari Taisha' },
      { altText: 'A Kyoto shrine', providerPageUrl: 'https://www.pexels.com/photo/shrine-12/' },
    ),
  ).toBe(0);
  expect(
    editorialMatchScore(
      { address: '123 Main Street, Tokyo, Japan', name: 'Central' },
      { altText: 'Central station in Kyoto' },
    ),
  ).toBe(0);
  expect(
    editorialMatchScore(
      { address: '123 Main Street, Tokyo, Japan', name: 'Central' },
      { altText: 'Central station in Tokyo' },
    ),
  ).toBeGreaterThan(0);
});

test('a distinctive landmark can omit business suffixes when its photo names the actual place', () => {
  const hobbiton = {
    address: '501 Buckland Road, Matamata 3472, New Zealand',
    name: 'Hobbiton™ Movie Set Tours',
  };

  expect(
    editorialMatchScore(hobbiton, {
      altText:
        'Lush green landscape of Hobbiton with iconic hobbit holes and serene lake reflecting the vibrant scenery.',
      providerPageUrl: 'https://www.pexels.com/photo/hill-in-the-hobbiton-movie-set-17824132/',
    }),
  ).toBeGreaterThan(100);
  expect(editorialMatchScore(hobbiton, { altText: 'Hobbiton, New Zealand' })).toBeGreaterThan(0);
  expect(
    editorialMatchScore(hobbiton, {
      altText: 'Rolling green hills',
      sourceUrl: 'https://images.example/photos/hobbiton-movie-set.jpg',
    }),
  ).toBeGreaterThan(0);
});

test('all available photo metadata can corroborate a place while contradictory countries reject it', () => {
  const hobbiton = {
    address: '501 Buckland Road, Matamata 3472, New Zealand',
    name: 'Hobbiton™ Movie Set Tours',
  };

  expect(
    editorialMatchScore(hobbiton, {
      altText: 'A green hillside',
      description: 'A visit to Hobbiton',
      metadata: ['Matamata', 'New Zealand'],
      name: 'Movie set landscape',
      title: 'Hobbit holes',
    }),
  ).toBeGreaterThan(100);
  expect(
    editorialMatchScore(hobbiton, {
      altText: 'Hobbiton movie set inspired attraction in England',
    }),
  ).toBe(0);
  expect(
    editorialMatchScore(
      { address: '123 Main Street, Tokyo, Japan', name: 'Central' },
      { altText: 'Central station in Kyoto, Japan' },
    ),
  ).toBe(0);
});

test('Pexels scores optional descriptions, names, titles, tags, and locations without extra calls', async () => {
  let fetches = 0;
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => {
      fetches += 1;
      return Response.json({
        photos: [
          {
            alt: 'Lush hills and a peaceful lake',
            description: 'Explore Hobbiton',
            height: 4000,
            id: 17824132,
            location: { city: 'Matamata', country: 'New Zealand' },
            name: 'Movie set landscape',
            photographer: 'Ada Rivera',
            photographer_url: 'https://www.pexels.com/@ada',
            src: { original: 'https://images.example/hobbiton-movie-set.jpg' },
            tags: ['Hobbiton', { name: 'New Zealand' }],
            title: 'Hobbit holes',
            url: 'https://www.pexels.com/photo/17824132/',
            width: 6000,
          },
        ],
      });
    },
    hourlyBudget: 150,
  });

  const [image] = await provider.search({
    address: '501 Buckland Road, Matamata 3472, New Zealand',
    name: 'Hobbiton™ Movie Set Tours',
  });

  expect(image?.externalPhotoId).toBe('17824132');
  expect(fetches).toBe(1);
});

/**
 * The pool is the whole point: every subject with no photograph of its own draws
 * from it, so keeping one photograph is what put the same picture on every trip.
 * It is still bounded - a pool is not a gallery.
 */
test('Pexels keeps a generic pool, bounded, rather than a single photograph', async () => {
  const photo = (id: number) => ({
    alt: `Bakery interior ${id}`,
    id,
    photographer: 'Ada Rivera',
    photographer_url: 'https://www.pexels.com/@ada',
    src: { original: `https://images.example/${id}.jpg` },
    url: `https://www.pexels.com/photo/bakery-${id}/`,
  });
  const photos = Array.from({ length: MAX_GENERIC_IMAGES + 4 }, (_, index) => photo(index + 1));
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => Response.json({ photos }),
    hourlyBudget: 150,
  });

  expect(
    await provider.search({ category: 'food_and_drink', kind: 'generic', name: 'bakery' }),
  ).toHaveLength(MAX_GENERIC_IMAGES);
});

test('the hourly budget stops requests before they leave the process', async () => {
  let fetches = 0;
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => {
      fetches += 1;
      return Response.json({ photos: [] });
    },
    hourlyBudget: 2,
  });

  await provider.search({ name: 'One' });
  await provider.search({ name: 'Two' });

  await expect(provider.search({ name: 'Three' })).rejects.toMatchObject({
    code: 'rate_limited',
  });
  expect(fetches, 'the blocked request never reached the network').toBe(2);
  expect(getProviderCallCounts()['pexels:search'], 'nor was it counted as spend').toBe(2);
});

test("the provider's own remaining-request header opens the breaker", async () => {
  let fetches = 0;
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => {
      fetches += 1;
      return Response.json(
        { photos: [] },
        { headers: { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '99999999999' } },
      );
    },
    hourlyBudget: 150,
  });

  await provider.search({ name: 'One' });

  await expect(provider.search({ name: 'Two' })).rejects.toMatchObject({ code: 'rate_limited' });
  expect(fetches).toBe(1);
});

test.each([1, 2, 3])(
  'a fresh %i-image collection resolves from PostgreSQL with no provider call',
  async (count) => {
    storePhotos('destination:kyoto', new Date('2026-08-20T00:00:00.000Z'), count);
    const { provider, subjects } = countingProvider();
    const service = new CachedEditorialImagesService(
      provider,
      () => new Date('2026-08-22T00:00:00.000Z'),
    );

    const first = await service.resolveMany([{ subject: { name: 'Kyoto' } }], owner);
    const second = await service.resolveMany([{ subject: { name: '  kyoto ' } }], owner);

    expect(first[0]).toMatchObject({ matchKind: 'exact', status: 'ok' });
    expect(first[0]?.status === 'ok' && first[0].images).toHaveLength(count);
    expect(first).toStrictEqual(second);
    expect(subjects, 'a fresh collection is never asked about').toHaveLength(0);
  },
);

test('Pexels excludes invalid and duplicate photos while preserving provider order', async () => {
  const photo = (id: number, overrides: Record<string, unknown> = {}) => ({
    alt: `Lisbon photo ${id}`,
    avg_color: '#5A6B7C',
    height: 4000,
    id,
    photographer: 'Ada Rivera',
    photographer_url: 'https://www.pexels.com/@ada',
    src: { original: `https://images.example/${id}/original.jpg` },
    url: `https://www.pexels.com/photo/${id}/`,
    width: 6000,
    ...overrides,
  });
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        photos: [
          photo(3),
          photo(3),
          photo(4, { src: {} }),
          photo(2),
          photo(8, { src: { original: 'https://images.example/2/original.jpg' } }),
          photo(1),
          photo(5),
        ],
      }),
    hourlyBudget: 150,
  });

  const images = await provider.search({ name: 'Lisbon' });

  expect(images.map((image) => image.externalPhotoId)).toStrictEqual(['3', '2', '1']);
});

test('a cached subject resolves the same collection again and costs no provider call', async () => {
  storePhotos('destination:kyoto', new Date('2026-08-20T00:00:00.000Z'));
  const { provider, subjects } = countingProvider();
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const first = await service.resolveMany([{ subject: { name: 'Kyoto' } }], owner);
  const second = await service.resolveMany([{ subject: { name: '  kyoto ' } }], owner);

  expect(first[0]).toMatchObject({ status: 'ok' });
  expect(first).toStrictEqual(second);
  expect(subjects, 'a cached subject is never asked about').toHaveLength(0);
});

test('a batch asks about each distinct subject once, however many rows want it', async () => {
  const { provider, subjects } = countingProvider();
  const service = new CachedEditorialImagesService(provider);

  const results = await service.resolveMany(
    [
      { subject: { name: 'Tokyo' }, tripId: 'trip-1' },
      { subject: { name: 'Tokyo' }, tripId: 'trip-2' },
      { subject: { name: 'TOKYO' }, tripId: 'trip-3' },
      { subject: { name: 'Osaka' }, tripId: 'trip-4' },
    ],
    owner,
  );

  expect(subjects).toHaveLength(2);
  expect(results).toHaveLength(4);
  expect(results.every((result) => result.status === 'ok')).toBe(true);
  expect(tripUpdates[0]?.where).toMatchObject({ ownerId: 'owner-1' });
});

test('provider work remains within the shared concurrency limit for collection batches', async () => {
  let active = 0;
  let peak = 0;
  const provider: EditorialImageProvider = {
    name: 'pexels',
    async search(subject) {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return [reference(subject.name)];
    },
  };
  const service = new CachedEditorialImagesService(provider);

  await service.resolveMany(
    Array.from({ length: PROVIDER_CONCURRENCY_LIMIT + 4 }, (_, index) => ({
      subject: { name: `City ${index}` },
    })),
    owner,
  );

  expect(peak).toBeLessThanOrEqual(PROVIDER_CONCURRENCY_LIMIT);
});

test('a stale photo is refreshed once, and a fresh one is not', async () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  storePhotos('destination:oslo', new Date(now.getTime() - EDITORIAL_IMAGE_CACHE_TTL_MS - DAY_MS));
  const { provider, subjects } = countingProvider(() => [reference('photo-2')]);
  const service = new CachedEditorialImagesService(provider, () => now);

  const refreshed = await service.resolveMany([{ subject: { name: 'Oslo' } }], owner);
  const reread = await service.resolveMany([{ subject: { name: 'Oslo' } }], owner);

  expect(subjects, 'only the stale read reached the provider').toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ status: 'ok' });
  expect(reread[0]).toStrictEqual(refreshed[0]);
});

test('a fresh collection from an older resolver version is never served as current', async () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  storePhotos('destination:oslo', now);
  const row = rows.get('destination:oslo');
  if (!row) throw new Error('Expected cached image fixture.');
  row.resolutionVersion = EDITORIAL_IMAGE_RESOLUTION_VERSION - 1;
  const { provider, subjects } = countingProvider(() => [reference('verified-oslo')]);
  const service = new CachedEditorialImagesService(provider, () => now);

  const [result] = await service.resolveMany([{ subject: { name: 'Oslo' } }], owner);

  expect(subjects).toHaveLength(1);
  expect(result?.status === 'ok' && result.images[0]?.externalPhotoId).toBe('verified-oslo');
  expect(rows.get('destination:oslo')?.resolutionVersion).toBe(EDITORIAL_IMAGE_RESOLUTION_VERSION);
});

test('a subject the provider has nothing for is not asked about again', async () => {
  const { provider, subjects } = countingProvider(() => []);
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const first = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);
  const second = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);

  expect(first[0]).toStrictEqual({ status: 'empty', subjectKey: 'destination:nowhere' });
  expect(second[0]).toStrictEqual(first[0]);
  expect(subjects, 'the exact and shared generic answers were both remembered').toHaveLength(2);
});

test('same-name canonical places use cached locality and share one detailed-type fallback', async () => {
  for (const [id, city] of [
    ['place-tokyo', 'Tokyo'],
    ['place-kyoto', 'Kyoto'],
  ] as const) {
    places.set(id, {
      id,
      ownerId: 'owner-1',
      providerAddress: `1 Main Street, ${city}, Japan`,
      providerLabel: 'Central',
      providerRefs: [
        {
          cachedFormattedAddress: `1 Main Street, ${city}, Japan`,
          cachedLanguageCode: 'ja',
          cachedName: 'Central Bakery',
          cachedPrimaryType: 'bakery',
          cachedTypes: ['bakery', 'food', 'point_of_interest'],
          provider: 'GOOGLE',
        },
      ],
    });
  }

  const { provider, subjects } = countingProvider((subject) =>
    subject.kind === 'generic' ? [reference('shared-bakery')] : [],
  );
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );
  const requests = [
    {
      placeId: 'place-tokyo',
      subject: { category: 'food_and_drink' as const, name: 'Central' },
    },
    {
      placeId: 'place-kyoto',
      subject: { category: 'food_and_drink' as const, name: 'Central' },
    },
  ];

  const first = await service.resolveMany(requests, owner);
  const second = await service.resolveMany(requests, owner);

  expect(first.map((result) => result.subjectKey)).toStrictEqual([
    'place:place-tokyo',
    'place:place-kyoto',
  ]);
  expect(first.every((result) => result.status === 'ok' && result.matchKind === 'generic')).toBe(
    true,
  );
  expect(second).toStrictEqual(first);
  expect(subjects).toHaveLength(3);
  expect(subjects[0]).toMatchObject({
    address: '1 Main Street, Tokyo, Japan',
    languageCode: 'ja',
    name: 'Central Bakery',
    primaryType: 'bakery',
  });
  expect(subjects[1]).toMatchObject({ address: '1 Main Street, Kyoto, Japan' });
  expect(subjects[2]).toMatchObject({ kind: 'generic', name: 'bakery' });
  expect(rows.get('place:place-tokyo')?.missCode).toBe('NO_VERIFIED_MATCH');
  expect(rows.get('generic:food_and_drink:bakery')?.images).toHaveLength(1);
});

test('fresh shared generic collections expose their provenance and return the whole pool', async () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  const exact = blankRow('things_to_do:hidden temple');
  rows.set(exact.subjectKey, {
    ...exact,
    missCode: 'NO_VERIFIED_MATCH',
    missedAt: now,
  });
  storePhotos('generic:things_to_do:landmark', now, 3);
  const { provider, subjects } = countingProvider();
  const service = new CachedEditorialImagesService(provider, () => now);

  const [result] = await service.resolveMany(
    [{ subject: { category: 'things_to_do', name: 'Hidden Temple' } }],
    owner,
  );

  expect(result).toMatchObject({ matchKind: 'generic', status: 'ok' });
  // Every photograph stored for the pool comes back, so a surface has something
  // to choose between rather than one answer for everybody.
  expect(result?.status === 'ok' && result.images).toHaveLength(3);
  expect(subjects).toHaveLength(0);
});

test('a verified exact miss remains quiet beyond the ordinary empty-result lifetime', async () => {
  let now = new Date('2026-08-01T00:00:00.000Z');
  const { provider, subjects } = countingProvider((subject) =>
    subject.kind === 'generic' ? [reference('generic-landmark')] : [],
  );
  const service = new CachedEditorialImagesService(provider, () => now);
  const request = { subject: { category: 'things_to_do' as const, name: 'Hidden Temple' } };

  await service.resolveMany([request], owner);
  now = new Date(now.getTime() + EDITORIAL_IMAGE_MISS_TTL_MS + DAY_MS);
  await service.resolveMany([request], owner);

  expect(subjects).toHaveLength(2);

  now = new Date(
    new Date('2026-08-01T00:00:00.000Z').getTime() + EDITORIAL_IMAGE_CACHE_TTL_MS + DAY_MS,
  );
  await service.resolveMany([request], owner);

  expect(subjects.filter((subject) => subject.kind !== 'generic')).toHaveLength(2);
});

test('a rejected older photograph is retained for audit but never returned', async () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  storePhotos('destination:nowhere', now);
  const row = rows.get('destination:nowhere');
  if (!row) throw new Error('Expected cached image fixture.');
  row.resolutionVersion = EDITORIAL_IMAGE_RESOLUTION_VERSION - 1;

  const { provider } = countingProvider((subject) =>
    subject.kind === 'generic' ? [reference('verified-fallback')] : [],
  );
  const service = new CachedEditorialImagesService(provider, () => now);

  const [first] = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);
  const [second] = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);

  expect(first?.status === 'ok' && first.images[0]?.externalPhotoId).toBe('verified-fallback');
  expect(second).toStrictEqual(first);
  expect(rows.get('destination:nowhere')?.images).toHaveLength(1);
  expect(rows.get('destination:nowhere')?.missCode).toBe('NO_VERIFIED_MATCH');
});

test('a negative answer is re-asked once its window has passed', async () => {
  const row = blankRow('destination:nowhere');
  rows.set('destination:nowhere', {
    ...row,
    missCode: 'NO_RESULTS',
    missedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const { provider, subjects } = countingProvider();
  const service = new CachedEditorialImagesService(
    provider,
    () =>
      new Date(
        new Date('2026-08-01T00:00:00.000Z').getTime() + EDITORIAL_IMAGE_MISS_TTL_MS + DAY_MS,
      ),
  );

  const result = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);

  expect(subjects).toHaveLength(1);
  expect(result[0]).toMatchObject({ status: 'ok' });
});

test('a provider outage keeps the photograph the traveller already saw', async () => {
  storePhotos('destination:porto', new Date('2026-01-01T00:00:00.000Z'));
  const { calls, provider } = failingProvider('provider_unavailable');
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const [result] = await service.resolveMany([{ subject: { name: 'Porto' } }], owner);

  expect(calls()).toBe(1);
  expect(result).toMatchObject({ status: 'ok' });
  expect(result?.status === 'ok' && result.images[0]?.attribution.photographerName).toBe(
    'Ada Rivera',
  );
});

test('a provider outage with nothing cached degrades rather than throwing', async () => {
  const { provider } = failingProvider('rate_limited');
  const service = new CachedEditorialImagesService(provider);

  const [result] = await service.resolveMany([{ subject: { name: 'Porto' } }], owner);

  expect(result).toStrictEqual({
    code: 'rate_limited',
    status: 'unavailable',
    subjectKey: 'destination:porto',
  });
});

test('cache read and write failures never prevent the current collection response', async () => {
  cacheReadFails = true;
  cacheWriteFails = true;
  const { provider, subjects } = countingProvider(() => [
    reference('photo-1'),
    reference('photo-2'),
  ]);
  const service = new CachedEditorialImagesService(provider);

  const [result] = await service.resolveMany([{ subject: { name: 'Porto' } }], owner);

  expect(result?.status === 'ok' && result.images).toHaveLength(2);
  expect(subjects).toHaveLength(1);
});

test('every resolved photo carries its attribution and is recorded as provider usage', async () => {
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  storePhotos('destination:hanoi', new Date('2026-08-21T00:00:00.000Z'));
  const service = new CachedEditorialImagesService(
    countingProvider().provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
    undefined,
    'editorial-images',
  );

  const [result] = await service.resolveMany([{ subject: { name: 'Hanoi' } }], owner);

  expect(result?.status === 'ok' && result.images[0]?.attribution).toStrictEqual({
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://www.pexels.com/@ada',
    providerName: 'pexels',
    providerPageUrl: 'https://www.pexels.com/photo/photo-1/',
  });
  expect(events).toContainEqual(
    expect.objectContaining({ cache: 'editorial-image', kind: 'cache_hit', provider: 'pexels' }),
  );
});

test('the kill switch and a missing key are the same no-service answer', () => {
  expect(
    createEditorialImagesService({
      environment: { PEXELS_API_KEY: 'server-key', TROVE_EDITORIAL_IMAGES_DISABLED: '1' },
      source: 'editorial-images',
    }),
    'switched off',
  ).toBeNull();
  expect(
    createEditorialImagesService({ environment: {}, source: 'editorial-images' }),
    'never configured',
  ).toBeNull();
  expect(
    createEditorialImagesService({
      environment: { PEXELS_API_KEY: 'server-key' },
      source: 'editorial-images',
    }),
  ).not.toBeNull();
});

/**
 * A trip's destination is not always a canonical Place: a Custom Place has no
 * row to enrich from. Dropping the request there removed it from the answer
 * entirely - no exact match and no fallback - so the surface rendered the
 * branded placeholder for a trip that had a perfectly good pool to draw on.
 */
test('a request for a place with no cached row still reaches the shared fallback', async () => {
  const { provider, subjects } = countingProvider((subject) =>
    subject.kind === 'generic' ? [reference('shared-destination')] : [],
  );
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const [result] = await service.resolveMany(
    [
      {
        placeId: '00000000-0000-4000-8000-00000000beef',
        subject: { category: 'destination' as const, name: 'Hoi An' },
        tripId: 'trip-a',
      },
    ],
    owner,
  );

  expect(result).toMatchObject({ matchKind: 'generic', status: 'ok' });
  expect(subjects.map((subject) => subject.name)).toStrictEqual(['Hoi An', 'travel destination']);
});

/**
 * A cover is a wide band, so the frame that survives its crop is the one worth
 * putting there. This orders equally relevant photographs and nothing else -
 * relevance is still the first sort key in the provider.
 */
test('cover fit prefers a wide frame over a tall one, and size breaks the rest', () => {
  const wide = editorialCoverFitScore({ height: 1_080, width: 1_920 });
  const tall = editorialCoverFitScore({ height: 1_920, width: 1_080 });
  const panorama = editorialCoverFitScore({ height: 400, width: 4_000 });
  const small = editorialCoverFitScore({ height: 450, width: 800 });

  expect(wide).toBeGreaterThan(tall);
  expect(wide).toBeGreaterThan(panorama);
  // Same shape, less resolution: a cover stretches, so the larger frame wins.
  expect(wide).toBeGreaterThan(small);
  // Nothing to judge is not a preference.
  expect(editorialCoverFitScore({ height: null, width: null })).toBe(0);
  expect(editorialCoverFitScore({ height: 0, width: 0 })).toBe(0);
});
