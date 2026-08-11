import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { createPlacesControllers } from '../src/controllers/places.js';
import { getPlacesEnvironment } from '../src/environment.js';
import {
  GOOGLE_AUTOCOMPLETE_FIELD_MASK,
  GOOGLE_PLACE_DETAILS_FIELD_MASK,
  GooglePlacesProvider,
} from '../src/services/google-places.js';
import { categorizePlaceTypes } from '../src/services/place-categories.js';
import { PlaceProviderError, PlacesService, type PlacesProvider } from '../src/services/places.js';

test('maps provider types into the stable Trove taxonomy', () => {
  assert.equal(categorizePlaceTypes(['point_of_interest', 'museum']), 'things_to_do');
  assert.equal(categorizePlaceTypes(['store'], 'coffee_shop'), 'food_and_drink');
  assert.equal(categorizePlaceTypes(['airport', 'establishment']), 'transport');
  assert.equal(categorizePlaceTypes(['establishment']), 'other');
});

test('reads the Google API key only from server environment', () => {
  assert.deepEqual(getPlacesEnvironment({ GOOGLE_PLACES_API_KEY: ' secret ' }), {
    googlePlacesApiKey: 'secret',
  });
  assert.equal(getPlacesEnvironment({}), null);
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

  assert.equal(capturedUrl, 'https://places.googleapis.com/v1/places:autocomplete');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(headers.get('X-Goog-Api-Key'), 'server-key');
  assert.equal(headers.get('X-Goog-FieldMask'), GOOGLE_AUTOCOMPLETE_FIELD_MASK);
  assert.equal(headers.get('X-Goog-FieldMask')?.includes('*'), false);
  assert.deepEqual(requestBody, {
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
  assert.deepEqual(suggestions, [
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

test('Google details concludes the session and returns live photo references with attribution', async () => {
  let capturedUrl = '';
  let capturedHeaders = new Headers();
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);

      return Response.json({
        displayName: { text: 'Trove Hotel' },
        formattedAddress: '1 Example Street, Singapore',
        googleMapsUri: 'https://maps.google.com/?cid=123',
        id: 'ChIJhotel',
        location: { latitude: 1.3, longitude: 103.8 },
        photos: [
          {
            authorAttributions: [
              {
                displayName: 'Example Contributor',
                photoUri: 'https://example.com/photo',
                uri: 'https://example.com/contributor',
              },
            ],
            heightPx: 1_200,
            name: 'places/ChIJhotel/photos/photo_reference',
            widthPx: 1_600,
          },
        ],
        primaryType: 'hotel',
        types: ['hotel', 'lodging', 'establishment'],
      });
    },
  });

  const place = await provider.getDetails({
    externalPlaceId: 'ChIJhotel',
    languageCode: 'en',
    regionCode: 'sg',
    sessionToken: 'session-token',
  });
  const url = new URL(capturedUrl);

  assert.equal(url.pathname, '/v1/places/ChIJhotel');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    languageCode: 'en',
    regionCode: 'sg',
    sessionToken: 'session-token',
  });
  assert.equal(capturedHeaders.get('X-Goog-FieldMask'), GOOGLE_PLACE_DETAILS_FIELD_MASK);
  assert.equal(capturedHeaders.get('X-Goog-FieldMask')?.includes('*'), false);
  assert.equal(place.category, 'stay');
  assert.deepEqual(place.rawTypes, ['hotel', 'lodging', 'establishment']);
  assert.deepEqual(place.photos, [
    {
      authorAttributions: [
        {
          displayName: 'Example Contributor',
          photoUri: 'https://example.com/photo',
          uri: 'https://example.com/contributor',
        },
      ],
      heightPx: 1_200,
      name: 'places/ChIJhotel/photos/photo_reference',
      widthPx: 1_600,
    },
  ]);
});

test('Google photo resolution requests a current reference without caching the media', async () => {
  let capturedUrl = '';
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (input) => {
      capturedUrl = String(input);
      return Response.json({
        name: 'places/ChIJhotel/photos/photo_reference/media',
        photoUri: 'https://lh3.googleusercontent.com/example=s1200',
      });
    },
  });

  const photo = await provider.resolvePhoto({
    maxWidthPx: 1_200,
    name: 'places/ChIJhotel/photos/photo_reference',
  });
  const url = new URL(capturedUrl);

  assert.equal(url.pathname, '/v1/places/ChIJhotel/photos/photo_reference/media');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    maxWidthPx: '1200',
    skipHttpRedirect: 'true',
  });
  assert.deepEqual(photo, {
    name: 'places/ChIJhotel/photos/photo_reference/media',
    uri: 'https://lh3.googleusercontent.com/example=s1200',
  });
});

test('PlacesService creates reusable session tokens and reports freshness for empty results', async () => {
  let capturedToken = '';
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      throw new PlaceProviderError('not_found');
    },
    resolvePhoto: async () => {
      throw new PlaceProviderError('not_found');
    },
    search: async (request) => {
      capturedToken = request.sessionToken;
      return [];
    },
  };
  const service = new PlacesService(provider, () => new Date('2026-08-11T08:00:00.000Z'));

  const search = await service.search({ input: 'No result' });
  const details = await service.getDetails({ externalPlaceId: 'missing' });

  assert.match(
    capturedToken,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(search, {
    freshness: { fetchedAt: '2026-08-11T08:00:00.000Z', source: 'live' },
    provider: 'google',
    sessionToken: capturedToken,
    status: 'empty',
    suggestions: [],
  });
  assert.deepEqual(details, { provider: 'google', status: 'empty' });
});

test('PlacesService translates provider quota failures into a graceful unavailable result', async () => {
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
    resolvePhoto: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
    search: async () => {
      throw new PlaceProviderError('quota_exceeded');
    },
  };
  const service = new PlacesService(provider);

  assert.deepEqual(await service.getDetails({ externalPlaceId: 'ChIJquota' }), {
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

  await assert.rejects(
    provider.search({ input: 'Museum', sessionToken: 'session-token' }),
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
    resolvePhoto: async () => {
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

  assert.equal(invalidResponse.statusCode, 400);
  assert.deepEqual(invalidResponse.json(), { code: 'invalid_place_search_request' });
  assert.equal(unavailableResponse.statusCode, 503);
  assert.deepEqual(unavailableResponse.json(), {
    code: 'quota_exceeded',
    provider: 'google',
    sessionToken: 'session-token',
    status: 'unavailable',
  });

  await app.close();
});
