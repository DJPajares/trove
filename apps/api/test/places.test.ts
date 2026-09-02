import Fastify from 'fastify';
import { expect, test } from 'vitest';

import { createPlacesControllers } from '../src/controllers/places.js';
import { getPlacesEnvironment } from '../src/environment.js';
import {
  GOOGLE_AUTOCOMPLETE_FIELD_MASK,
  GOOGLE_PLACE_LOCATION_FIELD_MASK,
  GOOGLE_TEXT_SEARCH_FIELD_MASK,
  GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK,
  GooglePlacesProvider,
} from '../src/services/google-places.js';
import { categorizePlaceTypes } from '../src/services/place-categories.js';
import { PlaceProviderError, PlacesService, type PlacesProvider } from '../src/services/places.js';

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
    },
  });
  expect(results[1]?.evidence).toEqual({ rating: null, openingPeriods: [] });
  for (const field of ['*', 'photos', 'reviews', 'websiteUri'])
    expect(GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK).not.toContain(field);
});

test('reads the Google API key only from server environment', () => {
  expect(getPlacesEnvironment({ GOOGLE_PLACES_API_KEY: ' secret ' })).toStrictEqual({
    googlePlacesApiKey: 'secret',
  });
  expect(getPlacesEnvironment({})).toBe(null);
});

test('evidence Details accepts hours and ratings without unrequested name or location fields', async () => {
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    fetcher: async () =>
      Response.json({
        id: 'museum',
        rating: 4.2,
        utcOffsetMinutes: 480,
        regularOpeningHours: { periods: [{ open: {} }] },
      }),
  });
  const details = await provider.getDetails({ detail: 'evidence', externalPlaceId: 'museum' });
  expect(details).toMatchObject({
    rating: 4.2,
    utcOffsetMinutes: 480,
    name: '',
    location: null,
    openingPeriods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
  });
  await expect(
    provider.getDetails({ detail: 'location', externalPlaceId: 'museum' }),
  ).rejects.toThrow('provider_unavailable');
});

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
