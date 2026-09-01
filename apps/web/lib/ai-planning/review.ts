import type { ItineraryMapPoint } from '@/lib/maps/itinerary-map';

import type { AiPlanningDraft, AiPlanningDraftItem, AiPlanningSession } from './api';

export type AiPlanningReviewPageState = 'error' | 'loading' | 'redirecting' | 'reviewing';

export function aiPlanningReviewPageState(
  session: AiPlanningSession | null,
  draft: AiPlanningDraft | null,
  queryPending: boolean,
): AiPlanningReviewPageState {
  if (queryPending) return 'loading';
  if (!session) return 'error';
  if (session.appliedTripId || session.status === 'applied') return 'redirecting';
  if (session.status === 'pending' || session.status === 'generating') {
    return draft ? 'reviewing' : 'loading';
  }
  if (session.status !== 'reviewing') return 'error';
  return draft ? 'reviewing' : 'loading';
}

export function aiPlanningAssumptionMessageValues(
  assumption: AiPlanningDraft['assumptions'][number],
  draft: AiPlanningDraft,
  locale: string,
) {
  const listFormatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  const inferredValues = Array.isArray(assumption.value)
    ? assumption.value
    : assumption.value === null
      ? []
      : [String(assumption.value)];

  const assumedDates = assumption.code === 'dates_defaulted' ? inferredValues : [];

  return {
    count:
      assumption.code === 'party_size_defaulted' && typeof assumption.value === 'number'
        ? assumption.value
        : draft.trip.partySize,
    endDate: assumedDates[1] ?? draft.trip.endDate,
    name:
      assumption.code === 'trip_name_inferred' && typeof assumption.value === 'string'
        ? assumption.value
        : draft.trip.name,
    pace:
      assumption.code === 'pace_defaulted' && typeof assumption.value === 'string'
        ? assumption.value
        : draft.trip.pace,
    startDate: assumedDates[0] ?? draft.trip.startDate,
    value: inferredValues.length ? listFormatter.format(inferredValues) : '',
  };
}

export function activeAiPlanningAssumptions(draft: AiPlanningDraft) {
  const activeIds = new Set(
    [
      draft.trip.dateAssumptionId,
      draft.trip.nameAssumptionId,
      draft.trip.paceAssumptionId,
      draft.trip.partySizeAssumptionId,
      ...draft.trip.destinations.map((destination) => destination.assumptionId),
    ].filter((id): id is string => Boolean(id)),
  );

  return draft.assumptions.filter(
    (assumption) => assumption.code === 'interest_inferred' || activeIds.has(assumption.id),
  );
}

/**
 * A review draft can contain free-text Custom Places. Only a verified provider
 * identity with provider-supplied coordinates earns a map marker, so the map
 * never turns a guessed or traveller-entered place into a false location.
 */
export function buildAiPlanningReviewMapPoints(draft: AiPlanningDraft): ItineraryMapPoint[] {
  const itemByPlace = new Map<string, { item: AiPlanningDraftItem; order: number }>();
  let order = 1;
  for (const item of [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems]) {
    if (item.placeRefId && !itemByPlace.has(item.placeRefId)) {
      itemByPlace.set(item.placeRefId, { item, order });
    }
    order += 1;
  }

  return draft.places.flatMap((place) => {
    if (place.resolution !== 'verified' || !place.location) return [];
    const entry = itemByPlace.get(place.id);
    return [
      {
        id: place.id,
        itemId: entry?.item.id ?? null,
        kind: entry ? 'scheduled' : 'considered',
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        name: place.name,
        order: entry?.order ?? null,
        tripPlaceId: place.id,
      } satisfies ItineraryMapPoint,
    ];
  });
}

/**
 * Mirrors what Apply just committed on the server: the session is applied, its
 * draft is gone, and the warning acknowledgement went with it. Writing this into
 * the session cache before navigating keeps the review page from rendering a
 * draft the server no longer holds.
 */
export function appliedAiPlanningSession(
  session: AiPlanningSession,
  tripId: string,
): AiPlanningSession {
  return {
    ...session,
    appliedTripId: tripId,
    draft: null,
    stage: 'complete',
    status: 'applied',
    warningAcknowledgement: null,
  };
}

/**
 * The other half of the contract `appliedAiPlanningSession` starts. Apply empties
 * the recovery cache, and the app-wide lifecycle mirrors that cache into state so
 * the takeover can hold a session the server has not reported yet.
 *
 * A mirror is allowed to run *ahead* of recovery — a run it started itself is live
 * here first. It must never outlive one recovery has let go of: a `reviewing`
 * session left behind after Apply pins the traveller back to the draft on the very
 * navigation Apply just made, and the review screen's own `appliedTripId` redirect
 * sends them straight back. That fight is an endless loop, and it has shipped twice.
 */
export function releasesMirroredAiPlanningSession(
  current: AiPlanningSession | null,
  previousRecoveredId: string | null,
  recoveredId: string | null,
) {
  return Boolean(previousRecoveredId) && !recoveredId && current?.id === previousRecoveredId;
}
