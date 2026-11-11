import type { ItineraryDay } from './api';
import { sameTown } from './day-place';
import { resolveDailyBases } from './day-sequence';
import type { PlannerDay } from './planner-days';

/**
 * A run of consecutive days spent from one place: the trip as it is lived,
 * a few nights here and then a few there.
 *
 * - `stay`: days that end at the same Stay - a hotel for three nights.
 * - `town`: days with no Stay to go on that happen in the same town.
 * - `days`: days that say nothing about where they are, kept together.
 */
export type StayChapter = {
  days: PlannerDay[];
  key: string;
  kind: 'days' | 'stay' | 'town';
  /** The Stay the chapter's nights are spent at, for a `stay` chapter. */
  stayTripPlaceId: string | null;
  town: string | null;
};

/**
 * The trip's days grouped into chapters by where the traveller sleeps.
 *
 * A day belongs with the Stay it ends at - the night is what a stay is - read
 * the same way the day's own page reads it: a Stay set by hand first, then the
 * one a booking decided. Only consecutive days share a chapter, so coming back
 * to a hotel later in the trip is a chapter of its own, in the order it was
 * lived. Days without a Stay fall back to their town, and days with neither
 * join the town beside them, or are kept in one run when there is none.
 */
export function stayChapters(input: {
  days: readonly ItineraryDay[];
  plannerDays: readonly PlannerDay[];
}): StayChapter[] {
  const chapters: StayChapter[] = [];

  input.days.forEach((day, index) => {
    const plannerDay = input.plannerDays[index];
    if (!plannerDay) return;
    const stayTripPlaceId = resolveDailyBases({ day }).departureTripPlaceId;
    const kind: StayChapter['kind'] = stayTripPlaceId ? 'stay' : plannerDay.town ? 'town' : 'days';
    const previous = chapters.at(-1);
    const continues =
      previous?.kind === kind &&
      (kind === 'stay'
        ? previous.stayTripPlaceId === stayTripPlaceId
        : kind === 'town'
          ? sameTown(previous.town, plannerDay.town)
          : true);

    if (previous && continues) {
      previous.days.push(plannerDay);
      return;
    }
    chapters.push({
      days: [plannerDay],
      key: `${kind}-${day.id}`,
      kind,
      stayTripPlaceId,
      town: plannerDay.town,
    });
  });

  // A day that says nothing about where it is belongs with the town beside it,
  // the way the trip's journey reads it: with the town before it, or, at the
  // start of the trip, the one after. Next to a Stay it stays apart, because a
  // Stay chapter is its nights and nothing says this day was one of them.
  return chapters.reduce<StayChapter[]>((merged, chapter) => {
    const previous = merged.at(-1);
    if (chapter.kind === 'days' && previous?.kind === 'town') {
      previous.days.push(...chapter.days);
    } else if (chapter.kind === 'town' && previous?.kind === 'days' && merged.length === 1) {
      merged[0] = { ...chapter, days: [...previous.days, ...chapter.days], key: previous.key };
    } else {
      merged.push(chapter);
    }
    return merged;
  }, []);
}
