import { createHash } from 'node:crypto';
import { resolveDestinationContext, destinationContextRevision } from './destination-context.js';
import { planningPreferencesFromAi } from '@trove/types';
import type { AiPlannerDraft } from '@trove/types';
import { readPlanScoreInputs, type PlanScoreTripRows, type TripPlanScore } from './plan-score.js';
import { PLAN_SCORE_CONTRACT_VERSION } from './plan-score-rules.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { floatingLocalTimeToInstant, parseLocalTime } from './itinerary-rules.js';
import { parseDateOnly, resolveCountryPrimaryTimeZone } from './trip-rules.js';

/** Binds an assessment to the final itinerary, not mutable review copy. */
export function draftDestinationContext(draft: AiPlannerDraft, now: Date) {
  const placeById = new Map(
    draft.places.map((place) => [
      place.id,
      {
        name: place.name,
        coordinates: place.resolution === 'verified' ? place.location : null,
      },
    ]),
  );
  return resolveDestinationContext(
    {
      startDate: draft.trip.startDate,
      endDate: draft.trip.endDate,
      preferences: planningPreferencesFromAi(
        draft.normalizedRequest,
        draft.trip.paceSource === 'user',
        draft.assumptions.some((assumption) => assumption.code === 'interest_inferred'),
      ),
      destinations: draft.trip.destinations.flatMap((destination) =>
        placeById.has(destination.placeRefId) ? [placeById.get(destination.placeRefId)!] : [],
      ),
      days: draft.days.map((day) => ({
        id: day.date,
        date: day.date,
        places: [
          day.dailyBasePlaceRefId,
          day.dailyBaseDeparturePlaceRefId,
          ...day.items.map((item) => item.placeRefId),
        ].flatMap((id) => (id && placeById.has(id) ? [placeById.get(id)!] : [])),
      })),
    },
    now,
  );
}

export function draftPlanScoreInputRevision(draft: AiPlannerDraft, now = new Date()): string {
  const payload = {
    version: 3,
    destinationContext: destinationContextRevision(draftDestinationContext(draft, now)),
    preferences: {
      pace: draft.trip.pace,
      paceSource: draft.trip.paceSource,
      interests: draft.normalizedRequest.interests,
    },
    rubric: PLAN_SCORE_CONTRACT_VERSION,
    dates: [draft.trip.startDate, draft.trip.endDate],
    destinations: draft.trip.destinations.map(({ placeRefId }) => placeRefId),
    places: draft.places
      .map((place) => ({
        id: place.id,
        name: place.name,
        placeId: place.resolution === 'verified' ? place.placeId : null,
        location: place.resolution === 'verified' ? (place.location ?? null) : null,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    days: draft.days.map((day) => ({
      date: day.date,
      dailyBase: day.dailyBasePlaceRefId,
      departureBase: day.dailyBaseDeparturePlaceRefId,
      items: day.items.map((item) => ({
        id: item.id,
        place: item.placeRefId,
        duration: item.durationMinutes,
        durationProvenance: item.durationProvenance,
        schedule:
          item.schedule.kind === 'exact'
            ? [item.schedule.kind, item.schedule.localTime, item.schedule.source]
            : [item.schedule.kind, item.schedule.dayPart],
        priority: item.priority,
      })),
    })),
    unscheduled: draft.unscheduledItems.map(({ placeRefId, priority }) => ({
      placeRefId,
      priority,
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/**
 * Compare the ordinary scorer's complete input reading to the expected rows.
 * Only IDs may change. Unknown timezone context or merged place aliases cannot
 * prove equivalence, so those cases defer to ordinary demand-driven scoring.
 */
export function appliedDraftScoreInputsMatch(
  draft: AiPlannerDraft,
  rows: PlanScoreTripRows,
  identity: DraftPlanScoreIdentityMap,
  now = new Date(),
): boolean {
  const zones = new Map(
    draft.places.map((place) => [
      place.id,
      (place.resolution === 'verified' && place.location
        ? timeZoneAtCoordinates(place.location)
        : null) ?? resolveCountryPrimaryTimeZone(place.name),
    ]),
  );
  const referenceZone = draft.trip.destinations
    .map(({ placeRefId }) => zones.get(placeRefId))
    .find(Boolean);
  const ref = (value: string | null) =>
    value ? (identity.tripPlaceIdByPlaceRefId.get(value) ?? null) : null;
  const allItems = [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems];
  const expectedPlaces = [...identity.tripPlaceIdByPlaceRefId].map(([placeRef, id]) => {
    const place = draft.places.find((entry) => entry.id === placeRef);
    const items = allItems.filter((item) => item.placeRefId === placeRef);
    return {
      id,
      place: rows.tripPlaces.find((entry) => entry.id === id)?.place,
      placeId:
        place?.resolution === 'verified'
          ? place.placeId
          : rows.tripPlaces.find((p) => p.id === id)?.placeId,
      priority: items.some((item) => item.priority === 'must_go') ? 'MUST_GO' : null,
    };
  });
  if (new Set(expectedPlaces.map(({ id }) => id)).size !== expectedPlaces.length) return false;
  if (expectedPlaces.some(({ placeId }) => !placeId)) return false;

  const expectedDays: PlanScoreTripRows['itineraryDays'] = [];
  for (const day of draft.days) {
    const zone =
      (day.dailyBasePlaceRefId ? zones.get(day.dailyBasePlaceRefId) : null) ??
      day.items
        .map((item) => (item.placeRefId ? zones.get(item.placeRefId) : null))
        .find(Boolean) ??
      referenceZone;
    const dayId = identity.dayIdByDate.get(day.date);
    if (!zone || !dayId) return false;
    const actualDay = rows.itineraryDays.find((entry) => entry.id === dayId);
    if (actualDay?.defaultTimeZone !== zone) return false;
    const items: PlanScoreTripRows['itineraryDays'][number]['items'] = [];
    for (const [position, item] of day.items.entries()) {
      const id = identity.itemIdByDraftId.get(item.id);
      if (!id || (item.placeRefId && !ref(item.placeRefId))) return false;
      const itemZone = (item.placeRefId ? zones.get(item.placeRefId) : null) ?? zone;
      if (actualDay.items.find((entry) => entry.id === id)?.timeZone !== itemZone) return false;
      const exact = item.schedule.kind === 'exact' ? item.schedule.localTime : null;
      items.push({
        _count: { reservations: 0 },
        dayPart: item.schedule.kind === 'day_part' ? item.schedule.dayPart.toUpperCase() : null,
        durationMinutes: item.durationMinutes,
        durationProvenance: item.durationProvenance.toUpperCase(),
        id,
        localStartTime: exact ? parseLocalTime(exact) : null,
        position,
        startInstant: exact ? floatingLocalTimeToInstant(day.date, exact, itemZone) : null,
        timeSemantics: exact ? 'FLOATING_LOCAL' : null,
        timeProvenance: exact
          ? item.schedule.kind === 'exact' && item.schedule.source === 'model'
            ? 'AI_ESTIMATED'
            : 'USER_OWNED'
          : null,
        timeZone: itemZone,
        travelModeToNext: 'DRIVE',
        tripPlaceId: ref(item.placeRefId),
      });
    }
    expectedDays.push({
      dailyBaseDepartureTripPlaceId: ref(day.dailyBaseDeparturePlaceRefId),
      dailyBaseTripPlaceId: ref(day.dailyBasePlaceRefId),
      date: parseDateOnly(day.date),
      defaultTimeZone: zone,
      id: dayId,
      items,
      routeStartTravelMode: 'DRIVE',
    });
  }
  return (
    readPlanScoreInputs(rows, now).revision ===
    readPlanScoreInputs(
      {
        planningPreferences: planningPreferencesFromAi(
          draft.normalizedRequest,
          draft.trip.paceSource === 'user',
          draft.assumptions.some((assumption) => assumption.code === 'interest_inferred'),
        ),
        endDate: rows.endDate,
        destinations: rows.destinations,
        startDate: parseDateOnly(draft.trip.startDate),
        startingPlaceId: null,
        itineraryDays: expectedDays,
        reservations: [],
        tripPlaces: expectedPlaces,
      },
      now,
    ).revision
  );
}

export type DraftPlanScoreIdentityMap = {
  /** Draft day date to the itinerary day it became. */
  dayIdByDate: ReadonlyMap<string, string>;
  /** Draft item id to the itinerary item it became. */
  itemIdByDraftId: ReadonlyMap<string, string>;
  /** Draft place reference to the Trip Place it became. */
  tripPlaceIdByPlaceRefId: ReadonlyMap<string, string>;
};

/**
 * A draft scores against its own identifiers: days are dates, and places are
 * draft references. The applied trip has neither, and the itinerary panel picks
 * its day by `dayId` and focuses a suggestion by its reference, so an unmapped
 * score would render as a day that does not exist and suggestions that go
 * nowhere. Rewrite the identifiers rather than paying to compute the same
 * judgement again.
 *
 * An identifier with no mapping is left as it was: it is either already a trip
 * identifier or an evidence reference that names no row, and inventing one
 * would be worse than a reference the panel simply cannot resolve.
 */
export function remapDraftPlanScore(
  planScore: TripPlanScore,
  identity: DraftPlanScoreIdentityMap,
): TripPlanScore {
  const reference = (value: string) =>
    identity.itemIdByDraftId.get(value) ??
    identity.tripPlaceIdByPlaceRefId.get(value) ??
    identity.dayIdByDate.get(value) ??
    value;

  const explanations = (groups: TripPlanScore['explanations']) => ({
    uncertainty: groups.uncertainty.map((entry) => ({
      ...entry,
      references: entry.references.map(reference),
    })),
    whatWorks: groups.whatWorks.map((entry) => ({
      ...entry,
      references: entry.references.map(reference),
    })),
    worthImproving: groups.worthImproving.map((entry) => ({
      ...entry,
      references: entry.references.map(reference),
    })),
  });

  return {
    ...planScore,
    caps: planScore.caps.map((cap) => ({ ...cap, references: cap.references.map(reference) })),
    days: planScore.days.map((day) => ({
      ...day,
      dayId: identity.dayIdByDate.get(day.date) ?? day.dayId,
      caps: day.caps.map((cap) => ({ ...cap, references: cap.references.map(reference) })),
      explanations: explanations(day.explanations),
    })),
    explanations: explanations(planScore.explanations),
  };
}
