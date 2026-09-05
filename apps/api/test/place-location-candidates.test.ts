import Fastify from 'fastify';
import { afterEach, expect, test } from 'vitest';

import { createPlacesControllers } from '../src/controllers/places.js';
import type { CanonicalPlacesService } from '../src/services/canonical-places.js';
import {
  PlaceLocationCandidatesService,
  resetPlaceLocationCandidatesMemo,
} from '../src/services/place-location-candidates.js';
import {
  PlaceProviderError,
  type PlaceTextSearchProvider,
  type PlaceTextSearchRequest,
  type ProviderPlaceSearchResult,
} from '../src/services/places.js';

const OWNER_ID = '8926bbe8-abae-470c-ab90-f33af1a8d168';
const OWNED_PLACE_ID = '00000000-0000-7000-8000-000000000001';
const OTHER_PLACE_ID = '00000000-0000-7000-8000-000000000002';

afterEach(() => {
  resetPlaceLocationCandidatesMemo();
});

function identity(externalPlaceId: string, name: string): ProviderPlaceSearchResult {
  return {
    attributions: [],
    category: 'things_to_do',
    externalPlaceId,
    formattedAddress: `${name}, Hanoi, Vietnam`,
    googleMapsUri: null,
    location: { latitude: 21.0287, longitude: 105.8524 },
    name,
    primaryType: 'tourist_attraction',
    provider: 'google',
    rawTypes: ['tourist_attraction'],
    utcOffsetMinutes: 420,
  };
}

/** Counts what a lookup costs, which is the only thing worth asserting here. */
function countingProvider(
  answer: () => ProviderPlaceSearchResult[] = () => [identity('ChIJlake', 'Hoan Kiem Lake')],
) {
  const requests: PlaceTextSearchRequest[] = [];
  const provider: PlaceTextSearchProvider = {
    name: 'google',
    async textSearch(request) {
      requests.push(request);
      await Promise.resolve();
      return answer();
    },
  };
  return { provider, requests };
}

test('one lookup costs one Text Search, asked for on the cheap field profile', async () => {
  const { provider, requests } = countingProvider(() => [
    identity('ChIJlake', 'Hoan Kiem Lake'),
    identity('ChIJtemple', 'Ngoc Son Temple'),
  ]);
  const service = new PlaceLocationCandidatesService(provider);

  const result = await service.find({ textQuery: 'Hoan Kiem Lake, Hanoi' });

  expect(requests).toHaveLength(1);
  // `evidence` would add ratings and hours nothing here renders, and move the
  // request onto a costlier Google tier.
  expect(requests[0]?.detail).toBe('location');
  expect(result).toStrictEqual({
    candidates: [
      {
        address: 'Hoan Kiem Lake, Hanoi, Vietnam',
        externalPlaceId: 'ChIJlake',
        latitude: 21.0287,
        longitude: 105.8524,
        name: 'Hoan Kiem Lake',
      },
      {
        address: 'Ngoc Son Temple, Hanoi, Vietnam',
        externalPlaceId: 'ChIJtemple',
        latitude: 21.0287,
        longitude: 105.8524,
        name: 'Ngoc Son Temple',
      },
    ],
    provider: 'google',
    status: 'ok',
  });
});

test('every candidate is offered rather than only an unambiguous one', async () => {
  // Grounding demands exactly one eligible match and gives up otherwise, which is
  // how these places arrived unlocated. A person can settle it, so ambiguity is
  // shown here rather than treated as a failure.
  const { provider } = countingProvider(() => [
    identity('ChIJone', 'Sapa Station'),
    identity('ChIJtwo', 'Sapa Station'),
  ]);
  const service = new PlaceLocationCandidatesService(provider);

  const result = await service.find({ textQuery: 'Sapa Station' });

  expect(result.status).toBe('ok');
  expect(result.status === 'ok' && result.candidates).toHaveLength(2);
});

test('the same wording is answered from memory rather than bought twice', async () => {
  const { provider, requests } = countingProvider();
  let now = new Date('2026-09-05T09:00:00.000Z');
  const service = new PlaceLocationCandidatesService(provider, () => now);

  await service.find({ textQuery: 'Hoan Kiem Lake' });
  // Retyped with different spacing and case: the traveller asked the same
  // question, so it must not be a second bill.
  await service.find({ textQuery: '  hoan   kiem lake ' });
  expect(requests).toHaveLength(1);

  now = new Date('2026-09-05T09:06:00.000Z');
  await service.find({ textQuery: 'Hoan Kiem Lake' });
  expect(requests).toHaveLength(2);
});

test('a refusal is reported honestly and is not immediately re-bought', async () => {
  const { provider, requests } = countingProvider(() => {
    throw new PlaceProviderError('quota_exceeded');
  });
  const service = new PlaceLocationCandidatesService(provider);

  const first = await service.find({ textQuery: 'Somewhere' });
  const second = await service.find({ textQuery: 'Somewhere' });

  expect(first).toStrictEqual({
    code: 'quota_exceeded',
    provider: 'google',
    status: 'unavailable',
  });
  expect(second).toStrictEqual(first);
  // Repeating a lookup Google has just refused is how a repair path bills
  // several times over for the same nothing.
  expect(requests).toHaveLength(1);
});

test('finding nothing says so rather than looking like a failure', async () => {
  const { provider } = countingProvider(() => []);
  const service = new PlaceLocationCandidatesService(provider);

  expect(await service.find({ textQuery: "somewhere that isn't" })).toStrictEqual({
    candidates: [],
    provider: 'google',
    status: 'empty',
  });
});

test('the route buys a lookup only for a Custom Place the caller owns', async () => {
  const { provider, requests } = countingProvider();
  // Only the one read the route makes; everything else on the service is unused
  // here, which is itself the point - locating costs one lookup and no writes.
  const canonicalPlaces = {
    async findOwnedCustomPlaceName(userId: string, placeId: string) {
      await Promise.resolve();
      return userId === OWNER_ID && placeId === OWNED_PLACE_ID ? 'Hoan Kiem Lake' : null;
    },
  } as unknown as CanonicalPlacesService;
  const controllers = createPlacesControllers(
    null,
    canonicalPlaces,
    new PlaceLocationCandidatesService(provider),
  );
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.authUserId = OWNER_ID;
  });
  app.post('/custom/:placeId/location-candidates', controllers.locationCandidates);

  const owned = await app.inject({
    method: 'POST',
    payload: {},
    url: `/custom/${OWNED_PLACE_ID}/location-candidates`,
  });
  expect(owned.statusCode).toBe(200);
  expect(owned.json().candidates).toHaveLength(1);
  // No query supplied, so the place's own name is what gets searched.
  expect(requests[0]?.textQuery).toBe('Hoan Kiem Lake');

  const other = await app.inject({
    method: 'POST',
    payload: {},
    url: `/custom/${OTHER_PLACE_ID}/location-candidates`,
  });
  expect(other.statusCode).toBe(404);
  expect(other.json()).toStrictEqual({ code: 'place_not_found' });
  // A place the caller does not own never reaches the provider, so it can never
  // be used to spend someone else's money.
  expect(requests).toHaveLength(1);
});
