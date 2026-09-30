import { getPrismaClient } from '@trove/db';
import { readDayPlanningContext } from '@trove/types';

import { ItineraryNotFoundError } from './itineraries.js';
import { placeProfile } from './plan-score-place-types.js';
import { haversineKm } from './plan-score-route-comparison.js';
import {
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
} from './plan-score.js';

/**
 * Which day each of a trip's not-yet-planned places fits, by where it is.
 *
 * Only stored coordinates and the itinerary are read, so this never reaches a
 * provider. It suggests; the traveller adds (PRD 29.4).
 */

/** Past this, "near Day 3" stops being true enough to say. */
export const NEARBY_DAY_KM = 3;
/** A day with no availability of its own is assumed to run 08:00 to 22:00. */
const DEFAULT_DAY_MINUTES = 14 * 60;
/** What a visit is assumed to take when neither its stop nor its kind says. */
const FALLBACK_VISIT_MINUTES = 60;

type Coordinates = { latitude: number; longitude: number };

export type GroupingDay = {
  /** Where the day already goes: its located stops and its base. */
  anchors: Coordinates[];
  /** What the traveller has made available, in minutes. */
  availableMinutes: number;
  id: string;
  /** Visits already on the day, in minutes. */
  plannedMinutes: number;
};

export type GroupingPlace = {
  coordinates: Coordinates | null;
  id: string;
  visitMinutes: number;
};

export type PlaceGroup = { addedMinutes: number; dayId: string; tripPlaceIds: string[] };

export function groupPlacesIntoDays(
  places: readonly GroupingPlace[],
  days: readonly GroupingDay[],
): PlaceGroup[] {
  const candidates = places.flatMap((place) => {
    if (!place.coordinates) return [];
    let best: { dayId: string; km: number } | null = null;
    for (const day of days) {
      for (const anchor of day.anchors) {
        const km = haversineKm(place.coordinates, anchor);
        if (km <= NEARBY_DAY_KM && (!best || km < best.km)) best = { dayId: day.id, km };
      }
    }
    return best ? [{ ...best, place }] : [];
  });

  return days.flatMap((day) => {
    let room = day.availableMinutes - day.plannedMinutes;
    let addedMinutes = 0;
    const tripPlaceIds: string[] = [];
    // Closest first, so a full day keeps the places that fit it best.
    for (const candidate of candidates
      .filter((entry) => entry.dayId === day.id)
      .toSorted((a, b) => a.km - b.km)) {
      if (candidate.place.visitMinutes > room) continue;
      room -= candidate.place.visitMinutes;
      addedMinutes += candidate.place.visitMinutes;
      tripPlaceIds.push(candidate.place.id);
    }
    return tripPlaceIds.length ? [{ addedMinutes, dayId: day.id, tripPlaceIds }] : [];
  });
}

function windowMinutes(planningContext: unknown) {
  const availability = readDayPlanningContext(planningContext).availability;
  if (!availability) return DEFAULT_DAY_MINUTES;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return Math.max(0, minutes(availability.end) - minutes(availability.start));
}

export async function getPlaceGroupings(
  userId: string,
  tripId: string,
  services: { now?: Date } = {},
): Promise<{ generatedAt: string; groups: PlaceGroup[] }> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const identity = new Map(
    trip.tripPlaces.map((row) => [
      row.id,
      mergeScoringPlaceIdentity(row.id, row.place, undefined, now).place,
    ]),
  );
  const typical = (tripPlaceId: string | null | undefined) =>
    (tripPlaceId ? placeProfile(identity.get(tripPlaceId)?.types)?.visit?.typical : null) ??
    FALLBACK_VISIT_MINUTES;
  const located = (tripPlaceId: string | null | undefined) =>
    (tripPlaceId ? identity.get(tripPlaceId)?.coordinates : null) ?? null;

  const dayRows = new Map(trip.itineraryDays.map((day) => [day.id, day]));
  const days: GroupingDay[] = readPlanScoreInputs(trip, now).days.map((day) => {
    const base = dayRows.get(day.id)?.dailyBaseTripPlaceId ?? null;
    return {
      anchors: [
        ...day.items.flatMap((item) => {
          const coordinates = located(item.tripPlaceId);
          return coordinates ? [coordinates] : [];
        }),
        ...(located(base) ? [located(base)!] : []),
      ],
      availableMinutes: windowMinutes(day.planningContext),
      id: day.id,
      plannedMinutes: day.items.reduce(
        (sum, item) => sum + (item.durationMinutes ?? typical(item.tripPlaceId)),
        0,
      ),
    };
  });

  const scheduled = new Set(
    trip.itineraryDays.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  );
  const bases = new Set(
    trip.itineraryDays.flatMap((day) =>
      [day.dailyBaseTripPlaceId, day.dailyBaseDepartureTripPlaceId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  );
  const places: GroupingPlace[] = trip.tripPlaces
    .filter((row) => !scheduled.has(row.id) && !bases.has(row.id))
    .map((row) => ({ coordinates: located(row.id), id: row.id, visitMinutes: typical(row.id) }));

  return { generatedAt: now.toISOString(), groups: groupPlacesIntoDays(places, days) };
}
