import { afterEach, beforeEach, expect, test } from 'vitest';

import type { PlaceResolver, RoutePoint } from '../src/services/itinerary-routes.js';

/**
 * What a leg costs, counted rather than described.
 *
 * A discarded segment is invisible in a response - the caller simply does not
 * read it - so the only thing that catches the day's ends being bought for a
 * question about two stops is the count of what went out to the providers.
 */
function createSpies() {
  const resolved: string[] = [];
  const routed: string[] = [];

  const resolvePlace: PlaceResolver = async (place, kind, id) => {
    resolved.push(id);
    return {
      coordinates: { latitude: 35 + resolved.length, longitude: 139 + resolved.length },
      id,
      kind,
      label: place.customName,
    } satisfies RoutePoint;
  };

  const routesService = {
    async computeRoute(request: {
      destination: { latitude: number };
      origin: { latitude: number };
    }) {
      routed.push(`${request.origin.latitude}->${request.destination.latitude}`);
      return {
        estimate: { distanceMeters: 1_000, durationSeconds: 600, encodedPolyline: null },
        freshness: { fetchedAt: '2026-09-04T00:00:00.000Z', source: 'live' as const },
        provider: 'google' as const,
        status: 'ok' as const,
      };
    },
  };

  return { resolved, resolvePlace, routed, routesService };
}

function place(id: string) {
  return {
    customLatitude: null,
    customLongitude: null,
    customName: id,
    id: `place-${id}`,
    providerRefs: [],
  };
}

function item(id: string, position: number) {
  return {
    id,
    position,
    travelModeToNext: 'DRIVE',
    tripPlace: { id: `tp-${id}`, place: place(id) },
  };
}

/** A day with a base at both ends and two stops between them. */
function stubPrisma() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    trip: {
      async findFirst() {
        return {
          id: 'trip',
          itineraryDays: [
            {
              accommodationReservations: [],
              dailyBaseDepartureTripPlace: { id: 'tp-base', place: place('base') },
              dailyBaseTripPlace: { id: 'tp-base', place: place('base') },
              date: new Date('2026-09-10T00:00:00.000Z'),
              id: 'day-1',
              items: [item('museum', 0), item('lunch', 1)],
              routeStartTravelMode: 'DRIVE',
            },
          ],
          startDate: new Date('2026-09-05T00:00:00.000Z'),
          startingPlace: null,
        };
      },
    },
  };
}

beforeEach(() => {
  delete (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient;
});

afterEach(() => {
  delete (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient;
});

test('the whole day buys the legs out of the base and back to it', async () => {
  const { getItineraryDayRoutes } = await import('../src/services/itinerary-routes.js');
  stubPrisma();
  const { resolved, resolvePlace, routed, routesService } = createSpies();

  const routes = await getItineraryDayRoutes('owner', 'trip', 'day-1', {}, {
    resolvePlace,
    routesService,
  } as never);

  expect(routes.segments).toHaveLength(3);
  expect(routed, 'base to first, between the stops, last back to base').toHaveLength(3);
  expect(resolved, 'both stops and the base').toContain('tp-base');
});

test('a caller reading one leg does not pay for the day it did not ask about', async () => {
  const { getItineraryDayRoutes } = await import('../src/services/itinerary-routes.js');
  stubPrisma();
  const { resolved, resolvePlace, routed, routesService } = createSpies();

  const routes = await getItineraryDayRoutes('owner', 'trip', 'day-1', { legs: 'between_items' }, {
    resolvePlace,
    routesService,
  } as never);

  expect(routes.segments, 'only the hop between the two stops').toHaveLength(1);
  expect(routed, 'one billable route, not three').toHaveLength(1);
  expect(resolved, 'the base is never located either').not.toContain('tp-base');
  expect(resolved).toStrictEqual(['museum', 'lunch']);
  expect(routes.segments[0]?.origin.id).toBe('museum');
  expect(routes.segments[0]?.destination.id).toBe('lunch');
});
