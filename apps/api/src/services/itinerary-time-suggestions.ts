import { getPrismaClient } from '@trove/db';

import {
  sameDayJourneyCommitment,
  toDayEvidenceItems,
  toLocalDate,
} from './itinerary-day-evidence.js';
import { getItineraryDayRoutes } from './itinerary-routes.js';
import { ItineraryNotFoundError } from './itineraries.js';
import {
  DEFAULT_DAY_START_MINUTE,
  SUGGESTED_TIME_ROUNDING_MINUTES,
  suggestItemStart,
  type SuggestedTimeResult,
} from './itinerary-time-suggestions-rules.js';
import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import { loadPlaceEvidence } from './plan-score.js';
import type { PlanScoreFixedCommitment } from './plan-score-factors.js';

/**
 * Suggested start times for one itinerary day (PRD section 29.4).
 *
 * Reads the same evidence Plan Score does, through the same shared mappers, and
 * hands it to the pure planner. Day-scoped because the route lookup is a
 * whole-day call: a per-item endpoint would pay for it identically.
 */

export type ItineraryDayTimeSuggestion = {
  itemId: string;
  /** Day-local `HH:MM`, matching how `localStartTime` is stored and edited. */
  localTime: string | null;
} & SuggestedTimeResult;

export type ItineraryDayTimeSuggestions = {
  generatedAt: string;
  itineraryDayId: string;
  suggestions: ItineraryDayTimeSuggestion[];
};

function toLocalTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The timing the caller is showing the traveller right now, which may not be
 * what is stored: the editor asks for a suggestion while an unsaved daypart is
 * on screen. Without this the answer could contradict the choice they are
 * looking at — picking Morning and being handed an afternoon.
 */
export type RequestedSchedule = 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';

const REQUESTED_DAY_PARTS: Record<RequestedSchedule, string | null> = {
  afternoon: 'AFTERNOON',
  // Anytime, an exact time and no time all leave the day unconstrained.
  anytime: null,
  evening: 'EVENING',
  exact: null,
  morning: 'MORNING',
  none: null,
};

export async function getItineraryDayTimeSuggestions(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  options: { itemId?: string; schedule?: RequestedSchedule } = {},
  services: { placesService?: PlacesService | null } = {},
): Promise<ItineraryDayTimeSuggestions> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      itineraryDays: {
        where: { id: itineraryDayId },
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { _count: { select: { reservations: true } } },
          },
        },
      },
      reservations: {
        select: {
          flightArrivalLocalDate: true,
          flightArrivalLocalTime: true,
          flightDepartureLocalDate: true,
          flightDepartureLocalTime: true,
          id: true,
        },
      },
      tripPlaces: {
        select: { id: true, place: { select: { providerRefs: true } } },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const day = trip.itineraryDays[0];
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');

  const date = toLocalDate(day.date);
  const placesService =
    services.placesService === undefined ? createPlacesService() : services.placesService;
  // Only the places this day actually schedules: loadPlaceEvidence fans out one
  // provider request per entry, so a trip-wide list would bill for the whole trip.
  const dayTripPlaceIds = new Set(
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );

  const [routes, placeEvidence] = await Promise.all([
    getItineraryDayRoutes(userId, tripId, day.id),
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((tripPlace) => dayTripPlaceIds.has(tripPlace.id))
        .map((tripPlace) => ({
          externalPlaceId:
            tripPlace.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: tripPlace.id,
        })),
      placesService,
    ),
  ]);

  const commitments: PlanScoreFixedCommitment[] = trip.reservations.flatMap((reservation) => {
    const commitment = sameDayJourneyCommitment(reservation);
    if (!commitment || commitment.date !== date) return [];
    return [
      {
        endMinute: commitment.endMinute,
        id: commitment.id,
        source: 'USER_OWNED' as const,
        startMinute: commitment.startMinute,
      },
    ];
  });

  const items = toDayEvidenceItems(
    {
      commitments: [],
      date,
      id: day.id,
      items: day.items.map((item) => {
        // A caller-supplied schedule replaces what is stored for the target
        // only. The stored start goes with it: an item being moved to Morning
        // is no longer pinned to the time it used to hold, and leaving it would
        // suppress the window. Other items keep their stored timing, since they
        // are what the target has to fit around.
        const overridden = options.schedule !== undefined && item.id === options.itemId;

        return {
          dayPart: overridden ? REQUESTED_DAY_PARTS[options.schedule!] : item.dayPart,
          durationMinutes: item.durationMinutes,
          id: item.id,
          localStartTime: overridden ? null : item.localStartTime,
          reservationCount: item._count.reservations,
          startInstant: overridden ? null : item.startInstant,
          timeSemantics: item.timeSemantics,
          timeZone: item.timeZone,
          tripPlaceId: item.tripPlaceId,
        };
      }),
      timeZone: day.defaultTimeZone,
    },
    routes,
    placeEvidence.hours,
  );

  // An item the traveller already gave an exact time is not asking for one, so
  // it is only suggested for when explicitly named.
  const targets = items.filter((item) =>
    options.itemId ? item.id === options.itemId : item.start === null,
  );

  return {
    generatedAt: new Date().toISOString(),
    itineraryDayId: day.id,
    suggestions: targets.map((target) => {
      const result = suggestItemStart({
        commitments,
        dayStartMinute: DEFAULT_DAY_START_MINUTE,
        items,
        roundingMinutes: SUGGESTED_TIME_ROUNDING_MINUTES,
        targetItemId: target.id,
      });

      return {
        ...result,
        itemId: target.id,
        localTime: result.status === 'ok' ? toLocalTime(result.startMinute) : null,
      };
    }),
  };
}
