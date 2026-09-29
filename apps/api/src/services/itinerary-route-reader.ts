import { getPrismaClient, type Prisma } from '@trove/db';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { placeProviderRefInclude } from './place-serializer.js';
import { resolveDayStay, stayAccommodationsInclude, toStayAccommodations } from './day-stay.js';
import { ItineraryNotFoundError } from './itineraries.js';
import {
  isRoutableTravelMode,
  type RouteCoordinates,
  type RouteProviderErrorCode,
  type RouteTravelMode,
  type RoutesService,
} from './routes.js';

export type RoutePointKind = 'daily_base' | 'itinerary_item' | 'starting_location';

export type RoutePoint = {
  coordinates: RouteCoordinates;
  evidenceExpiresAt?: string;
  id: string;
  kind: RoutePointKind;
  label: string | null;
};

/**
 * `long_distance` legs are logistics rather than local travel: they are never
 * routed, never estimated, and are excluded from the day's travel totals and
 * from Plan Score's travel effort (PRD sections 18.1 and 29.1).
 */
export type RouteSegmentScope = 'local' | 'long_distance';

export type ItineraryRouteSegment = {
  destination: Omit<RoutePoint, 'coordinates'>;
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string | null;
  /** Original provider fetch time, including transient or permitted route reuse. */
  evidenceAsOf?: string;
  evidenceExpiresAt?: string;
  id: string;
  mode: RouteTravelMode;
  modeOwner: { id: string; kind: 'day_start' | 'item_departure' };
  origin: Omit<RoutePoint, 'coordinates'>;
  provider: 'google' | null;
  reason: RouteProviderErrorCode | 'route_not_found' | null;
  scope: RouteSegmentScope;
  /** `not_estimated` is a deliberate absence of an estimate, not a failure to get one. */
  status: 'not_estimated' | 'ok' | 'unavailable';
};

type RouteSummaryStatus = 'complete' | 'partial' | 'unavailable';

export type ItineraryDayRoutes = {
  generatedAt: string;
  segments: ItineraryRouteSegment[];
  summary: {
    distanceMeters: number | null;
    durationSeconds: number | null;
    knownSegmentCount: number;
    /** Legs the totals describe. Zero alongside legs means the day only moves long distance. */
    localSegmentCount: number;
    scheduledPlaceCount: number;
    status: RouteSummaryStatus;
    totalSegmentCount: number;
  };
};

const placeInclude = placeProviderRefInclude;
const tripPlaceInclude = { place: { include: placeInclude } } as const;

type PlaceRecord = Prisma.PlaceGetPayload<{ include: typeof placeInclude }>;

function mapMode(value: string): RouteTravelMode {
  if (value === 'FLIGHT') return 'flight';
  if (value === 'TRANSIT') return 'transit';
  if (value === 'WALK') return 'walk';
  return 'drive';
}

function serializePoint(point: RoutePoint) {
  const { coordinates: _coordinates, evidenceExpiresAt: _expiresAt, ...serialized } = point;
  return serialized;
}

function sameCoordinates(origin: RouteCoordinates, destination: RouteCoordinates) {
  return origin.latitude === destination.latitude && origin.longitude === destination.longitude;
}

export type PlaceResolver = (
  place: PlaceRecord,
  kind: RoutePointKind,
  id: string,
) => Promise<RoutePoint | null>;

export type AccommodationTripPlace = Prisma.TripPlaceGetPayload<{
  include: typeof tripPlaceInclude;
}>;

type SegmentPlan = {
  destination: RoutePoint;
  mode: RouteTravelMode;
  modeOwner: ItineraryRouteSegment['modeOwner'];
  origin: RoutePoint;
};

export function buildItineraryRoutePlan(input: {
  arrivalBase: RoutePoint | null;
  dayId: string;
  dayStartMode: RouteTravelMode;
  departureBase: RoutePoint | null;
  items: Array<{ mode: RouteTravelMode; point: RoutePoint }>;
  startingLocation: RoutePoint | null;
}) {
  const plans: SegmentPlan[] = [];
  const first = input.items[0];
  const dayOrigin = input.arrivalBase ?? input.startingLocation;

  if (dayOrigin && first) {
    plans.push({
      destination: first.point,
      mode: input.dayStartMode,
      modeOwner: { id: input.dayId, kind: 'day_start' },
      origin: dayOrigin,
    });
  }

  for (let index = 0; index < input.items.length - 1; index += 1) {
    const current = input.items[index];
    const next = input.items[index + 1];
    if (!current || !next) continue;
    plans.push({
      destination: next.point,
      mode: current.mode,
      modeOwner: { id: current.point.id, kind: 'item_departure' },
      origin: current.point,
    });
  }

  const last = input.items.at(-1);
  if (input.departureBase && last) {
    plans.push({
      destination: input.departureBase,
      mode: last.mode,
      modeOwner: { id: last.point.id, kind: 'item_departure' },
      origin: last.point,
    });
  }

  return plans;
}

async function resolveSegment(
  plan: SegmentPlan,
  routesService: Pick<RoutesService, 'computeRoute'> | null,
  includePolyline: boolean,
  languageCode?: string,
): Promise<ItineraryRouteSegment> {
  const base = {
    destination: serializePoint(plan.destination),
    id: `${plan.origin.kind}:${plan.origin.id}:${plan.destination.kind}:${plan.destination.id}`,
    mode: plan.mode,
    modeOwner: plan.modeOwner,
    origin: serializePoint(plan.origin),
    scope: 'local' as RouteSegmentScope,
    ...(plan.origin.evidenceExpiresAt || plan.destination.evidenceExpiresAt
      ? {
          evidenceExpiresAt: new Date(
            Math.min(
              ...[plan.origin.evidenceExpiresAt, plan.destination.evidenceExpiresAt].flatMap(
                (at) => (at ? [Date.parse(at)] : []),
              ),
            ),
          ).toISOString(),
        }
      : {}),
  };

  // Trove does not plan flights, so a flight leg is recorded without ever asking
  // the provider for an estimate it cannot give.
  if (!isRoutableTravelMode(plan.mode)) {
    return {
      ...base,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      provider: null,
      reason: null,
      scope: 'long_distance',
      status: 'not_estimated',
    };
  }

  if (
    ![
      plan.origin.coordinates.latitude,
      plan.origin.coordinates.longitude,
      plan.destination.coordinates.latitude,
      plan.destination.coordinates.longitude,
    ].every(Number.isFinite)
  ) {
    return {
      ...base,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      provider: null,
      reason: 'route_not_found',
      status: 'unavailable',
    };
  }

  if (sameCoordinates(plan.origin.coordinates, plan.destination.coordinates)) {
    return {
      ...base,
      distanceMeters: 0,
      durationSeconds: 0,
      encodedPolyline: null,
      provider: null,
      reason: null,
      status: 'ok',
    };
  }

  if (!routesService) {
    return {
      ...base,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      provider: 'google',
      reason: 'configuration_missing',
      status: 'unavailable',
    };
  }

  const result = await routesService.computeRoute({
    destination: plan.destination.coordinates,
    includePolyline,
    languageCode,
    mode: plan.mode,
    origin: plan.origin.coordinates,
  });

  if (result.status === 'ok') {
    return {
      ...base,
      ...result.estimate,
      evidenceAsOf: result.freshness.fetchedAt,
      provider: result.provider,
      reason: null,
      status: 'ok',
    };
  }

  return {
    ...base,
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    provider: result.provider,
    reason: result.status === 'empty' ? 'route_not_found' : result.code,
    status: 'unavailable',
  };
}

export function createSummary(
  segments: ItineraryRouteSegment[],
  scheduledPlaceCount: number,
  hasIncompleteLocations: boolean,
) {
  // Totals and completeness describe local travel only. A long-distance leg has no
  // estimate by design, so counting it would report the day as perpetually partial.
  const local = segments.filter((segment) => segment.scope === 'local');
  const available = local.filter(
    (segment) =>
      segment.status === 'ok' &&
      segment.distanceMeters !== null &&
      segment.durationSeconds !== null,
  );
  const isComplete = !hasIncompleteLocations && available.length === local.length;
  const status: RouteSummaryStatus = isComplete
    ? 'complete'
    : available.length > 0
      ? 'partial'
      : 'unavailable';

  return {
    distanceMeters:
      available.length > 0 || isComplete
        ? available.reduce((total, segment) => total + (segment.distanceMeters ?? 0), 0)
        : null,
    durationSeconds:
      available.length > 0 || isComplete
        ? available.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0)
        : null,
    knownSegmentCount: available.length,
    localSegmentCount: local.length,
    scheduledPlaceCount,
    status,
    totalSegmentCount: segments.length,
  };
}

export async function readItineraryDayRoutes(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  options: {
    includePolyline?: boolean;
    itemIds?: string[];
    languageCode?: string;
    /**
     * Which legs the caller will actually read.
     *
     * `whole_day` is the chain a day view draws: out of the base, between the
     * stops, and back again. `between_items` is for a caller that only wants
     * the hop from one stop to the next - Trip Mode's leave-by asks about two
     * items and reads exactly one leg. The day's ends are not computed and
     * then dropped for it; they are never asked for, because a base costs a
     * Place Details call to locate and a Routes call to reach.
     */
    legs?: 'between_items' | 'whole_day';
  },
  services: {
    resolvePlace: PlaceResolver;
    routesService: Pick<RoutesService, 'computeRoute'> | null;
  },
): Promise<ItineraryDayRoutes> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      startingPlace: { include: placeInclude },
      reservations: stayAccommodationsInclude({ include: tripPlaceInclude }),
      itineraryDays: {
        where: { id: itineraryDayId },
        include: {
          dailyBaseDepartureTripPlace: { include: tripPlaceInclude },
          dailyBaseTripPlace: { include: tripPlaceInclude },
          items: {
            where: options.itemIds ? { id: { in: options.itemIds } } : undefined,
            include: { tripPlace: { include: tripPlaceInclude } },
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  const day = trip.itineraryDays[0];
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
  const { resolvePlace, routesService } = services;
  const located = day.items;

  // A whole-day request is building the day's chain, so position is the order.
  // A `between_items` caller is naming an ordered *pair* - "the hop from this
  // stop to that one" - and position is not that: a flexible stop carries no
  // start time, so the stop that is current can sit later in the list than the
  // one that is next. Re-sorting those two by position built the leg backwards,
  // which the caller then failed to recognise and dropped.
  const requestedOrder = options.legs === 'between_items' ? options.itemIds : undefined;
  const placedItems = requestedOrder
    ? located.toSorted(
        (left, right) => requestedOrder.indexOf(left.id) - requestedOrder.indexOf(right.id),
      )
    : located;

  const itemPoints = await mapWithConcurrency(
    placedItems,
    PROVIDER_CONCURRENCY_LIMIT,
    async (item) => ({
      item,
      point: item.tripPlace
        ? await resolvePlace(item.tripPlace.place, 'itinerary_item', item.id)
        : null,
    }),
  );
  const locatedItems = itemPoints.map(({ item, point }) => ({
    mode: mapMode(item.travelModeToNext),
    point: point ?? {
      id: item.id,
      kind: 'itinerary_item' as const,
      label: null,
      coordinates: { latitude: NaN, longitude: NaN },
    },
  }));

  const wholeDay = options.legs !== 'between_items';
  const stay = wholeDay ? resolveDayStay(day, toStayAccommodations(trip.reservations)) : null;
  const arrivalBaseTripPlace = stay?.start?.place ?? null;
  const departureBaseTripPlace = stay?.end?.place ?? null;
  const arrivalBase = arrivalBaseTripPlace
    ? await resolvePlace(arrivalBaseTripPlace.place, 'daily_base', arrivalBaseTripPlace.id)
    : null;
  const departureBase = departureBaseTripPlace
    ? await resolvePlace(departureBaseTripPlace.place, 'daily_base', departureBaseTripPlace.id)
    : null;
  const isFirstDay = day.date.getTime() === trip.startDate.getTime();
  const startingLocationExpected =
    wholeDay && !arrivalBaseTripPlace && isFirstDay && trip.startingPlace !== null;
  const startingLocation =
    startingLocationExpected && trip.startingPlace
      ? await resolvePlace(trip.startingPlace, 'starting_location', trip.startingPlace.id)
      : null;

  const plans = buildItineraryRoutePlan({
    arrivalBase:
      arrivalBase ??
      (arrivalBaseTripPlace
        ? {
            id: arrivalBaseTripPlace.id,
            kind: 'daily_base',
            label: null,
            coordinates: { latitude: NaN, longitude: NaN },
          }
        : null),
    dayId: day.id,
    dayStartMode: mapMode(day.routeStartTravelMode),
    departureBase:
      departureBase ??
      (departureBaseTripPlace
        ? {
            id: departureBaseTripPlace.id,
            kind: 'daily_base',
            label: null,
            coordinates: { latitude: NaN, longitude: NaN },
          }
        : null),
    items: locatedItems,
    startingLocation:
      startingLocation ??
      (startingLocationExpected && trip.startingPlace
        ? {
            id: trip.startingPlace.id,
            kind: 'starting_location',
            label: null,
            coordinates: { latitude: NaN, longitude: NaN },
          }
        : null),
  });
  const segments = await mapWithConcurrency(plans, PROVIDER_CONCURRENCY_LIMIT, (plan) =>
    resolveSegment(plan, routesService, options.includePolyline ?? false, options.languageCode),
  );

  return {
    generatedAt: new Date().toISOString(),
    segments,
    summary: createSummary(
      segments,
      placedItems.length,
      itemPoints.some(({ point }) => point === null) ||
        (arrivalBaseTripPlace !== null && arrivalBase === null) ||
        (departureBaseTripPlace !== null && departureBase === null) ||
        (startingLocationExpected && startingLocation === null),
    ),
  };
}
