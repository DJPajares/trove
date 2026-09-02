import type { AiPlannerDraft } from '@trove/types';

type PlaceReferencingDraft = Pick<AiPlannerDraft, 'days' | 'trip' | 'unscheduledItems'>;

type ReferencedPlaceOptions = {
  /** Trip destinations become TripDestination rows, so apply always needs them. */
  includeDestinations?: boolean;
  /**
   * Unscheduled items are referenced by the draft but are not part of the
   * day-to-day itinerary. Apply still materializes them; grounding deliberately
   * does not pay for them.
   */
  includeUnscheduled?: boolean;
};

/**
 * The place references a draft actually uses. Grounding and apply want different
 * slices of the same traversal, so the slice is a parameter rather than a second
 * copy of the walk.
 */
export function referencedDraftPlaceIds(
  draft: PlaceReferencingDraft,
  options: ReferencedPlaceOptions = {},
) {
  const ids = new Set<string>();
  if (options.includeDestinations) {
    for (const destination of draft.trip.destinations) ids.add(destination.placeRefId);
  }
  for (const day of draft.days) {
    if (day.dailyBasePlaceRefId) ids.add(day.dailyBasePlaceRefId);
    if (day.dailyBaseDeparturePlaceRefId) ids.add(day.dailyBaseDeparturePlaceRefId);
    for (const item of day.items) if (item.placeRefId) ids.add(item.placeRefId);
  }
  if (options.includeUnscheduled) {
    for (const item of draft.unscheduledItems) if (item.placeRefId) ids.add(item.placeRefId);
  }
  return ids;
}

/**
 * The places a finished generate run should look up: everything standing in the
 * day-to-day itinerary, plus the destinations apply needs. A place the model
 * proposed and the schedule dropped never reaches Google.
 */
export function groundableDraftPlaceIds(draft: PlaceReferencingDraft) {
  return referencedDraftPlaceIds(draft, { includeDestinations: true, includeUnscheduled: false });
}
