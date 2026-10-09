import Fastify from 'fastify';
import { expect, test, vi } from 'vitest';

import { createPlacesControllers } from '../src/controllers/places.js';
import { getGooglePlacePhotoLimit, getPlacesEnvironment } from '../src/environment.js';
import {
  GOOGLE_AUTOCOMPLETE_FIELD_MASK,
  GOOGLE_PLACE_LOCATION_FIELD_MASK,
  GOOGLE_TEXT_SEARCH_FIELD_MASK,
  GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK,
  GooglePlacesProvider,
} from '../src/services/google-places.js';
import { categorizePlaceTypes } from '../src/services/place-categories.js';
import {
  PlaceProviderError,
  PlacesService,
  placePhotoId,
  type PlacesProvider,
} from '../src/services/places.js';
import { storePlaceEvidence } from '../src/services/place-evidence-cache.js';
import { requireAuthenticatedUser } from '../src/services/request-auth.js';

test('maps provider types into the stable Trove taxonomy', () => {
  expect(categorizePlaceTypes(['point_of_interest', 'museum'])).toBe('things_to_do');
  expect(categorizePlaceTypes(['store'], 'coffee_shop')).toBe('food_and_drink');
  expect(categorizePlaceTypes(['airport', 'establishment'])).toBe('transport');
  expect(categorizePlaceTypes(['establishment'])).toBe('other');
});

test('Google Text Search requests five identity results with attribution', async () => {
  let capturedInit: RequestInit | undefined;
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (_input, init) => {
      capturedInit = init;
      return Response.json({
        places: [
          {
            attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
            displayName: { text: 'National Museum' },
            formattedAddress: '93 Stamford Road, Singapore 178897',
            googleMapsUri: 'https://maps.google.com/?cid=1',
            id: 'ChIJmuseum',
            location: { latitude: 1.2966, longitude: 103.8485 },
            primaryType: 'museum',
            types: ['museum'],
            utcOffsetMinutes: 480,
          },
          { displayName: { text: 'Missing coordinates' }, id: 'ChIJinvalid' },
        ],
      });
    },
  });

  const places = await provider.textSearch({
    detail: 'location',
    languageCode: 'en',
    regionCode: 'sg',
    textQuery: 'National Museum Singapore',
  });
  const headers = new Headers(capturedInit?.headers);
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;

  expect(body).toStrictEqual({
    languageCode: 'en',
    pageSize: 5,
    regionCode: 'sg',
    textQuery: 'National Museum Singapore',
  });
  expect(headers.get('X-Goog-FieldMask')).toBe(GOOGLE_TEXT_SEARCH_FIELD_MASK);
  expect(GOOGLE_TEXT_SEARCH_FIELD_MASK).not.toContain('*');
  for (const mutableField of ['rating', 'regularOpeningHours', 'photos', 'websiteUri']) {
    expect(GOOGLE_TEXT_SEARCH_FIELD_MASK).not.toContain(mutableField);
  }
  expect(places).toStrictEqual([
    {
      attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
      category: 'things_to_do',
      externalPlaceId: 'ChIJmuseum',
      formattedAddress: '93 Stamford Road, Singapore 178897',
      googleMapsUri: 'https://maps.google.com/?cid=1',
      location: { latitude: 1.2966, longitude: 103.8485 },
      name: 'National Museum',
      primaryType: 'museum',
      provider: 'google',
      rawTypes: ['museum'],
      utcOffsetMinutes: 480,
    },
  ]);
});

test('enriched Text Search returns scoring evidence and distinguishes missing fields from unrequested fields', async () => {
  let calls = 0;
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    fetcher: async (_input, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('X-Goog-FieldMask')).toBe(
        GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK,
      );
      expect(JSON.parse(String(init?.body)).pageSize).toBe(5);
      return Response.json({
        places: [
          {
            id: 'with-evidence',
            displayName: { text: 'Museum' },
            location: { latitude: 1, longitude: 103 },
            attributions: [{ provider: 'Data', providerUri: 'https://example.com' }],
            rating: 4.7,
            utcOffsetMinutes: 480,
            regularOpeningHours: { periods: [{ open: {} }] },
            currentOpeningHours: {
              periods: [
                {
                  open: { date: { year: 2026, month: 10, day: 3 }, day: 6, hour: 10, minute: 0 },
                  close: { date: { year: 2026, month: 10, day: 3 }, day: 6, hour: 16, minute: 0 },
                },
              ],
            },
          },
          {
            id: 'missing-evidence',
            displayName: { text: 'Park' },
            location: { latitude: 1, longitude: 103 },
          },
        ],
      });
    },
  });
  const results = await provider.textSearch({ detail: 'evidence', textQuery: 'Museum' });
  expect(calls).toBe(1);
  expect(results[0]).toMatchObject({
    attributions: [{ provider: 'Data', providerUri: 'https://example.com' }],
    utcOffsetMinutes: 480,
    evidence: {
      rating: 4.7,
      openingPeriods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
      currentOpeningPeriods: [
        {
          open: { date: '2026-10-03', day: 6, hour: 10, minute: 0 },
          close: { date: '2026-10-03', day: 6, hour: 16, minute: 0 },
        },
      ],
      currentHoursValidFrom: '2026-10-03',
      currentHoursValidThrough: '2026-10-03',
    },
  });
  for (const field of [
    'currentOpeningHours',
    'photos',
    'websiteUri',
    'internationalPhoneNumber',
    'priceLevel',
  ])
    expect(GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK).toContain(`places.${field}`);
  expect(results[1]?.evidence).toEqual({
    photos: [],
    websiteUri: null,
    internationalPhoneNumber: null,
    priceLevel: null,
    rating: null,
    currentOpeningPeriods: [],
    currentHoursValidFrom: null,
    currentHoursValidThrough: null,
    openingPeriods: [],
    userRatingCount: null,
    openingHoursDescriptions: [],
  });
  for (const field of ['*', 'reviews', 'editorialSummary'])
    expect(GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK).not.toContain(field);
});

test('reads the Google API key only from server environment', () => {
  expect(getPlacesEnvironment({ GOOGLE_PLACES_API_KEY: ' secret ' })).toStrictEqual({
    googlePlacesApiKey: 'secret',
    googlePlacePhotoLimit: 3,
  });
  expect(getPlacesEnvironment({})).toBe(null);
});

test('photo limits default to three, accept zero through three, and fail closed with one warning', () => {
  for (const value of [undefined, '', '  ']) {
    expect(getGooglePlacePhotoLimit({ GOOGLE_PLACE_PHOTO_LIMIT: value })).toBe(3);
  }
  for (const limit of [0, 1, 2, 3]) {
    expect(getGooglePlacePhotoLimit({ GOOGLE_PLACE_PHOTO_LIMIT: ` ${limit} ` })).toBe(limit);
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    for (const value of ['-1', '4', '1.5', 'NaN', 'Infinity', 'false', 'invalid']) {
      expect(
        getPlacesEnvironment({
          GOOGLE_PLACES_API_KEY: 'key',
          GOOGLE_PLACE_PHOTO_LIMIT: value,
        }),
      ).toEqual({ googlePlacesApiKey: 'key', googlePlacePhotoLimit: 0 });
    }
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_PLACE_PHOTO_LIMIT'));
  } finally {
    warning.mockRestore();
  }
});

test('evidence Details accepts hours and ratings without unrequested name or location fields', async () => {
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    fetcher: async () =>
      Response.json({
        id: 'museum',
        rating: 4.2,
        userRatingCount: 845,
        utcOffsetMinutes: 480,
        regularOpeningHours: {
          periods: [{ open: {} }],
          weekdayDescriptions: ['Monday: Open 24 hours'],
        },
        currentOpeningHours: {
          periods: [
            {
              open: { day: 1, hour: 10, date: { year: 2026, month: 9, day: 28 } },
              close: { day: 1, hour: 16, date: { year: 2026, month: 9, day: 28 } },
            },
          ],
        },
      }),
  });
  const details = await provider.getDetails({ detail: 'evidence', externalPlaceId: 'museum' });
  expect(details).toMatchObject({
    rating: 4.2,
    userRatingCount: 845,
    utcOffsetMinutes: 480,
    name: '',
    location: null,
    openingPeriods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
    openingHoursDescriptions: ['Monday: Open 24 hours'],
    currentHoursValidFrom: '2026-09-28',
    currentHoursValidThrough: '2026-09-28',
    currentOpeningPeriods: [
      {
        open: { day: 1, hour: 10, minute: 0, date: '2026-09-28' },
        close: { day: 1, hour: 16, minute: 0, date: '2026-09-28' },
      },
    ],
  });
  await expect(
    provider.getDetails({ detail: 'location', externalPlaceId: 'museum' }),
  ).rejects.toThrow('provider_unavailable');
});

test('evidence Details keeps three photos, contact links and price level; location asks for none', async () => {
  const photo = (index: number) => ({
    name: `places/museum/photos/p${index}`,
    widthPx: 4032,
    heightPx: 3024,
    authorAttributions: [
      { displayName: `Author ${index}`, uri: `https://maps.google.com/contrib/${index}` },
    ],
  });
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    fetcher: async () =>
      Response.json({
        id: 'museum',
        displayName: { text: 'National Museum' },
        location: { latitude: 1.2966, longitude: 103.8485 },
        photos: [
          photo(1),
          { name: '../../elsewhere', widthPx: 10, heightPx: 10 },
          photo(2),
          photo(3),
          photo(4),
          photo(5),
        ],
        websiteUri: 'http://museum.example/',
        internationalPhoneNumber: ' +65 6332 3659 ',
        priceLevel: 'PRICE_LEVEL_MODERATE',
      }),
  });

  const evidence = await provider.getDetails({ detail: 'evidence', externalPlaceId: 'museum' });
  expect(evidence.photos).toStrictEqual([
    {
      authorAttributions: [{ displayName: 'Author 1', uri: 'https://maps.google.com/contrib/1' }],
      heightPx: 3024,
      name: 'places/museum/photos/p1',
      uri: null,
      widthPx: 4032,
    },
    expect.objectContaining({ name: 'places/museum/photos/p2' }),
    expect.objectContaining({ name: 'places/museum/photos/p3' }),
  ]);
  expect(evidence).toMatchObject({
    internationalPhoneNumber: '+65 6332 3659',
    priceLevel: 2,
    websiteUri: 'http://museum.example/',
  });

  // A location answer leaves them absent, so it never passes for a place
  // that was asked for photos and had none.
  const location = await provider.getDetails({ detail: 'location', externalPlaceId: 'museum' });
  expect(location.photos).toBeUndefined();
  expect(location.websiteUri).toBeUndefined();
});

test('a photo is resolved to a Google image URL and nothing else', async () => {
  const requested: string[] = [];
  let photoUri: string = 'https://lh3.googleusercontent.com/place-photos/abc=s1200';
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    fetcher: async (input) => {
      requested.push(String(input));
      return Response.json({ name: 'places/museum/photos/p1/media', photoUri });
    },
  });
  const request = { maxWidthPx: 1200, name: 'places/museum/photos/p1', photoIndex: 0 };

  await expect(provider.getPhotoMedia(request)).resolves.toBe(photoUri);
  const url = new URL(requested[0] ?? '');
  expect(url.pathname).toBe('/v1/places/museum/photos/p1/media');
  expect(url.searchParams.get('maxWidthPx')).toBe('1200');
  expect(url.searchParams.get('skipHttpRedirect')).toBe('true');
  expect(url.searchParams.has('key')).toBe(false);

  for (const unsafe of [
    'http://lh3.googleusercontent.com/place-photos/abc',
    'https://evil.example/googleusercontent.com/abc',
    'javascript:alert(1)',
  ]) {
    photoUri = unsafe;
    await expect(provider.getPhotoMedia(request), unsafe).rejects.toThrow('provider_unavailable');
  }

  const before = requested.length;
  await expect(
    provider.getPhotoMedia({
      maxWidthPx: 1200,
      name: 'places/museum/../../v1/places:searchText',
      photoIndex: 0,
    }),
  ).rejects.toThrow('invalid_request');
  expect(requested).toHaveLength(before);
});

test.each([0, 1, 2, 3])(
  'the Google media boundary enforces limit %i before fetching',
  async (photoLimit) => {
    const fetcher = vi.fn(async () =>
      Response.json({ photoUri: 'https://lh3.googleusercontent.com/photo' }),
    );
    const provider = new GooglePlacesProvider({ apiKey: 'key', fetcher, photoLimit });
    for (const photoIndex of [0, 1, 2, 3, -1, NaN, 0.5, undefined as unknown as number]) {
      const result = provider.getPhotoMedia({
        name: 'places/museum/photos/p1',
        maxWidthPx: 1200,
        photoIndex,
      });
      if (Number.isInteger(photoIndex) && photoIndex >= 0 && photoIndex < photoLimit) {
        await expect(result).resolves.toBe('https://lh3.googleusercontent.com/photo');
      } else {
        await expect(result).rejects.toThrow('provider_unavailable');
      }
    }
    expect(fetcher).toHaveBeenCalledTimes(photoLimit);
  },
);

test('Google search uses location bias, a session token, and an explicit field mask', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;

      return Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJmuseum',
              structuredFormat: {
                mainText: { text: 'National Museum' },
                secondaryText: { text: 'Singapore' },
              },
              text: { text: 'National Museum, Singapore' },
              types: ['museum', 'point_of_interest'],
            },
          },
        ],
      });
    },
  });

  const suggestions = await provider.search({
    input: 'National Museum',
    languageCode: 'en',
    locationBias: { latitude: 1.3521, longitude: 103.8198, radiusMeters: 25_000 },
    regionCode: 'sg',
    sessionToken: 'b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0',
  });
  const headers = new Headers(capturedInit?.headers);
  const requestBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;

  expect(capturedUrl).toBe('https://places.googleapis.com/v1/places:autocomplete');
  expect(capturedInit?.method).toBe('POST');
  expect(headers.get('X-Goog-Api-Key')).toBe('server-key');
  expect(headers.get('X-Goog-FieldMask')).toBe(GOOGLE_AUTOCOMPLETE_FIELD_MASK);
  expect(headers.get('X-Goog-FieldMask')?.includes('*')).toBe(false);
  expect(requestBody).toStrictEqual({
    input: 'National Museum',
    languageCode: 'en',
    locationBias: {
      circle: {
        center: { latitude: 1.3521, longitude: 103.8198 },
        radius: 25_000,
      },
    },
    regionCode: 'sg',
    sessionToken: 'b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0',
  });
  expect(suggestions).toStrictEqual([
    {
      category: 'things_to_do',
      description: 'Singapore',
      externalPlaceId: 'ChIJmuseum',
      fullText: 'National Museum, Singapore',
      name: 'National Museum',
      provider: 'google',
      rawTypes: ['museum', 'point_of_interest'],
    },
  ]);
});

test('Google details concludes the session and asks only for what Trove stores', async () => {
  let capturedUrl = '';
  let capturedHeaders = new Headers();
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);

      return Response.json({
        attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
        displayName: { text: 'Trove Hotel' },
        formattedAddress: '1 Example Street, Singapore',
        googleMapsUri: 'https://maps.google.com/?cid=123',
        id: 'ChIJhotel',
        location: { latitude: 1.3, longitude: 103.8 },
        primaryType: 'hotel',
        types: ['hotel', 'lodging', 'establishment'],
      });
    },
  });

  const place = await provider.getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJhotel',
    languageCode: 'en',
    regionCode: 'sg',
    sessionToken: 'session-token',
  });
  const url = new URL(capturedUrl);

  expect(url.pathname).toBe('/v1/places/ChIJhotel');
  expect(Object.fromEntries(url.searchParams)).toStrictEqual({
    languageCode: 'en',
    regionCode: 'sg',
    sessionToken: 'session-token',
  });
  expect(capturedHeaders.get('X-Goog-FieldMask')).toBe(GOOGLE_PLACE_LOCATION_FIELD_MASK);
  expect(capturedHeaders.get('X-Goog-FieldMask')?.includes('*')).toBe(false);
  expect(place.category).toBe('stay');
  expect(place.rawTypes).toStrictEqual(['hotel', 'lodging', 'establishment']);
  expect(place.name).toBe('Trove Hotel');
  expect(place.location).toStrictEqual({ latitude: 1.3, longitude: 103.8 });
  expect(place.attributions).toStrictEqual([
    { provider: 'Example Data', providerUri: 'https://example.com/source' },
  ]);
});

test('a geocoded address with no displayName falls back to its formatted address as the name', async () => {
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        formattedAddress: '5 Quiet Lane, Wellington 6021',
        id: 'ChIJaddress',
        location: { latitude: -41.29, longitude: 174.78 },
        types: ['street_address'],
      }),
  });

  const place = await provider.getDetails({ detail: 'location', externalPlaceId: 'ChIJaddress' });

  expect(place.name).toBe('5 Quiet Lane, Wellington 6021');
  expect(place.formattedAddress).toBe('5 Quiet Lane, Wellington 6021');
});

test('a place with neither a displayName nor a formatted address is unresolvable', async () => {
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async () => Response.json({ id: 'ChIJbare' }),
  });

  await expect(
    provider.getDetails({ detail: 'location', externalPlaceId: 'ChIJbare' }),
  ).rejects.toThrow(new PlaceProviderError('provider_unavailable'));
});

async function detailsFrom(body: Record<string, unknown>) {
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json({
        displayName: { text: 'Trove Museum' },
        id: 'ChIJmuseum',
        ...body,
      }),
  });

  return provider.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
}

test('opening periods survive the zero values proto3 omits from the wire', async () => {
  // Sunday is day 0, midnight is hour 0, and anything opening on the hour has
  // minute 0. Requiring those fields to be present would discard the period.
  const place = await detailsFrom({
    regularOpeningHours: {
      periods: [
        { close: { day: 1, hour: 17 }, open: { day: 1, hour: 9 } },
        { close: { hour: 18 }, open: {} },
      ],
    },
    utcOffsetMinutes: 480,
  });

  expect(place.openingPeriods).toStrictEqual([
    { close: { day: 1, hour: 17, minute: 0 }, open: { day: 1, hour: 9, minute: 0 } },
    { close: { day: 0, hour: 18, minute: 0 }, open: { day: 0, hour: 0, minute: 0 } },
  ]);
  expect(place.utcOffsetMinutes).toBe(480);
});

test('an open point with no close is kept as an always-open period', async () => {
  const place = await detailsFrom({
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] },
  });

  expect(place.openingPeriods).toStrictEqual([
    { close: null, open: { day: 0, hour: 0, minute: 0 } },
  ]);
});

test('out-of-range and unopenable periods are dropped, not corrected', async () => {
  const place = await detailsFrom({
    regularOpeningHours: {
      periods: [
        { close: { day: 7, hour: 17, minute: 0 }, open: { day: 7, hour: 9, minute: 0 } },
        { close: { day: 1, hour: 17, minute: 0 }, open: { day: 1, hour: 24, minute: 0 } },
        { close: { day: 1, hour: 17, minute: 60 }, open: { day: 1, hour: 9, minute: 0 } },
        { close: { day: 2, hour: 17, minute: 0 } },
        { close: { day: 3, hour: 17, minute: 0 }, open: { day: 3, hour: 9, minute: 0 } },
      ],
    },
  });

  expect(place.openingPeriods).toStrictEqual([
    { close: { day: 3, hour: 17, minute: 0 }, open: { day: 3, hour: 9, minute: 0 } },
  ]);
});

test('a place with no hours reports no periods and no offset', async () => {
  const place = await detailsFrom({});

  expect(place.openingPeriods).toStrictEqual([]);
  expect(place.utcOffsetMinutes).toBe(null);
});

test('PlacesService creates reusable session tokens and reports freshness for empty results', async () => {
  let capturedToken = '';
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      throw new PlaceProviderError('not_found');
    },
    search: async (request) => {
      capturedToken = request.sessionToken;
      return [];
    },
  };
  const service = new PlacesService(provider, () => new Date('2026-08-11T08:00:00.000Z'));

  const search = await service.search({ input: 'No result' });
  const details = await service.getDetails({ detail: 'location', externalPlaceId: 'missing' });

  expect(capturedToken).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(search).toStrictEqual({
    freshness: { fetchedAt: '2026-08-11T08:00:00.000Z', source: 'live' },
    provider: 'google',
    sessionToken: capturedToken,
    status: 'empty',
    suggestions: [],
  });
  expect(details).toStrictEqual({ provider: 'google', reason: 'not_found', status: 'empty' });
});

test('PlacesService translates provider quota failures into a graceful unavailable result', async () => {
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
    search: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
  };
  const service = new PlacesService(provider);

  expect(
    await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJquota' }),
  ).toStrictEqual({
    code: 'quota_exceeded',
    provider: 'google',
    status: 'unavailable',
  });
});

test('Google error responses are categorized without leaking provider messages', async () => {
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async () =>
      Response.json(
        { error: { message: 'Sensitive provider detail', status: 'RESOURCE_EXHAUSTED' } },
        { status: 429 },
      ),
  });

  await expect(
    provider.search({ input: 'Museum', sessionToken: 'session-token' }),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof PlaceProviderError &&
      error.code === 'quota_exceeded' &&
      !error.message.includes('Sensitive'),
  );
});

test('Places controllers reject invalid input and degrade provider failures explicitly', async () => {
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      throw new PlaceProviderError('provider_unavailable');
    },
    search: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
  };
  const app = Fastify();
  const controllers = createPlacesControllers(new PlacesService(provider));
  app.post('/places/search', controllers.search);

  const invalidResponse = await app.inject({
    method: 'POST',
    payload: { input: '   ' },
    url: '/places/search',
  });
  const unavailableResponse = await app.inject({
    method: 'POST',
    payload: { input: 'Museum', sessionToken: 'session-token' },
    url: '/places/search',
  });

  expect(invalidResponse.statusCode).toBe(400);
  expect(invalidResponse.json()).toStrictEqual({ code: 'invalid_place_search_request' });
  expect(unavailableResponse.statusCode).toBe(503);
  expect(unavailableResponse.json()).toStrictEqual({
    code: 'quota_exceeded',
    provider: 'google',
    sessionToken: 'session-token',
    status: 'unavailable',
  });

  await app.close();
});

test('rich details require an owned relationship before any provider acquisition', async () => {
  const lookup = vi.fn(
    async (
      _query: unknown,
    ): Promise<{ providerRefs: Array<{ provider: string; externalPlaceId: string }> } | null> =>
      null,
  );
  const details = vi.fn(async () => {
    throw new PlaceProviderError('provider_unavailable');
  });
  vi.stubGlobal('trovePrismaClient', { place: { findFirst: lookup } });
  const app = Fastify();
  app.decorateRequest('authUserId', undefined);
  const controllers = createPlacesControllers(
    new PlacesService({ name: 'google', search: async () => [], getDetails: details }),
  );
  app.get(
    '/places/:placeId/details',
    {
      preHandler: async (request, reply) => {
        if (!request.headers.authorization) return reply.code(401).send({ code: 'unauthorized' });
        request.authUserId = 'owner';
      },
    },
    controllers.richDetails,
  );
  const url = '/places/12345678-1234-4234-8234-123456789012/details?languageCode=ja';
  try {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    expect((await app.inject({ url, headers: { authorization: 'test' } })).statusCode).toBe(404);
    expect(details).not.toHaveBeenCalled();
    expect(lookup.mock.calls[0]?.[0]).toMatchObject({
      where: {
        OR: [
          { ownerId: 'owner' },
          { savedPlaces: { some: { ownerId: 'owner' } } },
          { tripPlaces: { some: { trip: { ownerId: 'owner' } } } },
        ],
      },
    });
    lookup.mockResolvedValueOnce({
      providerRefs: [{ provider: 'GOOGLE', externalPlaceId: 'museum' }],
    });
    expect((await app.inject({ url, headers: { authorization: 'test' } })).json()).toMatchObject({
      status: 'unavailable',
    });
    expect(details).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        externalPlaceId: 'museum',
        detail: 'evidence',
        languageCode: 'ja',
        purpose: 'details',
      }),
    );
  } finally {
    await app.close();
    vi.unstubAllGlobals();
  }
});

test('date-specific hours from a grounded place are stored with the dates they apply to', async () => {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  vi.stubGlobal('trovePrismaClient', { placeProviderRef: { updateMany } });

  try {
    const provider = new GooglePlacesProvider({
      apiKey: 'test-key',
      fetcher: async () =>
        Response.json({
          places: [
            {
              id: 'grounded',
              displayName: { text: 'Temple' },
              location: { latitude: 35, longitude: 135 },
              currentOpeningHours: {
                periods: [
                  {
                    open: { date: { year: 2026, month: 10, day: 3 }, day: 6, hour: 9, minute: 0 },
                    close: { date: { year: 2026, month: 10, day: 3 }, day: 6, hour: 15, minute: 0 },
                  },
                ],
              },
            },
          ],
        }),
    });
    const [found] = await provider.textSearch({ detail: 'evidence', textQuery: 'Temple' });
    if (!found?.evidence) throw new Error('expected evidence');

    await storePlaceEvidence(
      { externalPlaceId: 'grounded' },
      {
        freshness: { fetchedAt: '2026-09-30T00:00:00.000Z', source: 'live' },
        place: { ...found, ...found.evidence, rating: null },
        provider: 'google',
        status: 'ok',
      },
    );

    const stored = (
      updateMany.mock.calls[0] as unknown as [{ data: { cachedEvidence: unknown } }]
    )[0].data.cachedEvidence;
    expect(stored).toMatchObject({
      currentHoursValidFrom: '2026-10-03',
      currentHoursValidThrough: '2026-10-03',
      currentOpeningPeriods: [{ open: { date: '2026-10-03', hour: 9 } }],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

test('opened rich details go through their own service, never the search one', async () => {
  const searchDetails = vi.fn(async () => {
    throw new PlaceProviderError('provider_unavailable');
  });
  const detailsDetails = vi.fn(async () => {
    throw new PlaceProviderError('provider_unavailable');
  });
  vi.stubGlobal('trovePrismaClient', {
    place: {
      findFirst: async () => ({
        providerRefs: [{ provider: 'GOOGLE', externalPlaceId: 'museum' }],
      }),
    },
  });
  const app = Fastify();
  app.decorateRequest('authUserId', undefined);
  const controllers = createPlacesControllers(
    new PlacesService({ name: 'google', search: async () => [], getDetails: searchDetails }),
    undefined,
    null,
    new PlacesService({ name: 'google', search: async () => [], getDetails: detailsDetails }),
  );
  app.get(
    '/places/:placeId/details',
    {
      preHandler: async (request) => {
        request.authUserId = 'owner';
      },
    },
    controllers.richDetails,
  );

  try {
    await app.inject({ url: '/places/12345678-1234-4234-8234-123456789012/details' });
    expect(detailsDetails).toHaveBeenCalledTimes(1);
    expect(searchDetails).not.toHaveBeenCalled();
  } finally {
    await app.close();
    vi.unstubAllGlobals();
  }
});

test('per-photo endpoint validates input and ownership before resolving an image', async () => {
  const placeId = '12345678-1234-4234-8234-123456789012';
  const photoId = placePhotoId('places/museum/photos/p2');
  const evidenceFetchedAt = '2026-10-01T00:00:00.000Z';
  let owned = true;
  const findFirst = vi.fn(async () =>
    owned ? { providerRefs: [{ provider: 'GOOGLE', externalPlaceId: 'museum' }] } : null,
  );
  vi.stubGlobal('trovePrismaClient', { place: { findFirst } });
  const service = new PlacesService({
    name: 'google',
    search: async () => [],
    getDetails: async () => {
      throw new Error('Details must never be called');
    },
  });
  const getPhoto = vi
    .spyOn(service, 'getPhoto')
    .mockResolvedValue({ status: 'ok', uri: 'https://lh3.googleusercontent.com/photo2' });
  const app = Fastify();
  app.decorateRequest('authUserId', undefined);
  app.post(
    '/places/:placeId/photos/:photoId',
    {
      preHandler: async (request, reply) => {
        if (request.headers.authorization) request.authUserId = 'owner';
        else return requireAuthenticatedUser(request, reply);
      },
    },
    createPlacesControllers(null, undefined, null, service).photo,
  );
  const request = {
    method: 'POST' as const,
    url: `/places/${placeId}/photos/${photoId}`,
    payload: { languageCode: 'en', evidenceFetchedAt },
  };
  try {
    expect((await app.inject(request)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          ...request,
          headers: { authorization: 'test' },
          payload: { ...request.payload, name: 'arbitrary-google-photo' },
        })
      ).statusCode,
    ).toBe(400);
    owned = false;
    expect((await app.inject({ ...request, headers: { authorization: 'test' } })).statusCode).toBe(
      404,
    );
    expect(getPhoto).not.toHaveBeenCalled();
    owned = true;
    const response = await app.inject({ ...request, headers: { authorization: 'test' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      uri: 'https://lh3.googleusercontent.com/photo2',
    });
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: placeId,
          OR: [
            { ownerId: 'owner' },
            { savedPlaces: { some: { ownerId: 'owner' } } },
            { tripPlaces: { some: { trip: { ownerId: 'owner' } } } },
          ],
        },
      }),
    );
    expect(getPhoto).toHaveBeenCalledWith({
      externalPlaceId: 'museum',
      photoId,
      languageCode: 'en',
      evidenceFetchedAt,
    });
    getPhoto.mockResolvedValueOnce({ status: 'disabled' });
    const disabled = await app.inject({ ...request, headers: { authorization: 'test' } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ status: 'disabled' });
    getPhoto.mockResolvedValueOnce({ status: 'stale' });
    expect((await app.inject({ ...request, headers: { authorization: 'test' } })).statusCode).toBe(
      409,
    );
  } finally {
    await app.close();
    vi.unstubAllGlobals();
  }
});
