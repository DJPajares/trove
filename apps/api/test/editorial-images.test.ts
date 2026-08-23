import { beforeEach, expect, test } from 'vitest';

import {
  CachedEditorialImagesService,
  EDITORIAL_IMAGE_CACHE_TTL_MS,
  EDITORIAL_IMAGE_MISS_TTL_MS,
} from '../src/services/cached-editorial-images.js';
import { resetEditorialImageBudget } from '../src/services/editorial-image-budget.js';
import {
  editorialSubjectKey,
  EditorialImageProviderError,
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
  cachedAt: Date | null;
  dominantColor: string | null;
  externalPhotoId: string | null;
  height: number | null;
  id: string;
  largeUrl: string | null;
  mediumUrl: string | null;
  missCode: string | null;
  missedAt: Date | null;
  photographerName: string | null;
  photographerUrl: string | null;
  provider: string | null;
  providerPageUrl: string | null;
  smallUrl: string | null;
  subjectKey: string;
  width: number | null;
};

const rows = new Map<string, EditorialImageRow>();
const tripUpdates: { data: Record<string, unknown>; where: Record<string, unknown> }[] = [];
const placeUpdates: { data: Record<string, unknown>; where: Record<string, unknown> }[] = [];

function blankRow(subjectKey: string): EditorialImageRow {
  return {
    altText: null,
    cachedAt: null,
    dominantColor: null,
    externalPhotoId: null,
    height: null,
    id: `image-${rows.size + 1}`,
    largeUrl: null,
    mediumUrl: null,
    missCode: null,
    missedAt: null,
    photographerName: null,
    photographerUrl: null,
    provider: null,
    providerPageUrl: null,
    smallUrl: null,
    subjectKey,
    width: null,
  };
}

function installStubPrisma() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    editorialImage: {
      findMany: async (args: { where: { subjectKey: { in: string[] } } }) =>
        args.where.subjectKey.in.flatMap((subjectKey) => {
          const row = rows.get(subjectKey);
          return row ? [row] : [];
        }),
      upsert: async (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { subjectKey: string };
      }) => {
        const existing = rows.get(args.where.subjectKey) ?? blankRow(args.where.subjectKey);
        Object.assign(existing, args.update);
        rows.set(args.where.subjectKey, existing);
        return { id: existing.id };
      },
    },
    place: {
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

function storePhoto(subjectKey: string, cachedAt: Date, externalPhotoId = 'photo-1') {
  const row = blankRow(subjectKey);

  rows.set(subjectKey, {
    ...row,
    cachedAt,
    dominantColor: '#123456',
    externalPhotoId,
    height: 650,
    largeUrl: 'https://images.example/large.jpg',
    mediumUrl: 'https://images.example/medium.jpg',
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://www.pexels.com/@ada',
    provider: 'PEXELS',
    providerPageUrl: 'https://www.pexels.com/photo/photo-1/',
    smallUrl: 'https://images.example/small.jpg',
    width: 940,
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
    sources: {
      large: 'https://images.example/large.jpg',
      medium: 'https://images.example/medium.jpg',
      small: 'https://images.example/small.jpg',
    },
    width: 940,
  };
}

/** A provider that records every subject it was asked about. */
function countingProvider(
  answer: (subject: EditorialImageSubject) => EditorialImageReference | null = () =>
    reference('photo-1'),
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
});

test('the Pexels request asks for one large landscape photo and carries the key', async () => {
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

  await provider.search({ category: 'stay', name: 'Lisbon' });

  const url = new URL(capturedUrl);
  expect(url.pathname).toBe('/v1/search');
  expect(url.searchParams.get('query')).toBe('Lisbon hotel');
  expect(url.searchParams.get('per_page')).toBe('1');
  expect(url.searchParams.get('orientation')).toBe('landscape');
  expect(url.searchParams.get('size')).toBe('large');
  expect((capturedInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
    'server-key',
  );
  expect(getProviderCallCounts()['pexels:search']).toBe(1);
});

test('a Pexels photo maps to a reference that can always be credited', async () => {
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        photos: [
          {
            alt: 'Tram on a hill',
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

  const image = await provider.search({ name: 'Lisbon' });

  expect(image?.externalPhotoId).toBe('4321');
  expect(image?.attribution).toStrictEqual({
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://www.pexels.com/@ada',
    providerName: 'pexels',
    providerPageUrl: 'https://www.pexels.com/photo/tram-4321/',
  });
  expect(image?.sources).toStrictEqual({
    large: 'https://images.example/large2x.jpg',
    medium: 'https://images.example/large.jpg',
    small: 'https://images.example/medium.jpg',
  });
  expect(image?.dominantColor).toBe('#5A6B7C');
  expect(image?.altText).toBe('Tram on a hill');
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

  expect(await provider.search({ name: 'Nowhere' })).toBeNull();
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
  expect(buildPexelsQuery({ category: 'other', name: 'Central' })).toBe('Central');
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

test('a cached subject resolves the same photo again and costs no provider call', async () => {
  storePhoto('destination:kyoto', new Date('2026-08-20T00:00:00.000Z'));
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

test('a stale photo is refreshed once, and a fresh one is not', async () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  storePhoto('destination:oslo', new Date(now.getTime() - EDITORIAL_IMAGE_CACHE_TTL_MS - DAY_MS));
  const { provider, subjects } = countingProvider(() => reference('photo-2'));
  const service = new CachedEditorialImagesService(provider, () => now);

  const refreshed = await service.resolveMany([{ subject: { name: 'Oslo' } }], owner);
  const reread = await service.resolveMany([{ subject: { name: 'Oslo' } }], owner);

  expect(subjects, 'only the stale read reached the provider').toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ status: 'ok' });
  expect(reread[0]).toStrictEqual(refreshed[0]);
});

test('a subject the provider has nothing for is not asked about again', async () => {
  const { provider, subjects } = countingProvider(() => null);
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const first = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);
  const second = await service.resolveMany([{ subject: { name: 'Nowhere' } }], owner);

  expect(first[0]).toStrictEqual({ status: 'empty', subjectKey: 'destination:nowhere' });
  expect(second[0]).toStrictEqual(first[0]);
  expect(subjects, 'the empty answer was remembered').toHaveLength(1);
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
  storePhoto('destination:porto', new Date('2026-01-01T00:00:00.000Z'));
  const { calls, provider } = failingProvider('provider_unavailable');
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
  );

  const [result] = await service.resolveMany([{ subject: { name: 'Porto' } }], owner);

  expect(calls()).toBe(1);
  expect(result).toMatchObject({ status: 'ok' });
  expect(result?.status === 'ok' && result.image.attribution.photographerName).toBe('Ada Rivera');
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

test('every resolved photo carries its attribution and is recorded as provider usage', async () => {
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  storePhoto('destination:hanoi', new Date('2026-08-21T00:00:00.000Z'));
  const service = new CachedEditorialImagesService(
    countingProvider().provider,
    () => new Date('2026-08-22T00:00:00.000Z'),
    undefined,
    'editorial-images',
  );

  const [result] = await service.resolveMany([{ subject: { name: 'Hanoi' } }], owner);

  expect(result?.status === 'ok' && result.image.attribution).toStrictEqual({
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
