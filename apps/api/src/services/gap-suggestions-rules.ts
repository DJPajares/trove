import type { PlanScoreDayItem, PlanScoreOpeningHours } from './plan-score-factors.js';
import { estimateLegMinutes, type LegCalibration } from './plan-score-estimates.js';
import { interestsForPlaceTypes, placeProfile } from './plan-score-place-types.js';

/**
 * Which of the traveller's own unplanned places fit a free stretch between two
 * stops. Pure: everything it reads is stored, and it only ever suggests - the
 * traveller adds (PRD 29.4). There is no catalogue and no nearby search here
 * (PRD 11.1, 29.5); the candidates are Trip Places the traveller chose.
 */

type Coordinates = { latitude: number; longitude: number };

/** A free stretch shorter than this is not worth filling. */
export const MINIMUM_GAP_MINUTES = 45;
/** Suggestions offered per gap. */
export const SUGGESTIONS_PER_GAP = 3;
/** When nothing says how long a visit takes. */
const FALLBACK_VISIT_MINUTES = 60;
const ROUND_TO_MINUTES = 5;

export type GapCandidate = {
  coordinates: Coordinates | null;
  /** Opening hours on this day, as minutes from its midnight. */
  hours: PlanScoreOpeningHours;
  rating: number | null;
  tripPlaceId: string;
  types: readonly string[];
};

export type GapReason =
  'MATCHES_INTEREST' | 'NEAR_ROUTE' | 'OPEN_THEN' | 'SUITS_TIME' | 'WELL_RATED';

export type GapSuggestion = {
  /** Extra travel, in minutes, compared with going straight to the next stop. */
  detourMinutes: number;
  /** The hours are not known, so the traveller should check them. */
  hoursUnknown: boolean;
  reasons: GapReason[];
  startMinute: number;
  tripPlaceId: string;
  visitMinutes: number;
};

export type DayGap = {
  afterItemId: string;
  beforeItemId: string;
  endMinute: number;
  startMinute: number;
  suggestions: GapSuggestion[];
};

const roundUp = (minute: number) => Math.ceil(minute / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;

/** Earliest start at or after `from` whose whole visit sits inside one opening interval. */
function openStart(hours: PlanScoreOpeningHours, from: number, visit: number): number | null {
  if (hours.status !== 'KNOWN') return from;
  for (const interval of hours.intervals.toSorted((a, b) => a.startMinute - b.startMinute)) {
    const start = roundUp(Math.max(from, interval.startMinute));
    if (start + visit <= interval.endMinute) return start;
  }
  return null;
}

export function findDayGaps(input: {
  calibration: LegCalibration;
  candidates: readonly GapCandidate[];
  interests: readonly string[];
  items: readonly PlanScoreDayItem[];
  locate: (tripPlaceId: string | undefined) => Coordinates | null;
  mode: string;
}): DayGap[] {
  const timed = input.items
    .filter((item) => item.start && item.duration)
    .toSorted((a, b) => a.start!.minutes - b.start!.minutes);

  const gaps: DayGap[] = [];
  for (let index = 1; index < timed.length; index++) {
    const before = timed[index - 1]!;
    const after = timed[index]!;
    const startMinute = before.start!.minutes + before.duration!.minutes;
    const endMinute = after.start!.minutes;
    if (endMinute - startMinute < MINIMUM_GAP_MINUTES) continue;

    const from = input.locate(before.placeId);
    const to = input.locate(after.placeId);
    if (!from || !to) continue;
    const direct = estimateLegMinutes(from, to, input.mode, input.calibration) ?? 0;

    const ranked = input.candidates.flatMap((candidate) => {
      if (!candidate.coordinates) return [];
      const travelIn = estimateLegMinutes(
        from,
        candidate.coordinates,
        input.mode,
        input.calibration,
      );
      const travelOut = estimateLegMinutes(
        candidate.coordinates,
        to,
        input.mode,
        input.calibration,
      );
      if (travelIn === null || travelOut === null) return [];

      const profile = placeProfile(candidate.types);
      const visitMinutes = profile?.visit?.typical ?? FALLBACK_VISIT_MINUTES;
      const start = openStart(candidate.hours, roundUp(startMinute + travelIn), visitMinutes);
      // Closed for the whole stretch, or not open long enough: never offered.
      if (start === null || start + visitMinutes + travelOut > endMinute) return [];

      const hoursUnknown = candidate.hours.status !== 'KNOWN';
      const detourMinutes = Math.max(0, Math.round(travelIn + travelOut - direct));
      const windows = Array.isArray(profile?.windows) ? profile.windows : null;
      const suitsTime = windows
        ? windows.some((window) => start >= window.startMinute && start < window.endMinute)
        : null;
      const interest = interestsForPlaceTypes(candidate.types).some((entry) =>
        input.interests.includes(entry),
      );
      const wellRated = candidate.rating !== null && candidate.rating >= 4.3;

      const reasons: GapReason[] = ['NEAR_ROUTE'];
      if (!hoursUnknown) reasons.push('OPEN_THEN');
      if (suitsTime) reasons.push('SUITS_TIME');
      if (interest) reasons.push('MATCHES_INTEREST');
      if (wellRated) reasons.push('WELL_RATED');

      // Lower is better. Travel dominates; the rest nudges between close calls.
      const score =
        detourMinutes +
        (hoursUnknown ? 15 : 0) +
        (suitsTime === false ? 30 : 0) -
        (interest ? 10 : 0) -
        (candidate.rating !== null ? (candidate.rating - 4) * 10 : 0);

      return [
        {
          score,
          suggestion: {
            detourMinutes,
            hoursUnknown,
            reasons,
            startMinute: start,
            tripPlaceId: candidate.tripPlaceId,
            visitMinutes,
          },
        },
      ];
    });

    const suggestions = ranked
      .toSorted((a, b) => a.score - b.score)
      .slice(0, SUGGESTIONS_PER_GAP)
      .map((entry) => entry.suggestion);
    if (suggestions.length) {
      gaps.push({
        afterItemId: before.id,
        beforeItemId: after.id,
        endMinute,
        startMinute,
        suggestions,
      });
    }
  }
  return gaps;
}
