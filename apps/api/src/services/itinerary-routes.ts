import { getPrismaClient, type Prisma } from '@trove/db';

import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import { createRoutesService } from './routes-runtime.js';
import {
  type RouteCoordinates,
  type RouteProviderErrorCode,
  type RouteTravelMode,
  type RoutesService,
} from './routes.js';
import { ItineraryNotFoundError } from './itineraries.js';

type RoutePointKind = 'daily_base' | 'itinerary_item' | 'starting_location';

type RoutePoint = {
  coordinates: RouteCoordinates;
  id: string;
  kind: RoutePointKind;
  label: string | null;
};

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
  status: 'ok' | 'unavailable';
};

type RouteSummaryStatus = 'complete' | 'partial' | 'unavailable';

export type ItineraryDayRoutes = {
  generatedAt: string;
  segments: ItineraryRouteSegment[];
  summary: {
    distanceMeters: number | null;
    durationSeconds: number | null;
    knownSegmentCount: number;
    scheduledPlaceCount: number;
    status: RouteSummaryStatus;
    totalSegmentCount: number;
  };
};

const placeInclude = { providerRefs: true } as const;
const tripPlaceInclude = { place: { include: placeInclude } } as const;

type PlaceRecord = Prisma.PlaceGetPayload<{ include: typeof placeInclude }>;

type RouteServices = {
  placesService?: PlacesService | null;
  routesService?: RoutesService | null;
};

function mapMode(value: string): RouteTravelMode {
  if (value === 'TRANSIT') return 'transit';
  if (value === 'WALK') return 'walk';
  return 'drive';
}

function mapModeInput(value: RouteTravelMode) {
  const modes = { drive: 'DRIVE', transit: 'TRANSIT', walk: 'WALK' } as const;
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
  if (!googleReference || !placesService) return null;

  const result = await placesService.getDetails({
    externalPlaceId: googleReference.externalPlaceId,
    languageCode,
  });
  if (result.status !== 'ok' || !result.place.location) return null;

  return {
    coordinates: result.place.location,
    label: result.place.name,
  };
}

function createPlaceResolver(placesService: PlacesService | null, languageCode?: string) {
  const resolutions = new Map<string, Promise<Pick<RoutePoint, 'coordinates' | 'label'> | null>>();

  return async (place: PlaceRecord, kind: RoutePointKind, id: string) => {
    let resolution = resolutions.get(place.id);
    if (!resolution) {
      resolution = resolvePlaceData(place, placesService, languageCode);
      resolutions.set(place.id, resolution);
    }
    const data = await resolution;
    return data ? { ...data, id, kind } : null;
  };
}

type SegmentPlan = {
  destination: RoutePoint;
  mode: RouteTravelMode;
  modeOwner: ItineraryRouteSegment['modeOwner'];
  origin: RoutePoint;
};

function buildItineraryRoutePlan(input: {
  base: RoutePoint | null;
  dayId: string;
  dayStartMode: RouteTravelMode;
  items: Array<{ mode: RouteTravelMode; point: RoutePoint }>;
  startingLocation: RoutePoint | null;
}) {
  const plans: SegmentPlan[] = [];
  const first = input.items[0];
  const dayOrigin = input.base ?? input.startingLocation;

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
  if (input.base && last) {
    plans.push({
      destination: input.base,
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
  };

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

function createSummary(
  segments: ItineraryRouteSegment[],
  scheduledPlaceCount: number,
  hasIncompleteLocations: boolean,
) {
  const available = segments.filter(
    (segment) =>
      segment.status === 'ok' &&
      segment.distanceMeters !== null &&
      segment.durationSeconds !== null,
  );
  const isComplete = !hasIncompleteLocations && available.length === segments.length;
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
    scheduledPlaceCount,
    status,
    totalSegmentCount: segments.length,
  };
}

export async function getItineraryDayRoutes(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  options: { includePolyline?: boolean; languageCode?: string } = {},
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
          dailyBaseTripPlace: { include: tripPlaceInclude },
          items: {
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

  const placesService =
    services.placesService === undefined ? createPlacesService() : services.placesService;
  const routesService =
    services.routesService === undefined ? createRoutesService() : services.routesService;
  const resolvePlace = createPlaceResolver(
    routesService ? placesService : null,
    options.languageCode,
  );
  const placedItems = day.items.filter(
    (item): item is typeof item & { tripPlace: NonNullable<typeof item.tripPlace> } =>
      item.tripPlace !== null,
  );

  const itemPoints = await Promise.all(
    placedItems.map(async (item) => ({
      item,
      point: await resolvePlace(item.tripPlace.place, 'itinerary_item', item.id),
    })),
  );
  const locatedItems = itemPoints
    .filter((entry): entry is typeof entry & { point: RoutePoint } => entry.point !== null)
    .map(({ item, point }) => ({ mode: mapMode(item.travelModeToNext), point }));

  const accommodationTripPlaces = [
    ...new Map(
      day.accommodationReservations
        .map(({ reservation }) => reservation.tripPlace)
        .filter((tripPlace) => tripPlace !== null)
        .map((tripPlace) => [tripPlace.id, tripPlace]),
    ).values(),
  ];
  const inferredAccommodation =
    accommodationTripPlaces.length === 1 ? accommodationTripPlaces[0] : null;
  const baseTripPlace = day.dailyBaseTripPlace ?? inferredAccommodation;
  const base = baseTripPlace
    ? await resolvePlace(baseTripPlace.place, 'daily_base', baseTripPlace.id)
    : null;
  const isFirstDay = day.date.getTime() === trip.startDate.getTime();
  const startingLocationExpected = !baseTripPlace && isFirstDay && trip.startingPlace !== null;
  const startingLocation =
    startingLocationExpected && trip.startingPlace
      ? await resolvePlace(trip.startingPlace, 'starting_location', trip.startingPlace.id)
      : null;

  const plans = buildItineraryRoutePlan({
    base,
    dayId: day.id,
    dayStartMode: mapMode(day.routeStartTravelMode),
    items: locatedItems,
    startingLocation,
  });
  const segments = await Promise.all(
    plans.map((plan) =>
      resolveSegment(plan, routesService, options.includePolyline ?? false, options.languageCode),
    ),
  );

  return {
    generatedAt: new Date().toISOString(),
    segments,
    summary: createSummary(
      segments,
      placedItems.length,
      itemPoints.some(({ point }) => point === null) ||
        (baseTripPlace !== null && base === null) ||
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
