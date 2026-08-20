import { getPrismaClient, type Prisma } from '@trove/db';

import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { hydratePlaceSnapshot, isSnapshotFresh, toPlaceCoordinates } from './place-data.js';
import { placeProviderRefInclude } from './place-serializer.js';
import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import {
  providerTargetFingerprint,
  recordProviderCacheEvent,
  type ProviderCallSource,
} from './provider-usage.js';
import { createRoutesService } from './routes-runtime.js';
import {
  isRoutableTravelMode,
  type RouteCoordinates,
  type RouteProviderErrorCode,
  type RouteTravelMode,
  type RoutesService,
} from './routes.js';
import { ItineraryNotFoundError } from './itineraries.js';

export type RoutePointKind = 'daily_base' | 'itinerary_item' | 'starting_location';

export type RoutePoint = {
  coordinates: RouteCoordinates;
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

type RouteServices = {
  placesService?: PlacesService | null;
  /** Pass one shared resolver to dedupe places across several days. */
  resolvePlace?: PlaceResolver;
  routesService?: RoutesService | null;
  source?: ProviderCallSource;
};

function mapMode(value: string): RouteTravelMode {
  if (value === 'FLIGHT') return 'flight';
  if (value === 'TRANSIT') return 'transit';
  if (value === 'WALK') return 'walk';
  return 'drive';
}

function mapModeInput(value: RouteTravelMode) {
  const modes = { drive: 'DRIVE', flight: 'FLIGHT', transit: 'TRANSIT', walk: 'WALK' } as const;
  return modes[value];
}

function serializePoint(point: RoutePoint) {
  const { coordinates: _coordinates, ...serialized } = point;
  return serialized;
}

function sameCoordinates(origin: RouteCoordinates, destination: RouteCoordinates) {
  return origin.latitude === destination.latitude && origin.longitude === destination.longitude;
}

async function resolvePlaceData(
  place: PlaceRecord,
  placesService: PlacesService | null,
  languageCode?: string,
  source: ProviderCallSource = 'itinerary-routes',
): Promise<Pick<RoutePoint, 'coordinates' | 'label'> | null> {
  if (place.customLatitude !== null && place.customLongitude !== null) {
    return {
      coordinates: {
        latitude: place.customLatitude.toNumber(),
        longitude: place.customLongitude.toNumber(),
      },
      label: place.customName,
    };
  }

  const googleReference = place.providerRefs.find((reference) => reference.provider === 'GOOGLE');
  if (!googleReference) return null;

  // Routing reads the same snapshot every screen renders from, so a leg between
  // two known Places is computed without touching the provider at all. Going
  // through `place-data` rather than the places service directly is what keeps
  // one module in charge of when a Place Details call may happen.
  if (isSnapshotFresh(googleReference, { languageCode })) {
    const coordinates = toPlaceCoordinates(googleReference);
    if (coordinates) {
      recordProviderCacheEvent({
        cache: 'place-details',
        kind: 'cache_hit',
        operation: 'getDetails',
        placeFingerprint: providerTargetFingerprint(googleReference.externalPlaceId),
        provider: 'google',
        source,
      });
      return { coordinates, label: googleReference.cachedName };
    }
  }

  const refreshed = await hydratePlaceSnapshot(googleReference.externalPlaceId, {
    languageCode,
    placesService,
    source,
  });
  const coordinates = toPlaceCoordinates(refreshed);
  if (!coordinates) return null;

  return { coordinates, label: refreshed?.cachedName ?? null };
}

export type PlaceResolver = (
  place: PlaceRecord,
  kind: RoutePointKind,
  id: string,
) => Promise<RoutePoint | null>;

/**
 * Memoises by Place id, so one place resolves once however many times a day
 * visits it. Exported because the memo is only worth as much as its lifetime:
 * Plan Score builds a single resolver and shares it across every day of the
 * trip, which is what stops a hotel that is the base on seven days from being
 * fetched seven times.
 */
export function createPlaceResolver(
  placesService: PlacesService | null,
  languageCode?: string,
  source: ProviderCallSource = 'itinerary-routes',
): PlaceResolver {
  const resolutions = new Map<string, Promise<Pick<RoutePoint, 'coordinates' | 'label'> | null>>();

  return async (place: PlaceRecord, kind: RoutePointKind, id: string) => {
    let resolution = resolutions.get(place.id);
    if (!resolution) {
      resolution = resolvePlaceData(place, placesService, languageCode, source);
      resolutions.set(place.id, resolution);
    }
    const data = await resolution;
    return data ? { ...data, id, kind } : null;
  };
}

export type AccommodationTripPlace = Prisma.TripPlaceGetPayload<{
  include: typeof tripPlaceInclude;
}>;

/**
 * A day's base is normally symmetric: one place the day's travel is measured
 * from and back to. On a transition day — checking out of one accommodation
 * and into another — that's wrong, so when exactly two accommodations apply
 * and their check-out/check-in dates cleanly identify which is which, resolve
 * them asymmetrically. Anything more ambiguous falls back to no inferred base
 * on that side rather than guessing (PRD 18.4).
 */
export function inferAccommodationBases(
  accommodationReservations: Array<{
    reservation: {
      checkInDate: Date | null;
      checkOutDate: Date | null;
      tripPlace: AccommodationTripPlace | null;
    };
  }>,
  dayDate: Date,
): { arrival: AccommodationTripPlace | null; departure: AccommodationTripPlace | null } {
  const accommodations = [
    ...new Map(
      accommodationReservations
        .map(({ reservation }) => reservation)
        .filter(
          (
            reservation,
          ): reservation is typeof reservation & { tripPlace: AccommodationTripPlace } =>
            reservation.tripPlace !== null,
        )
        .map((reservation) => [reservation.tripPlace.id, reservation]),
    ).values(),
  ];

  const [onlyAccommodation] = accommodations;
  if (accommodations.length === 1 && onlyAccommodation) {
    const tripPlace = onlyAccommodation.tripPlace;
    return { arrival: tripPlace, departure: tripPlace };
  }

  if (accommodations.length === 2) {
    const dayTime = dayDate.getTime();
    const checkingOut = accommodations.find((entry) => entry.checkOutDate?.getTime() === dayTime);
    const checkingIn = accommodations.find((entry) => entry.checkInDate?.getTime() === dayTime);
    if (checkingOut && checkingIn && checkingOut.tripPlace.id !== checkingIn.tripPlace.id) {
      return { arrival: checkingOut.tripPlace, departure: checkingIn.tripPlace };
    }
  }

  return { arrival: null, departure: null };
}

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
  routesService: RoutesService | null,
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

export async function getItineraryDayRoutes(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  options: { includePolyline?: boolean; itemIds?: string[]; languageCode?: string } = {},
  services: RouteServices = {},
): Promise<ItineraryDayRoutes> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      startingPlace: { include: placeInclude },
      itineraryDays: {
        where: { id: itineraryDayId },
        include: {
          accommodationReservations: {
            include: {
              reservation: { include: { tripPlace: { include: tripPlaceInclude } } },
            },
          },
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
  const source = services.source ?? 'itinerary-routes';

  const placesService =
    services.placesService === undefined ? createPlacesService({ source }) : services.placesService;
  const routesService =
    services.routesService === undefined ? createRoutesService({ source }) : services.routesService;
  const resolvePlace =
    services.resolvePlace ??
    createPlaceResolver(routesService ? placesService : null, options.languageCode, source);
  const placedItems = day.items.filter(
    (item): item is typeof item & { tripPlace: NonNullable<typeof item.tripPlace> } =>
      item.tripPlace !== null,
  );

  const itemPoints = await mapWithConcurrency(
    placedItems,
    PROVIDER_CONCURRENCY_LIMIT,
    async (item) => ({
      item,
      point: await resolvePlace(item.tripPlace.place, 'itinerary_item', item.id),
    }),
  );
  const locatedItems = itemPoints
    .filter((entry): entry is typeof entry & { point: RoutePoint } => entry.point !== null)
    .map(({ item, point }) => ({ mode: mapMode(item.travelModeToNext), point }));

  const { arrival: inferredArrival, departure: inferredDeparture } = inferAccommodationBases(
    day.accommodationReservations,
    day.date,
  );
  const arrivalBaseTripPlace = day.dailyBaseTripPlace ?? inferredArrival;
  const departureBaseTripPlace =
    day.dailyBaseDepartureTripPlace ?? day.dailyBaseTripPlace ?? inferredDeparture;
  const arrivalBase = arrivalBaseTripPlace
    ? await resolvePlace(arrivalBaseTripPlace.place, 'daily_base', arrivalBaseTripPlace.id)
    : null;
  const departureBase = departureBaseTripPlace
    ? await resolvePlace(departureBaseTripPlace.place, 'daily_base', departureBaseTripPlace.id)
    : null;
  const isFirstDay = day.date.getTime() === trip.startDate.getTime();
  const startingLocationExpected =
    !arrivalBaseTripPlace && isFirstDay && trip.startingPlace !== null;
  const startingLocation =
    startingLocationExpected && trip.startingPlace
      ? await resolvePlace(trip.startingPlace, 'starting_location', trip.startingPlace.id)
      : null;

  const plans = buildItineraryRoutePlan({
    arrivalBase,
    dayId: day.id,
    dayStartMode: mapMode(day.routeStartTravelMode),
    departureBase,
    items: locatedItems,
    startingLocation,
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

export async function updateItineraryDayRouteMode(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  mode: RouteTravelMode,
) {
  const prisma = getPrismaClient();
  const day = await prisma.itineraryDay.findFirst({
    where: { id: itineraryDayId, tripId, trip: { ownerId: userId } },
    select: { id: true },
  });
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
  await prisma.itineraryDay.update({
    where: { id: day.id },
    data: { routeStartTravelMode: mapModeInput(mode) },
  });
}

export async function updateItineraryItemRouteMode(
  userId: string,
  tripId: string,
  itemId: string,
  mode: RouteTravelMode,
) {
  const prisma = getPrismaClient();
  const item = await prisma.itineraryItem.findFirst({
    where: { id: itemId, tripId, trip: { ownerId: userId } },
    select: { id: true },
  });
  if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
  await prisma.itineraryItem.update({
    where: { id: item.id },
    data: { travelModeToNext: mapModeInput(mode) },
  });
}
