import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const getSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));

const {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  primaryEditorialImage,
  readCachedEditorialImages,
  resetEditorialImageCache,
  resolveEditorialImages,
} = await import('../lib/media/editorial-images.ts');

const attribution = {
  photographerName: 'Ada Rivera',
  photographerUrl: 'https://provider.example/ada',
  providerName: 'pexels',
  providerPageUrl: 'https://provider.example/photo/1',
};

function image(subjectKey: string, count = 1, matchKind: 'exact' | 'generic' = 'exact') {
  return {
    images: Array.from({ length: count }, (_, index) => {
      const externalPhotoId = String(index + 1);
      return {
        altText: null,
        attribution,
        dominantColor: '#2f4858',
        externalPhotoId,
        height: 800,
        sourceUrl: `https://images.example/${externalPhotoId}/original.jpg`,
        width: 1200,
      };
    }),
    matchKind,
    status: 'ok' as const,
    subjectKey,
  };
}

function respond(images: unknown[]) {
  return { json: async () => ({ images }), ok: true, status: 200 };
}

/** The mocks are typed by what this module actually sends: a JSON string body. */
type FetchCall = [input: string, init: { body: string }];

function sentSubjects(calls: FetchCall[]) {
  return calls.map((call) => (JSON.parse(call[1].body) as { subjects: unknown[] }).subjects);
}

beforeEach(() => {
  resetEditorialImageCache();
  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the subject key normalises the ways one destination gets spelled', () => {
  expect(editorialSubjectKey({ name: '  Kyōto  ' })).toBe(editorialSubjectKey({ name: 'kyoto' }));
  expect(editorialSubjectKey({ name: 'San   José' })).toBe('destination:san jose');
  expect(editorialSubjectKey({ category: 'stay', name: 'Central' })).toBe('stay:central');
  expect(editorialSubjectKey({ category: 'stay', name: 'Central' })).not.toBe(
    editorialSubjectKey({ category: 'transport', name: 'Central' }),
  );
  expect(editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'PLACE-A' })).toBe(
    'place:place-a',
  );
  expect(editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'place-a' })).not.toBe(
    editorialSubjectKey({ category: 'stay', name: 'Central', placeId: 'place-b' }),
  );
});

test('the first collection image is the stable representative for non-gallery surfaces', () => {
  const first = image('destination:lisbon').images[0]!;
  const second = { ...first, externalPhotoId: '2' };

  expect(primaryEditorialImage([first, second])).toBe(first);
  expect(primaryEditorialImage([])).toBeNull();
});

test('a screen asks for each distinct subject once', async () => {
  const fetchMock = vi.fn(async (..._call: FetchCall) => respond([image('destination:lisbon')]));
  vi.stubGlobal('fetch', fetchMock);

  const resolved = await resolveEditorialImages([
    { name: 'Lisbon', tripId: 'a' },
    { name: 'lisbon', tripId: 'b' },
    { name: '   ' },
  ]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sentSubjects(fetchMock.mock.calls)[0]).toHaveLength(1);
  expect(resolved.get('destination:lisbon')?.[0]?.attribution).toStrictEqual(attribution);
});

test('same-name places are requested separately while repeat canonical IDs are deduplicated', async () => {
  const fetchMock = vi.fn(async (..._call: FetchCall) =>
    respond([image('place:place-a'), image('place:place-b')]),
  );
  vi.stubGlobal('fetch', fetchMock);

  const resolved = await resolveEditorialImages([
    { category: 'stay', name: 'Central', placeId: 'place-a' },
    { category: 'stay', name: 'Central Hotel', placeId: 'place-a' },
    { category: 'stay', name: 'Central', placeId: 'place-b' },
  ]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sentSubjects(fetchMock.mock.calls)[0]).toHaveLength(2);
  expect([...resolved.keys()]).toStrictEqual(['place:place-a', 'place:place-b']);
});

test('an ordered collection already given this session is never asked for again', async () => {
  const fetchMock = vi.fn(async () => respond([image('destination:lisbon', 3)]));
  vi.stubGlobal('fetch', fetchMock);

  await resolveEditorialImages([{ name: 'Lisbon' }]);
  const resolved = await resolveEditorialImages([{ name: 'Lisbon' }]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(resolved.get('destination:lisbon')?.map((item) => item.externalPhotoId)).toStrictEqual([
    '1',
    '2',
    '3',
  ]);
  expect(
    readCachedEditorialImages([{ name: 'Lisbon' }])
      .get('destination:lisbon')
      ?.map((item) => item.externalPhotoId),
  ).toStrictEqual(['1', '2', '3']);
});

test('generic provenance survives browser caching and never exposes multiple representative photos', async () => {
  const fetchMock = vi.fn(async () => respond([image('place:place-a', 3, 'generic')]));
  vi.stubGlobal('fetch', fetchMock);

  const first = await resolveEditorialImages([{ name: 'Central', placeId: 'place-a' }]);
  const second = await resolveEditorialImages([{ name: 'Central', placeId: 'place-a' }]);

  expect(first.get('place:place-a')).toHaveLength(1);
  expect(first.get('place:place-a')?.[0]?.matchKind).toBe('generic');
  expect(second.get('place:place-a')?.[0]?.matchKind).toBe('generic');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('verified image collections retain their explicit exact provenance', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond([image('destination:lisbon', 3)])),
  );

  const resolved = await resolveEditorialImages([{ name: 'Lisbon' }]);

  expect(resolved.get('destination:lisbon')?.map((reference) => reference.matchKind)).toStrictEqual(
    ['exact', 'exact', 'exact'],
  );
});

test('a screen asking for too much is capped, never split into a fan-out', async () => {
  const fetchMock = vi.fn(async (..._call: FetchCall) => respond([]));
  vi.stubGlobal('fetch', fetchMock);

  await resolveEditorialImages(
    Array.from({ length: MAX_EDITORIAL_IMAGE_SUBJECTS + 3 }, (_, index) => ({
      name: `City ${index}`,
    })),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [only] = sentSubjects(fetchMock.mock.calls);
  expect(only).toHaveLength(MAX_EDITORIAL_IMAGE_SUBJECTS);
});

test('the kill switch reads as an absence of photography, not as an error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 204 })),
  );

  await expect(resolveEditorialImages([{ name: 'Lisbon' }])).resolves.toStrictEqual(new Map());
});

test('a failing service, a signed-out traveller and a dead network all resolve to nothing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({}), ok: false, status: 503 })),
  );
  await expect(resolveEditorialImages([{ name: 'Lisbon' }])).resolves.toStrictEqual(new Map());

  getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(resolveEditorialImages([{ name: 'Porto' }])).resolves.toStrictEqual(new Map());

  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  await expect(resolveEditorialImages([{ name: 'Faro' }])).resolves.toStrictEqual(new Map());
});

test('an outage is retried later, while a definitive absence is remembered', async () => {
  const unavailable = vi.fn(async () =>
    respond([
      { code: 'provider_unavailable', status: 'unavailable', subjectKey: 'destination:oslo' },
    ]),
  );
  vi.stubGlobal('fetch', unavailable);
  await resolveEditorialImages([{ name: 'Oslo' }]);
  await resolveEditorialImages([{ name: 'Oslo' }]);
  expect(unavailable).toHaveBeenCalledTimes(2);

  const empty = vi.fn(async () => respond([{ status: 'empty', subjectKey: 'destination:bergen' }]));
  vi.stubGlobal('fetch', empty);
  await resolveEditorialImages([{ name: 'Bergen' }]);
  await resolveEditorialImages([{ name: 'Bergen' }]);
  expect(empty).toHaveBeenCalledTimes(1);
});
