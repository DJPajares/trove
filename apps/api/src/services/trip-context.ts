import { getPrismaClient } from '@trove/db';
import { TRIP_CONTEXT_VERSION, type AiPlannerDraft, type TripContext } from '@trove/types';

import { tripClimate, type ClimateOptions } from './climate-norms.js';
import { resolveDayStay, stayAccommodationsInclude, toStayAccommodations } from './day-stay.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { contextPlaceFromOwnedData } from './owned-place-location.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import { placeProviderRefInclude } from './place-serializer.js';
import { tripHolidays } from './trip-holidays.js';
import { formatDateOnly } from './trip-rules.js';

/**
 * What a traveller should know about when and where a trip happens, for
 * Insights. Places are located only from what Trove already stores, so the one
 * provider this reaches is the climate archive, and only on a cache miss.
 */
export async function readTripContext(
  userId: string,
  tripId: string,
  options: { fetcher?: ClimateOptions['fetcher']; languageCode?: string; now?: Date } = {},
): Promise<TripContext> {
  const now = options.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      countries: true,
      referenceTimeZone: true,
      destinations: {
        orderBy: { position: 'asc' },
        select: { place: { include: placeProviderRefInclude } },
      },
      tripPlaces: { select: { id: true, place: { include: placeProviderRefInclude } } },
      reservations: stayAccommodationsInclude({ select: { id: true } }),
      itineraryDays: {
        orderBy: { date: 'asc' },
        select: {
          id: true,
          date: true,
          defaultTimeZone: true,
          dailyBaseTripPlaceId: true,
          items: { orderBy: { position: 'asc' }, select: { tripPlaceId: true } },
        },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const located = (place: Parameters<typeof contextPlaceFromOwnedData>[0]) =>
    contextPlaceFromOwnedData(place, now).coordinates ?? null;
  const placeCoordinates = new Map(trip.tripPlaces.map((row) => [row.id, located(row.place)]));
  const destination = trip.destinations.map((row) => located(row.place)).find(Boolean) ?? null;
  const accommodations = toStayAccommodations(trip.reservations);
  const days = trip.itineraryDays.map((day) => {
    const stay = resolveDayStay(
      {
        id: day.id,
        date: day.date,
        dailyBaseTripPlace: day.dailyBaseTripPlaceId ? { id: day.dailyBaseTripPlaceId } : null,
        dailyBaseDepartureTripPlace: null,
      },
      accommodations,
    );
    return {
      id: day.id,
      date: formatDateOnly(day.date),
      timeZone: day.defaultTimeZone ?? trip.referenceTimeZone,
      // Where the day is spent: its stay, else its first placed stop, else the
      // trip's first destination.
      coordinates:
        [stay.start?.place.id ?? null, ...day.items.map((item) => item.tripPlaceId)]
          .map((id) => (id ? placeCoordinates.get(id) : null))
          .find(Boolean) ?? destination,
    };
  });

  return {
    version: TRIP_CONTEXT_VERSION,
    days: days.map(({ id, date }) => ({ id, date })),
    holidays: tripHolidays({
      days,
      countries: trip.countries,
      language: normalizePlaceLanguageCode(options.languageCode),
    }),
    climate: await tripClimate(days, {
      allowFetch: true,
      fetcher: options.fetcher,
      now,
      source: 'trip-context',
    }),
  };
}

/**
 * The same context for an AI draft under review. A draft's days are its dates
 * and its places are references, so it is located from verified draft places.
 * Review must not reach a provider, so climate is read from the cache only.
 */
export async function draftTripContext(
  draft: AiPlannerDraft,
  countries: readonly string[],
  now: Date,
): Promise<TripContext> {
  const located = new Map(
    draft.places.map((place) => [
      place.id,
      place.resolution === 'verified' ? (place.location ?? null) : null,
    ]),
  );
  const destination =
    draft.trip.destinations.map((entry) => located.get(entry.placeRefId)).find(Boolean) ?? null;
  const days = draft.days.map((day) => {
    const coordinates =
      [day.dailyBasePlaceRefId, ...day.items.map((item) => item.placeRefId)]
        .map((id) => (id ? located.get(id) : null))
        .find(Boolean) ?? destination;
    return {
      id: day.date,
      date: day.date,
      timeZone: coordinates ? timeZoneAtCoordinates(coordinates) : null,
      coordinates,
    };
  });
  return {
    version: TRIP_CONTEXT_VERSION,
    days: days.map(({ id, date }) => ({ id, date })),
    holidays: tripHolidays({ days, countries, language: normalizePlaceLanguageCode() }),
    climate: await tripClimate(days, { allowFetch: false, now, source: 'ai-planner-review' }),
  };
}
