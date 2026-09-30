import { getPrismaClient } from '@trove/db';

import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { placeHoursStatus } from './place-hours-status.js';
import { placeProfile } from './plan-score-place-types.js';
import {
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
} from './plan-score.js';
import { readTripContext } from './trip-context.js';

/**
 * Stops whose opening hours are worth a word on the day they are planned:
 * published special hours for that date, or a public holiday at a kind of
 * place that often closes or shortens hours on one. Read from stored evidence
 * and the bundled holiday dataset only; nothing is fetched, and Insights never
 * changes the Plan Score (PRD 29.7).
 */

export type PlaceHoursNotice =
  | {
      asOf: string;
      date: string;
      dayId: string;
      kind: 'special_hours';
      name: string;
      spans: Array<{ close: string; open: string }>;
      tripPlaceId: string;
    }
  | {
      date: string;
      dayId: string;
      holidayCertainty: 'expected' | 'official';
      holidayName: string;
      kind: 'holiday_check';
      name: string;
      tripPlaceId: string;
    };

export async function getPlaceHoursNotices(
  userId: string,
  tripId: string,
  services: { now?: Date } = {},
): Promise<{ generatedAt: string; notices: PlaceHoursNotice[] }> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const days = readPlanScoreInputs(trip, now).days;
  const scheduled = new Set(
    days.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  );
  const [evidence, context] = await Promise.all([
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((row) => scheduled.has(row.id))
        .map((row) => ({
          externalPlaceId:
            row.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: row.id,
        })),
      now,
    ),
    // Holidays come from the bundled dataset; nothing is fetched to find them.
    readTripContext(userId, tripId, { allowFetch: false, now, source: 'trip-context' }).catch(
      () => null,
    ),
  ]);
  const identity = new Map(
    trip.tripPlaces.map((row) => [
      row.id,
      mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now).place,
    ]),
  );
  for (const [id, hours] of evidence.hours) {
    const coordinates = identity.get(id)?.coordinates;
    if (!hours.timeZone && coordinates) hours.timeZone = timeZoneAtCoordinates(coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);

  const holidayByDay = new Map<string, { certainty: 'expected' | 'official'; name: string }>();
  for (const holiday of context?.holidays ?? []) {
    for (const dayId of holiday.dayIds) {
      if (!holidayByDay.has(dayId))
        holidayByDay.set(dayId, {
          certainty: holiday.certainty === 'expected' ? 'expected' : 'official',
          name: holiday.name,
        });
    }
  }

  const notices: PlaceHoursNotice[] = [];
  for (const day of days) {
    const seen = new Set<string>();
    for (const item of day.items) {
      const id = item.tripPlaceId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const place = identity.get(id);
      const name = place?.name?.trim();
      if (!name) continue;

      const hours = evidence.hours.get(id);
      const status = hours
        ? placeHoursStatus({ date: day.date, hours, zone: trip.referenceTimeZone ?? 'UTC' })
        : null;
      if (status?.status === 'open' && status.special) {
        notices.push({
          asOf: status.asOf,
          date: day.date,
          dayId: day.id,
          kind: 'special_hours',
          name,
          spans: status.spans,
          tripPlaceId: id,
        });
        continue;
      }

      // Published hours for the date already answer the question a holiday raises.
      const holiday = holidayByDay.get(day.id);
      if (holiday && placeProfile(place?.types)?.holidaySensitive) {
        notices.push({
          date: day.date,
          dayId: day.id,
          holidayCertainty: holiday.certainty,
          holidayName: holiday.name,
          kind: 'holiday_check',
          name,
          tripPlaceId: id,
        });
      }
    }
  }

  return { generatedAt: now.toISOString(), notices };
}
