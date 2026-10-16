import { describe, expect, it } from 'vitest';
import type { ItineraryDay, ItineraryItem, ItineraryRouteSegment } from '@/lib/itinerary/api';
import type { ItineraryMapPoint } from '@/lib/maps/itinerary-map';
import {
  buildMapRouteLegs,
  hitTestMapRoutes,
  mapRoutePath,
  routeForMapPoint,
} from '@/lib/maps/map-route-selection';

const stop = (id: string, tripPlaceId = id) =>
  ({ id, tripPlace: { id: tripPlaceId } }) as ItineraryItem;
const day = (items: ItineraryItem[], start: string | null = null, end: string | null = null) =>
  ({
    id: 'day',
    items,
    dailyBaseTripPlaceId: start,
    dailyBaseDepartureTripPlaceId: end,
    stay: { startTripPlaceId: start, endTripPlaceId: end },
  }) as ItineraryDay;
const point = (
  id: string,
  itemId: string | null = id,
  kind: ItineraryMapPoint['kind'] = 'scheduled',
  baseRole?: ItineraryMapPoint['baseRole'],
) =>
  ({
    id,
    tripPlaceId: id,
    itemId,
    kind,
    baseRole,
    name: id,
    order: 1,
    latitude: 0,
    longitude: 0,
  }) as ItineraryMapPoint;
const segment = (
  id: string,
  origin: string,
  destination: string,
  originKind: ItineraryRouteSegment['origin']['kind'] = 'itinerary_item',
  destinationKind: ItineraryRouteSegment['origin']['kind'] = 'itinerary_item',
) =>
  ({
    id,
    origin: { id: origin, kind: originKind, label: origin },
    destination: { id: destination, kind: destinationKind, label: destination },
    encodedPolyline: null,
    mode: 'drive',
    distanceMeters: null,
    durationSeconds: null,
    status: 'unavailable',
    scope: 'local',
    modeOwner: { id: origin, kind: 'item_departure' },
  }) as ItineraryRouteSegment;

describe('map route identity and selection', () => {
  const points = [point('a'), point('b'), point('c')];
  const legs = buildMapRouteLegs(
    day([stop('a'), stop('b'), stop('c')]),
    [segment('ab', 'a', 'b'), segment('bc', 'b', 'c')],
    points,
  );

  it('selects outgoing legs and the incoming leg at the final stop', () => {
    expect(routeForMapPoint(points[0]!, legs)?.id).toBe('ab');
    expect(routeForMapPoint(points[1]!, legs)?.id).toBe('bc');
    expect(routeForMapPoint(points[2]!, legs)?.id).toBe('bc');
    expect(routeForMapPoint(point('a', 'a', 'considered'), legs)).toBeNull();
  });

  it('keeps an unavailable outgoing leg instead of substituting an incoming path', () => {
    expect(legs).toHaveLength(2);
    expect(mapRoutePath(legs[1]!)).toEqual([]);
    expect(routeForMapPoint(points[1]!, legs)?.id).toBe('bc');
  });

  it('maps repeated visits by item identity while reusing their physical pin', () => {
    const visits = buildMapRouteLegs(
      day([stop('first', 'place'), stop('b'), stop('again', 'place'), stop('c')]),
      [segment('first-b', 'first', 'b'), segment('again-c', 'again', 'c')],
      [point('place', 'first'), ...points.slice(1)],
    );
    expect(visits.map((leg) => [leg.origin.pointId, leg.origin.order])).toEqual([
      ['place', 1],
      ['place', 3],
    ]);
    expect(routeForMapPoint(point('place', 'first'), visits)?.id).toBe('first-b');
  });

  it('matches start/end stay roles and prioritizes the return leg at the last activity', () => {
    const start = point('hotel', null, 'base', 'both');
    const stayLegs = buildMapRouteLegs(
      day([stop('a')], 'hotel', 'hotel'),
      [
        segment('out', 'hotel', 'a', 'daily_base'),
        segment('home', 'a', 'hotel', 'itinerary_item', 'daily_base'),
      ],
      [start, points[0]!],
    );
    expect(stayLegs.map((leg) => [leg.origin.order, leg.destination.order])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(stayLegs[1]?.destination.pointId).toBe('hotel');
    expect(routeForMapPoint(start, stayLegs)?.id).toBe('out');
    expect(routeForMapPoint(points[0]!, stayLegs)?.id).toBe('home');
    expect(routeForMapPoint({ ...start, baseRole: 'departure' }, stayLegs)?.id).toBe('home');
  });

  it('does not associate starting locations or unlocated items with unrelated pins', () => {
    const missing = buildMapRouteLegs(
      day([stop('a'), { id: 'unlocated', tripPlace: null } as ItineraryItem]),
      [segment('start', 'home', 'a', 'starting_location'), segment('missing', 'a', 'unlocated')],
      points,
    );
    expect(missing[0]?.origin.pointId).toBeNull();
    expect(missing[1]?.destination.pointId).toBeNull();
    expect(missing[1]?.destination.order).toBe(2);
    expect(buildMapRouteLegs(null, [], points)).toEqual([]);
  });
});

describe('screen-space route hit testing', () => {
  const paths = [
    {
      id: 'ab',
      path: [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
    },
    {
      id: 'bc',
      path: [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
    },
    {
      id: 'de',
      path: [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
    },
  ];
  it('returns every crossing or coincident leg in itinerary order', () => {
    expect(hitTestMapRoutes({ x: 50, y: 50 }, paths, 12)).toEqual(['ab', 'bc', 'de']);
    expect(hitTestMapRoutes({ x: 10, y: 50 }, paths, 12)).toEqual(['ab', 'de']);
  });
  it('uses the specified mouse/touch radius and clears on empty space', () => {
    expect(hitTestMapRoutes({ x: 10, y: 68 }, paths, 12)).toEqual([]);
    expect(hitTestMapRoutes({ x: 10, y: 68 }, paths, 20)).toEqual(['ab', 'de']);
    expect(hitTestMapRoutes({ x: 150, y: 150 }, paths, 20)).toEqual([]);
  });
  it('bounds line ends and handles empty or zero-length geometry', () => {
    expect(hitTestMapRoutes({ x: 130, y: 50 }, paths, 12)).toEqual([]);
    expect(
      hitTestMapRoutes(
        { x: 0, y: 0 },
        [
          { id: 'empty', path: [] },
          {
            id: 'dot',
            path: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          },
        ],
        12,
      ),
    ).toEqual(['dot']);
  });
});
