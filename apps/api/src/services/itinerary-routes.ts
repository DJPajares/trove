import { getPrismaClient, type Prisma } from '@trove/db';

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
import { type RouteTravelMode, type RoutesService } from './routes.js';
import { ItineraryNotFoundError } from './itineraries.js';

export { buildItineraryRoutePlan, createSummary } from './itinerary-route-reader.js';
export type {
  ItineraryDayRoutes,
  ItineraryRouteSegment,
  RoutePoint,
  RoutePointKind,
  RouteSegmentScope,
  PlaceResolver,
  AccommodationTripPlace,
} from './itinerary-route-reader.js';
import {
  readItineraryDayRoutes,
  type RoutePoint,
  type RoutePointKind,
  type PlaceResolver,
  type ItineraryDayRoutes,
} from './itinerary-route-reader.js';
const placeInclude = placeProviderRefInclude;
type PlaceRecord = Prisma.PlaceGetPayload<{ include: typeof placeInclude }>;
type RouteServices = {
  placesService?: PlacesService | null;
  resolvePlace?: PlaceResolver;
  routesService?: RoutesService | null;
  source?: ProviderCallSource;
};

function mapModeInput(value: RouteTravelMode) {
  const modes = { drive: 'DRIVE', flight: 'FLIGHT', transit: 'TRANSIT', walk: 'WALK' } as const;
  return modes[value];
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

export async function getItineraryDayRoutes(
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
  } = {},
  services: RouteServices = {},
): Promise<ItineraryDayRoutes> {
  const source = services.source ?? 'itinerary-routes';
  const placesService =
    services.placesService === undefined ? createPlacesService({ source }) : services.placesService;
  const routesService =
    services.routesService === undefined ? createRoutesService({ source }) : services.routesService;
  const resolvePlace =
    services.resolvePlace ??
    createPlaceResolver(routesService ? placesService : null, options.languageCode, source);
  return readItineraryDayRoutes(userId, tripId, itineraryDayId, options, {
    resolvePlace,
    routesService,
  });
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
