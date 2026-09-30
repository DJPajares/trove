import { getPrismaClient } from '@trove/db';

import type { ItineraryRouteSegment } from './itinerary-route-reader.js';
import { formatInstantInTimeZone } from './itinerary-rules.js';
import { ItineraryNotFoundError, itemSortMinute, timedInsertIndex } from './itineraries.js';
import {
  DEFAULT_DAY_START_MINUTE,
  SUGGESTED_TIME_ROUNDING_MINUTES,
  suggestItemStart,
  type SuggestedTimeResult,
  type SuggestedTimeWindow,
} from './itinerary-time-suggestions-rules.js';
import { inferDurations } from './plan-score-estimates.js';
import { placeProfile } from './plan-score-place-types.js';
import {
  buildScoringDay,
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
  tripLegCalibration,
  type PlanScoreTripRecord,
} from './plan-score.js';
import { readCachedRoute } from './route-evidence-cache.js';
import { cachedPlaceResolver, readScoringRoutes } from './scoring-evidence.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';

/**
 * Suggested start times for one itinerary day (PRD section 29.4).
 *
 * Reads the day exactly as Plan Score does, through the same cache-only
 * assembly: stored itinerary rows, cached or distance-estimated travel, stored
 * place evidence with date-aware opening hours, every reservation, and the
 * day's availability. Nothing here reaches a provider - a suggestion is never a
 * reason to buy a route or a place lookup - so what it knows is whatever normal
 * planning has already stored.
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

/**
 * A stop being added that has no id yet. It sits where saving would put it: by
 * its daypart among the day's timed stops, otherwise at the end of the day.
 */
export type CandidateStop = { durationMinutes: number | null; tripPlaceId: string | null };

/** The id a not-yet-saved stop answers under. */
export const CANDIDATE_ITEM_ID = 'candidate';

const toRouteMode = (value: string | null | undefined) =>
  (value ?? 'DRIVE').toLowerCase() as ItineraryRouteSegment['mode'];

export async function getItineraryDayTimeSuggestions(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  options: { candidate?: CandidateStop; itemId?: string; schedule?: RequestedSchedule } = {},
  services: { now?: Date } = {},
): Promise<ItineraryDayTimeSuggestions> {
  const now = services.now ?? new Date();
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const dayRow = trip.itineraryDays.find((day) => day.id === itineraryDayId);
  const dayRecord = readPlanScoreInputs(trip, now).days.find((day) => day.id === itineraryDayId);
  if (!dayRow || !dayRecord) throw new ItineraryNotFoundError('itinerary_day_not_found');

  // A place that is not this trip's is simply not known here: evidence is only
  // ever read for the trip's own places, so the stop is treated as unplaced.
  const candidate = options.candidate && {
    ...options.candidate,
    tripPlaceId: trip.tripPlaces.some((row) => row.id === options.candidate?.tripPlaceId)
      ? options.candidate.tripPlaceId
      : null,
  };

  const requestedDayPart = options.schedule ? REQUESTED_DAY_PARTS[options.schedule] : undefined;
  const targetId = candidate ? CANDIDATE_ITEM_ID : options.itemId;
  const sortMinute = requestedDayPart
    ? itemSortMinute({ dayPart: requestedDayPart, localStartTime: null })
    : null;
  const candidateIndex =
    sortMinute === null ? dayRow.items.length : timedInsertIndex(dayRow.items, sortMinute);
  const storedItems = dayRecord.items.map((item) =>
    // A caller-supplied schedule replaces what is stored for the target only.
    // The stored start goes with it: an item being moved to Morning is no
    // longer pinned to the time it used to hold. Other items keep their
    // stored timing, since they are what the target has to fit around.
    requestedDayPart !== undefined && item.id === targetId
      ? {
          ...item,
          dayPart: requestedDayPart,
          localStartTime: null,
          startInstant: null,
          timeProvenance: null,
        }
      : item,
  );
  const day = {
    ...dayRecord,
    items: [
      ...storedItems.slice(0, candidateIndex),
      ...(candidate
        ? [
            {
              blockType: null,
              dayPart: requestedDayPart ?? null,
              durationMinutes: candidate.durationMinutes,
              durationProvenance: 'USER_OWNED',
              id: CANDIDATE_ITEM_ID,
              localStartTime: null,
              reservationCount: 0,
              startInstant: null,
              timeSemantics: null,
              timeProvenance: null,
              timeZone: null,
              tripPlaceId: candidate.tripPlaceId,
            },
          ]
        : []),
      ...storedItems.slice(candidateIndex),
    ],
  };

  const placeIds = new Set(
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );
  const [storedRoutes, evidence] = await Promise.all([
    readScoringRoutes(userId, tripId, itineraryDayId, now, cachedPlaceResolver(now)),
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((row) => placeIds.has(row.id))
        .map((row) => ({
          externalPlaceId:
            row.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: row.id,
        })),
      now,
    ),
  ]);
  for (const row of trip.tripPlaces) {
    const merged = mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now);
    evidence.places.set(row.id, merged.place);
    const hours = evidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);

  // The new stop's leg runs from the stop before it (or the day's stay): a
  // stored route when one was ever measured, otherwise the distance estimate
  // every unrouted leg gets.
  const routes = { ...storedRoutes, segments: [...storedRoutes.segments] };
  if (candidate) {
    const lastRow = candidateIndex > 0 ? dayRow.items[candidateIndex - 1] : undefined;
    const origin = lastRow
      ? { id: lastRow.id, kind: 'itinerary_item' as const, label: null }
      : dayRow.dailyBaseTripPlaceId
        ? { id: dayRow.dailyBaseTripPlaceId, kind: 'daily_base' as const, label: null }
        : null;
    if (origin) {
      const mode = toRouteMode(lastRow ? lastRow.travelModeToNext : dayRow.routeStartTravelMode);
      const from = evidence.places.get(lastRow?.tripPlaceId ?? origin.id)?.coordinates;
      const to = candidate.tripPlaceId
        ? evidence.places.get(candidate.tripPlaceId)?.coordinates
        : null;
      const cached =
        from && to && mode !== 'flight'
          ? await readCachedRoute({ origin: from, destination: to, mode }, now)
          : null;
      const routed = cached?.kind === 'hit' && cached.result.status === 'ok' ? cached.result : null;
      routes.segments.push({
        destination: { id: CANDIDATE_ITEM_ID, kind: 'itinerary_item', label: null },
        distanceMeters: routed?.estimate.distanceMeters ?? null,
        durationSeconds: routed?.estimate.durationSeconds ?? null,
        encodedPolyline: null,
        ...(routed ? { evidenceAsOf: routed.freshness.fetchedAt } : {}),
        id: `${origin.kind}:${origin.id}:itinerary_item:${CANDIDATE_ITEM_ID}`,
        mode,
        modeOwner: { id: origin.id, kind: lastRow ? 'item_departure' : 'day_start' },
        origin,
        provider: routed ? 'google' : null,
        reason: null,
        scope: mode === 'flight' ? 'long_distance' : 'local',
        status: routed ? 'ok' : 'unavailable',
      });
    }
  }

  const record: PlanScoreTripRecord = {
    days: [day],
    hours: evidence.hours,
    mustGoTripPlaceIds: [],
    places: evidence.places,
    preferences: trip.planningPreferences,
    ratings: evidence.ratings,
    routes: new Map([[day.id, routes]]),
  };
  const scoring = buildScoringDay(day, record, tripLegCalibration(record));

  // Stops without a stated length take the typical length for their kind of
  // place, so one unknown duration no longer stops the day's timing chain.
  const typeOf = (placeId: string | undefined) =>
    placeProfile(placeId ? evidence.places.get(placeId)?.types : null);
  const inferred = inferDurations(
    scoring.items,
    (item) => typeOf(item.placeId)?.visit?.typical ?? null,
  );
  const inferredDurations = new Set(
    inferred.items.flatMap((item, index) =>
      item.duration && !scoring.items[index]?.duration ? [item.id] : [],
    ),
  );

  const targets = inferred.items.filter((item) =>
    targetId
      ? item.id === targetId
      : // An item the traveller already gave an exact time is not asking for one.
        item.start === null,
  );

  return {
    generatedAt: now.toISOString(),
    itineraryDayId: day.id,
    suggestions: targets.map((target) => {
      const profile = typeOf(target.placeId);
      // When a kind of place suits a visit - dinner in the evening, a bar after
      // dark - is preferred; known opening hours already decide access, so a
      // daytime stand-in only helps where the hours are unknown.
      const preferredWindows: SuggestedTimeWindow[] | null =
        profile && Array.isArray(profile.windows)
          ? profile.windowKind === 'EXPERIENCE' || target.openingHours.status !== 'KNOWN'
            ? [...(profile.windows as SuggestedTimeWindow[])]
            : null
          : null;
      const result = suggestItemStart({
        availability: scoring.availability,
        // A reservation linked to this stop is the stop itself, not something in its way.
        commitments: scoring.commitments.filter((commitment) => commitment.itemId !== target.id),
        dayStartMinute: DEFAULT_DAY_START_MINUTE,
        inferredDurations,
        items: inferred.items,
        preferredWindows,
        roundingMinutes: SUGGESTED_TIME_ROUNDING_MINUTES,
        targetItemId: target.id,
      });

      // A plan with no place has no opening hours to be missing.
      if (result.status === 'ok' && !target.placeId)
        result.caveats = result.caveats.filter((caveat) => caveat !== 'OPENING_HOURS_UNKNOWN');

      return {
        ...result,
        itemId: target.id,
        // Minutes are counted from the day's own midnight, so the wall-clock time
        // comes from the day's zone, correct across a daylight-saving change.
        localTime:
          result.status === 'ok'
            ? formatInstantInTimeZone(
                new Date(scoring.origin + result.startMinute * 60_000),
                day.timeZone,
              ).time
            : null,
      };
    }),
  };
}
