import { beforeEach, expect, test } from 'vitest';

import {
  reconcileEditorialImages,
  type EditorialImageReconciliationOptions,
} from '../src/services/editorial-image-reconciliation.js';
import {
  EditorialImageProviderError,
  EditorialImagesService,
  type EditorialImageReference,
} from '../src/services/editorial-images.js';

type SetFixture = {
  editorialCoverForTrips: never[];
  editorialImageForPlaces: Array<{
    id: string;
    ownerId: string;
    providerAddress: string;
    providerLabel: string;
    providerRefs: Array<{
      cachedFormattedAddress: string;
      cachedLanguageCode: string;
      cachedName: string;
      cachedPrimaryType: string;
      cachedTypes: string[];
    }>;
  }>;
  id: string;
  resolutionVersion: number;
  subjectKey: string;
};

const sets = new Map<string, SetFixture>();
const imageSetUpdates: unknown[] = [];
const placeUpdates: unknown[] = [];
const tripUpdates: unknown[] = [];
const exactMisses = new Map<string, string>();

const options: EditorialImageReconciliationOptions = {
  apply: false,
  delayMs: 1_000,
  limit: 10,
  maxProviderCalls: 10,
  refresh: false,
  scope: 'outdated',
};

function addPlaceSet(id: string, name: string, type = 'bakery') {
  sets.set(id, {
    editorialCoverForTrips: [],
    editorialImageForPlaces: [
      {
        id: `place-${id}`,
        ownerId: 'owner-1',
        providerAddress: '1 Main Street, Kyoto, Japan',
        providerLabel: name,
        providerRefs: [
          {
            cachedFormattedAddress: '1 Main Street, Kyoto, Japan',
            cachedLanguageCode: 'ja',
            cachedName: name,
            cachedPrimaryType: type,
            cachedTypes: [type, 'point_of_interest'],
          },
        ],
      },
    ],
    id,
    resolutionVersion: 1,
    subjectKey: `food_and_drink:${name.toLowerCase()}`,
  });
}

function image(): EditorialImageReference {
  return {
    altText: 'Bakery in Kyoto',
    attribution: {
      photographerName: 'Ada Rivera',
      photographerUrl: 'https://www.pexels.com/@ada',
      providerName: 'pexels',
      providerPageUrl: 'https://www.pexels.com/photo/bakery-1/',
    },
    dominantColor: '#123456',
    externalPhotoId: '1',
    height: 650,
    sourceUrl: 'https://images.example/1.jpg',
    width: 940,
  };
}

function service(beforeRequest: () => Promise<void>, calls: string[]) {
  return new EditorialImagesService({
    name: 'pexels',
    async search(subject) {
      await beforeRequest();
      calls.push(subject.name);
      return [image()];
    },
  });
}

beforeEach(() => {
  sets.clear();
  imageSetUpdates.length = 0;
  placeUpdates.length = 0;
  tripUpdates.length = 0;
  exactMisses.clear();

  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    editorialImageSet: {
      findMany: async (args: {
        cursor?: { id: string };
        take: number;
        where: { resolutionVersion?: { lt: number } };
      }) => {
        const filtered = [...sets.values()]
          .filter(
            (set) =>
              !args.where.resolutionVersion ||
              set.resolutionVersion < args.where.resolutionVersion.lt,
          )
          .filter((set) => !args.cursor || set.id > args.cursor.id)
          .toSorted((left, right) => left.id.localeCompare(right.id));
        return filtered.slice(0, args.take);
      },
      findUnique: async (args: { where: { subjectKey: string } }) => {
        const missCode = exactMisses.get(args.where.subjectKey);
        return missCode ? { missCode } : null;
      },
      updateMany: async (args: { where: { id: { in: string[] } } }) => {
        imageSetUpdates.push(args);
        return { count: args.where.id.in.length };
      },
    },
    place: {
      updateMany: async (args: unknown) => {
        placeUpdates.push(args);
        return { count: 1 };
      },
    },
    trip: {
      updateMany: async (args: unknown) => {
        tripUpdates.push(args);
        return { count: 0 };
      },
    },
  };
});

test('the default reconciliation pass only reports outdated sets', async () => {
  addPlaceSet('set-1', 'Sunrise');
  addPlaceSet('set-2', 'Moonlight');
  const current = sets.get('set-2');
  if (!current) throw new Error('Expected current-version fixture.');
  current.resolutionVersion = 2;

  const report = await reconcileEditorialImages(options);

  expect(report).toMatchObject({
    examined: 1,
    invalidated: 0,
    mode: 'dry-run',
    nextCursor: 'set-1',
    providerCalls: 0,
  });
  expect(imageSetUpdates).toHaveLength(0);
  expect(placeUpdates).toHaveLength(0);
});

test('lazy application invalidates and unpins selected sets without a provider call', async () => {
  addPlaceSet('set-1', 'Sunrise');
  addPlaceSet('set-2', 'Moonlight');

  const report = await reconcileEditorialImages({ ...options, apply: true });

  expect(report).toMatchObject({
    examined: 2,
    invalidated: 2,
    mode: 'invalidate',
    providerCalls: 0,
  });
  expect(imageSetUpdates).toHaveLength(1);
  expect(placeUpdates).toHaveLength(1);
  expect(tripUpdates).toHaveLength(1);
});

test('a place-scoped lazy run unpins only its requested place and never touches trips', async () => {
  addPlaceSet('set-1', 'Sunrise');

  await reconcileEditorialImages({
    ...options,
    apply: true,
    placeId: 'place-set-1',
  });

  expect(placeUpdates[0]).toMatchObject({
    where: { editorialImageSetId: { in: ['set-1'] }, id: 'place-set-1' },
  });
  expect(tripUpdates).toHaveLength(0);
});

test('active refresh is serial, paced, and reports shared generic fallbacks', async () => {
  addPlaceSet('set-1', 'Sunrise');
  addPlaceSet('set-2', 'Moonlight');
  exactMisses.set('place:place-set-1', 'NO_VERIFIED_MATCH');
  const calls: string[] = [];
  const delays: number[] = [];

  const report = await reconcileEditorialImages(
    { ...options, apply: true, refresh: true },
    {
      createService: (beforeRequest) => service(beforeRequest, calls),
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
      now: () => 0,
    },
  );

  expect(calls).toStrictEqual(['Sunrise', 'Moonlight']);
  expect(delays).toStrictEqual([1_000]);
  expect(placeUpdates, 'active refresh keeps pins until the replacement is available').toHaveLength(
    0,
  );
  expect(report).toMatchObject({
    genericFallback: 1,
    invalidated: 2,
    mode: 'refresh',
    providerCalls: 2,
    refreshed: 2,
    stopped: null,
  });
});

test('a place-scoped active refresh never fans out to neighbors sharing its image set', async () => {
  addPlaceSet('set-1', 'Sunrise');
  const shared = sets.get('set-1');
  if (!shared) throw new Error('Expected shared image-set fixture.');
  shared.editorialImageForPlaces.push({
    ...shared.editorialImageForPlaces[0]!,
    id: 'place-neighbor',
    providerLabel: 'Moonlight',
    providerRefs: [
      { ...shared.editorialImageForPlaces[0]!.providerRefs[0]!, cachedName: 'Moonlight' },
    ],
  });
  const calls: string[] = [];

  const report = await reconcileEditorialImages(
    { ...options, apply: true, placeId: 'place-set-1', refresh: true },
    { createService: (beforeRequest) => service(beforeRequest, calls) },
  );

  expect(calls).toStrictEqual(['Sunrise']);
  expect(report).toMatchObject({ providerCalls: 1, refreshed: 1 });
});

test('active refresh stops at its outbound-call ceiling and returns a resume cursor', async () => {
  addPlaceSet('set-1', 'Sunrise');
  addPlaceSet('set-2', 'Moonlight');
  const calls: string[] = [];

  const report = await reconcileEditorialImages(
    { ...options, apply: true, maxProviderCalls: 1, refresh: true },
    { createService: (beforeRequest) => service(beforeRequest, calls), now: () => 0 },
  );

  expect(calls).toStrictEqual(['Sunrise']);
  expect(report).toMatchObject({
    failed: 1,
    nextCursor: 'set-1',
    providerCalls: 1,
    refreshed: 1,
    stopped: 'rate_limited',
  });
});

test('an unavailable provider stops active refresh without unpinning every set', async () => {
  addPlaceSet('set-1', 'Sunrise');

  const report = await reconcileEditorialImages(
    { ...options, apply: true, refresh: true },
    {
      createService: (beforeRequest) =>
        new EditorialImagesService({
          name: 'pexels',
          async search() {
            await beforeRequest();
            throw new EditorialImageProviderError('provider_unavailable');
          },
        }),
    },
  );

  expect(report).toMatchObject({ failed: 1, providerCalls: 1, stopped: 'provider_unavailable' });
  expect(placeUpdates).toHaveLength(0);
});

test('active refresh fails closed when editorial imagery is disabled', async () => {
  addPlaceSet('set-1', 'Sunrise');

  await expect(
    reconcileEditorialImages(
      { ...options, apply: true, refresh: true },
      { createService: () => null },
    ),
  ).rejects.toThrow('disabled');
  expect(imageSetUpdates).toHaveLength(0);
});
