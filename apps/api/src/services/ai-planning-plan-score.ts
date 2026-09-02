import type { TripPlanScore } from './plan-score.js';

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
    identity.itemIdByDraftId.get(value) ?? identity.tripPlaceIdByPlaceRefId.get(value) ?? value;

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
    days: planScore.days.map((day) => ({
      ...day,
      dayId: identity.dayIdByDate.get(day.date) ?? day.dayId,
      explanations: explanations(day.explanations),
    })),
    explanations: explanations(planScore.explanations),
  };
}
