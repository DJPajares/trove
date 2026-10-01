import {
  effectiveTripPace,
  readTripPlanningPreferences,
  readDayPlanningContext,
  type PlanScoreExplanation,
  type PlanScoreAssessmentBasis,
  type PlanScoreLimitation,
} from '@trove/types';
import {
  evaluateFeasibility,
  evaluateTravelEffort,
  evaluatePlaceQuality,
  evaluateRouteEfficiency,
  type PlanScoreDayItem,
  type PlanScoreDetailGaps,
  type PlanScoreFixedCommitment,
  type PlanScoreInterval,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
  type PlanScoreRouteEfficiencyEvaluation,
  type PlanScoreRouteEfficiencyInput,
} from './plan-score-factors.js';
import {
  combineSignals,
  MISSING_DETAIL_SCORE,
  UNKNOWN,
  NOT_APPLICABLE,
  scoringInputRevision,
  withMissingDetail,
  type PlanScoreDayInput,
  type PlanScoreEvidence,
  type PlanScoreEvidenceSource,
  type PlanScoreFactorResult,
} from './plan-score-rules.js';
import { inferDurations, seasonalDayFit, type ScoringClimate } from './plan-score-estimates.js';
import { interestsForPlaceTypes, placeProfile } from './plan-score-place-types.js';
export { interestsForPlaceTypes } from './plan-score-place-types.js';

export type ScoringPlace = PlanScorePlace & {
  fieldEvidence?: Partial<
    Record<
      'identity' | 'coordinates' | 'types' | 'name' | 'rating' | 'hours',
      { acquiredAt: string | null; expiresAt: string | null }
    >
  >;
  types?: readonly string[];
  source?: PlanScoreEvidence['source'];
  coordinates?: { latitude: number; longitude: number } | null;
  name?: string | null;
  /**
   * A provider place. It has a real location even while its cached snapshot
   * has lapsed, so only a custom place with no position counts as unlocated.
   */
  linked?: boolean;
};
export type ScoringRouteSegment = PlanScoreRouteSegment & {
  mode?: string;
  distanceMeters?: number | null;
  itemIds?: readonly string[];
};
export type ScoringForecast = {
  date: string;
  precipitationProbability: number | null;
  source: PlanScoreEvidence['source'];
  placeIds: readonly string[];
};
export type ScoredDayInput = {
  commitments: PlanScoreFixedCommitment[];
  dayId: string;
  date?: string;
  timeZone?: string;
  items: PlanScoreDayItem[];
  places: ScoringPlace[];
  segments: ScoringRouteSegment[];
  preferences?: unknown;
  planningContext?: unknown;
  originInstant?: number;
  availability?: { startMinute: number; endMinute: number } | null;
  forecasts?: readonly ScoringForecast[];
  routeComparison?: PlanScoreRouteEfficiencyInput | 'NOT_APPLICABLE';
  /** A public holiday on this day in its country; certainty follows the holiday dataset. */
  holiday?: { certainty: 'official' | 'expected' } | null;
  /** Typical monthly conditions for the day's area: a pattern, never a forecast. */
  climate?: ScoringClimate | null;
};
type Criterion = {
  id: string;
  source: PlanScoreEvidenceSource;
  /** `MISSING`: unjudgeable only because the traveller has yet to add the detail. */
  satisfied: boolean | 'MISSING' | null;
  /** A partial concern counts for less than a full criterion. */
  weight?: number;
};
function supported(criteria: readonly Criterion[]): PlanScoreFactorResult {
  const weight = (criterion: Criterion) => criterion.weight ?? 1;
  const known = criteria.filter((c) => c.satisfied !== null);
  const knownWeight = known.reduce((sum, c) => sum + weight(c), 0);
  if (!known.length || knownWeight <= 0) return UNKNOWN;
  const credit = (c: Criterion) =>
    c.satisfied === 'MISSING'
      ? (weight(c) * MISSING_DETAIL_SCORE) / 100
      : c.satisfied
        ? weight(c)
        : 0;
  return {
    state: 'EVALUATED',
    score: (100 * known.reduce((sum, c) => sum + credit(c), 0)) / knownWeight,
    coverage: (100 * knownWeight) / criteria.reduce((sum, c) => sum + weight(c), 0),
    evidence: known.map((c) =>
      c.satisfied === 'MISSING'
        ? { ref: `missing:${c.id}`, source: 'ESTIMATED' as const }
        : { ref: c.id, source: c.source },
    ),
  };
}
const RELIABILITY_ORDER: readonly PlanScoreEvidenceSource[] = [
  'STALE',
  'ESTIMATED',
  'CACHED_PROVIDER',
  'FRESH_PROVIDER',
  'USER_OWNED',
];
/** A judgment from two pieces of evidence is only as reliable as the weaker one. */
const weaker = (a: PlanScoreEvidenceSource, b: PlanScoreEvidenceSource) =>
  RELIABILITY_ORDER.indexOf(a) <= RELIABILITY_ORDER.indexOf(b) ? a : b;
/** Outdoor time in these hours meets a month's typical heat. */
const MIDDAY: PlanScoreInterval = { startMinute: 11 * 60, endMinute: 16 * 60 };
/** Whether a start at `minute` (or the next night's same clock time) falls in a window. */
const withinWindows = (minute: number, windows: readonly PlanScoreInterval[]) =>
  windows.some((window) =>
    [minute, minute + 1440].some((m) => m >= window.startMinute && m < window.endMinute),
  );
/** Whether any start in a daypart could fall in a window: dayparts are evaluated best-case. */
const windowMeets = (earliest: number, latest: number, windows: readonly PlanScoreInterval[]) =>
  windows.some((window) => earliest < window.endMinute && window.startMinute <= latest);
/** NOAA solar approximation (https://gml.noaa.gov/grad/solcalc/solareqns.PDF).
 * Evaluated locally; polar day/night has no fabricated rise/set. */
export function daylightUtc(
  date: string,
  coordinates: { latitude: number; longitude: number },
): { sunrise: number; sunset: number } | null {
  const { latitude, longitude } = coordinates;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  const day = 1 + (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  const daysInYear =
    (Date.UTC(d.getUTCFullYear() + 1, 0, 1) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  const gamma = ((2 * Math.PI) / daysInYear) * (day - 1);
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const dec =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const lat = (latitude * Math.PI) / 180;
  const cosine =
    Math.cos((90.833 * Math.PI) / 180) / (Math.cos(lat) * Math.cos(dec)) -
    Math.tan(lat) * Math.tan(dec);
  if (cosine < -1 || cosine > 1) return null;
  const ha = (Math.acos(cosine) * 180) / Math.PI;
  const noon = 720 - 4 * longitude - eq;
  return {
    sunrise: d.getTime() + (noon - 4 * ha) * 60000,
    sunset: d.getTime() + (noon + 4 * ha) * 60000,
  };
}
export function loadScore(ratio: number) {
  const anchors = [
    [1, 100],
    [1.25, 70],
    [1.5, 40],
    [2, 0],
  ] as const;
  if (ratio <= 1) return 100;
  for (let i = 1; i < anchors.length; i++) {
    const [x, y] = anchors[i]!,
      [px, py] = anchors[i - 1]!;
    if (ratio <= x) return py + ((y - py) * (ratio - px)) / (x - px);
  }
  return 0;
}
export type DayAdvisory = {
  code:
    | 'NATURAL_DOWNTIME'
    | 'CONTINUOUS_ACTIVITY'
    | 'WALKING_LOAD'
    | 'RAIN_FORECAST'
    | 'DAYLIGHT_LIMIT';
  references: string[];
};
export function evaluateScoredDay(input: ScoredDayInput) {
  const preferences = readTripPlanningPreferences(input.preferences);
  const context = readDayPlanningContext(input.planningContext);
  const availability =
    input.availability ??
    (context.availability
      ? {
          startMinute: parseMinute(context.availability.start),
          endMinute: parseMinute(context.availability.end),
        }
      : null);
  const availableMinutes = availability ? availability.endMinute - availability.startMinute : null;
  const rest = context.intent === 'rest';
  const transit =
    context.intent === 'transit' ||
    (input.items.length === 0 && input.commitments.some((c) => c.longDistance));
  const noVisits = input.places.length === 0 && (rest || transit);
  const places = new Map(input.places.map((place) => [place.tripPlaceId, place]));
  const profileOf = (item: PlanScoreDayItem) =>
    placeProfile(item.placeId ? places.get(item.placeId)?.types : null);
  // A duration the plan leaves unstated comes from its own timing, then from the
  // typical length for the kind of place. A timed day can then be assessed, but
  // only on its own timing: an untimed plan stays unscored, and every inferred
  // length is disclosed as an estimate.
  const inferred = inferDurations(input.items, (item) => profileOf(item)?.visit?.typical ?? null);
  const dayItems = inferred.items;
  const stated = new Map(input.items.map((item) => [item.id, item.duration]));
  const items = dayItems.map((item) =>
    item.blockType && item.blockType !== 'activity'
      ? { ...item, openingHours: { status: 'UNKNOWN' as const } }
      : item,
  );
  // Detail only the traveller can add (rubric 11). A stop is located when it is
  // a provider place, even one whose cached snapshot has lapsed, or a custom
  // place on the map; a label with no place, or a custom place with no
  // position, is not. Booked stops take their time from the booking.
  const isStop = (item: PlanScoreDayItem) => !item.blockType || item.blockType === 'activity';
  const booked = new Set(input.commitments.flatMap((c) => (c.itemId ? [c.itemId] : [])));
  const unlocated = (item: PlanScoreDayItem) => {
    if (!item.placeId) return true;
    const place = places.get(item.placeId);
    return Boolean(place && !place.coordinates && place.linked === false);
  };
  const stopIds = (keep: (item: PlanScoreDayItem) => boolean) =>
    new Set(dayItems.filter((item) => isStop(item) && keep(item)).map((item) => item.id));
  const gaps: PlanScoreDetailGaps = {
    location: stopIds(unlocated),
    time: stopIds((item) => !item.start && !item.startWindow && !booked.has(item.id)),
    daypart: stopIds((item) => !item.start && !!item.startWindow && !booked.has(item.id)),
    duration: stopIds((item) => !item.duration && !item.longDistance),
  };
  const missingLegs = new Set(
    input.segments
      .filter(
        (s) =>
          s.scope === 'LOCAL' &&
          s.status === 'UNKNOWN' &&
          s.itemIds?.some((id) => gaps.location.has(id)),
      )
      .map((s) => s.id),
  );
  const feasibility = evaluateFeasibility({
    items,
    commitments: input.commitments,
    availability,
    gaps,
  });
  const requiredInbound = dayItems.filter((item, index) => item.inboundRequired ?? index > 0);
  const unresolvedTransport = dayItems.some(
    (item) =>
      item.blockType === 'transport' && !input.commitments.some((c) => c.itemId === item.id),
  );
  const requiredTravelUnknown =
    requiredInbound.some((item) => item.inboundTravel === null) ||
    input.segments.some(
      (s) =>
        s.status === 'UNKNOWN' &&
        (s.scope === 'LOCAL' ||
          !input.commitments.some(
            (c) =>
              c.longDistance && c.endKnown !== false && c.itemId && s.itemIds?.includes(c.itemId),
          )),
    ) ||
    unresolvedTransport ||
    input.commitments.some((c) => c.longDistance && c.endKnown === false);
  const travelEstimated =
    input.segments.some(
      (s) => s.scope === 'LOCAL' && s.status === 'KNOWN' && s.duration.source === 'ESTIMATED',
    ) || requiredInbound.some((item) => item.inboundTravel?.source === 'ESTIMATED');
  const travel =
    !input.segments.some((s) => s.scope === 'LOCAL') &&
    !requiredInbound.length &&
    !unresolvedTransport
      ? { factor: NOT_APPLICABLE, totalMinutes: null }
      : evaluateTravelEffort(input.segments, missingLegs);
  const routeComparison: PlanScoreRouteEfficiencyEvaluation =
    input.routeComparison === 'NOT_APPLICABLE'
      ? { factor: NOT_APPLICABLE, bestMinutes: null, plannedMinutes: null }
      : input.routeComparison
        ? evaluateRouteEfficiency(input.routeComparison)
        : {
            factor:
              dayItems.length < 2 || travel.factor.state === 'NOT_APPLICABLE'
                ? NOT_APPLICABLE
                : UNKNOWN,
            bestMinutes: null,
            plannedMinutes: null,
          };
  // A comparison an unlocated stop leaves impossible is that stop's gap, not
  // a free pass for the day's order.
  const comparison =
    routeComparison.factor.state === 'UNKNOWN' && gaps.location.size
      ? withMissingDetail(routeComparison.factor, 100, [...gaps.location])
      : routeComparison.factor;
  const route = combineSignals([
    { weight: 60, result: travel.factor },
    { weight: 40, result: comparison },
  ]);
  const pace = effectiveTripPace(preferences);
  const target = Math.min(
    { relaxed: 360, balanced: 480, packed: 600 }[pace.pace],
    availableMinutes ?? Infinity,
  );
  const evidence: PlanScoreEvidence[] = [
    { ref: 'pace', source: pace.source === 'user' ? 'USER_OWNED' : 'ESTIMATED' },
  ];
  // `load` includes every estimate and scores comfort. `provenLoad` leaves out
  // what this rubric inferred (durations, distance-estimated legs), so only
  // stated or routed load can prove an overload or carry fatigue forward.
  let load = 0;
  let provenLoad = 0;
  let observations = 0;
  let knownObservations = 0;
  let completeObservations = 0;
  // Observations missing only because the traveller left a stop without a
  // duration or a location. They count at the missing-detail value, never as
  // an hour of rest.
  const missingObservations: string[] = [];
  const commitments = [...new Map(input.commitments.map((c) => [c.id, c])).values()];
  const represented = new Set(
    commitments.flatMap((c) => (c.longDistance && c.itemId ? [c.itemId] : [])),
  );
  for (const item of dayItems) {
    if (represented.has(item.id)) continue;
    observations++;
    if (!item.duration) {
      if (gaps.duration.has(item.id)) missingObservations.push(`duration:${item.id}`);
      continue;
    }
    knownObservations++;
    if (!inferred.typeInferred.has(item.id)) completeObservations++;
    const minutes =
      item.duration.minutes * (item.blockType === 'free_time' ? 0 : item.longDistance ? 0.5 : 1);
    load += minutes;
    if (stated.get(item.id)) provenLoad += minutes;
    evidence.push(
      { ref: `duration:${item.id}`, source: item.duration.source },
      { ref: `intensity:${item.id}`, source: 'ESTIMATED' },
    );
  }
  for (const c of commitments) {
    if (!c.longDistance && c.itemId && dayItems.some((i) => i.id === c.itemId)) continue;
    observations++;
    if (
      c.endKnown === false ||
      c.startKnown === false ||
      (!c.longDistance && c.endMinute === c.startMinute)
    )
      continue;
    knownObservations++;
    completeObservations++;
    const minutes = (c.endMinute - c.startMinute) * (c.longDistance ? 0.5 : 1);
    load += minutes;
    provenLoad += minutes;
    evidence.push({ ref: `commitment:${c.id}`, source: c.source });
  }
  for (const leg of input.segments) {
    if (leg.scope === 'LONG_DISTANCE') {
      // A represented journey has one duration observation, even when linked to an item.
      if (!commitments.some((c) => c.longDistance && c.itemId && leg.itemIds?.includes(c.itemId)))
        observations++;
      continue;
    }
    observations++;
    if (leg.status !== 'KNOWN') {
      if (missingLegs.has(leg.id)) missingObservations.push(`segment:${leg.id}`);
      continue;
    }
    knownObservations++;
    completeObservations++;
    const multiplier = leg.mode === 'walk' ? 1.25 : leg.mode === 'transit' ? 0.75 : 1;
    load += leg.duration.minutes * multiplier;
    if (leg.duration.source !== 'ESTIMATED') provenLoad += leg.duration.minutes * multiplier;
    evidence.push({ ref: `segment:${leg.id}`, source: leg.duration.source });
  }
  // Missing topology must remain in the denominator even if no route snapshot exists.
  const absentInbound = requiredInbound.filter(
    (item) =>
      item.inboundTravel === null &&
      !input.segments.some(
        (s) =>
          s.scope === 'LOCAL' &&
          (s.itemIds?.at(-1) === item.id || (!s.itemIds && s.status === 'UNKNOWN')),
      ),
  );
  observations += absentInbound.length;
  for (const item of absentInbound)
    if (gaps.location.has(item.id)) missingObservations.push(`travel:${item.id}`);
  const restful =
    rest &&
    dayItems.length === 0 &&
    commitments.length === 0 &&
    availableMinutes !== null &&
    availableMinutes > 0;
  if (restful) {
    observations++;
    knownObservations++;
    completeObservations++;
  }
  // A typical visit length estimates load, but cannot complete it: only stated
  // durations prove the whole day's load, as fatigue recovery requires.
  const complete =
    observations > 0 && completeObservations === observations && !requiredTravelUnknown;
  if (availability) evidence.push({ ref: 'availability', source: 'USER_OWNED' });
  const ratio = target > 0 ? load / target : null;
  const provenRatio = target > 0 ? provenLoad / target : null;
  const provedOverload = provenRatio !== null && provenRatio > 1;
  const judgedObservations = knownObservations + missingObservations.length;
  // Known load only grows as detail is added, so its comfort bounds the day:
  // leaving a duration out can never make a day look lighter than it is.
  const comfort: PlanScoreFactorResult =
    judgedObservations > 0 && ratio !== null
      ? {
          state: 'EVALUATED',
          score: Math.min(
            loadScore(ratio),
            (knownObservations * loadScore(ratio) +
              missingObservations.length * MISSING_DETAIL_SCORE) /
              judgedObservations,
          ),
          coverage: (100 * judgedObservations) / observations,
          evidence: [
            ...evidence,
            ...missingObservations.map((ref) => ({
              ref: `missing:${ref}`,
              source: 'ESTIMATED' as const,
            })),
          ],
        }
      : UNKNOWN;
  // Visits are the stops a traveller goes to experience. Logistics places - an
  // airport, a station, a stay - are travel, not an experience to judge.
  const visits = dayItems.filter(
    (item) =>
      (!item.blockType || item.blockType === 'activity') && profileOf(item)?.kind !== 'logistics',
  );
  const visitDay = !noVisits && visits.length > 0;
  const knownPlaces = [
    ...new Map(
      input.places
        .filter((place) => {
          if (placeProfile(place.types)?.kind === 'logistics') return false;
          const representedItems = dayItems.filter((item) => item.placeId === place.tripPlaceId);
          return (
            !representedItems.length ||
            representedItems.some((item) => !item.blockType || item.blockType === 'activity')
          );
        })
        .map((p) => [p.tripPlaceId, p]),
    ).values(),
  ];
  // Venues the traveller has not located are still the day's venues: what
  // they are, how they rate and whether they suit is unknowable until they are.
  const unlocatedPlaceIds = new Set(
    dayItems.flatMap((item) => (gaps.location.has(item.id) && item.placeId ? [item.placeId] : [])),
  );
  const labelVisits = visits.filter((item) => !item.placeId && gaps.location.has(item.id));
  const fit = preferences.interests.length
    ? supported([
        ...knownPlaces.map((place) => ({
          id: `interest:${place.tripPlaceId}`,
          source: place.source ?? 'CACHED_PROVIDER',
          satisfied: interestsForPlaceTypes(place.types ?? []).some((i) =>
            preferences.interests.includes(i as (typeof preferences.interests)[number]),
          )
            ? true
            : unlocatedPlaceIds.has(place.tripPlaceId)
              ? ('MISSING' as const)
              : null,
        })),
        ...labelVisits.map((item) => ({
          id: `interest:${item.id}`,
          source: 'ESTIMATED' as const,
          satisfied: 'MISSING' as const,
        })),
      ])
    : UNKNOWN;
  const advisories: DayAdvisory[] = [];
  const outdoorPlace = (place: ScoringPlace) => placeProfile(place.types)?.outdoor ?? false;
  for (const forecast of input.forecasts ?? [])
    if (
      forecast.precipitationProbability != null &&
      forecast.precipitationProbability >= 60 &&
      knownPlaces.some((p) => forecast.placeIds.includes(p.tripPlaceId) && outdoorPlace(p))
    )
      advisories.push({ code: 'RAIN_FORECAST', references: [...forecast.placeIds] });
  if (input.date && input.originInstant !== undefined)
    for (const place of knownPlaces) {
      if (!place.coordinates || !place.types?.includes('hiking_area')) continue;
      const sunlight = daylightUtc(input.date, place.coordinates);
      const item = input.items.find((i) => i.placeId === place.tripPlaceId);
      if (!sunlight || !item?.start || !item.duration) continue;
      const start = input.originInstant + item.start.minutes * 60000;
      const end = start + item.duration.minutes * 60000;
      if (start < sunlight.sunrise || end > sunlight.sunset)
        advisories.push({ code: 'DAYLIGHT_LIMIT', references: [item.id] });
    }
  // Date and time suitability: when a visit happens against when its kind of
  // place suits a traveller, daylight for outdoor places, and holiday hours.
  const daylightWindow = (coordinates: ScoringPlace['coordinates']) => {
    if (!coordinates || !input.date || input.originInstant === undefined) return null;
    const light = daylightUtc(input.date, coordinates);
    if (!light) return null;
    return [
      {
        startMinute: (light.sunrise - input.originInstant) / 60000 - 30,
        endMinute: (light.sunset - input.originInstant) / 60000 + 30,
      },
    ];
  };
  const timeCriteria: Criterion[] = [];
  const timeOfDayMisses: string[] = [];
  const holidayRisks: string[] = [];
  for (const item of visits) {
    const profile = profileOf(item);
    const place = item.placeId ? places.get(item.placeId) : undefined;
    const placeSource = place?.source ?? 'CACHED_PROVIDER';
    const timingSource = item.start?.source ?? item.startWindow?.source ?? null;
    const id = `time:${item.id}`;
    if (!profile) {
      timeCriteria.push({
        id,
        source: 'ESTIMATED',
        satisfied: gaps.location.has(item.id) ? 'MISSING' : null,
      });
      continue;
    }
    const untimed = gaps.time.has(item.id) ? ('MISSING' as const) : null;
    if (profile.windowKind === 'ACCESS' && item.openingHours.status === 'KNOWN') {
      // Known hours own this visit's timing (feasibility); a visit inside them is
      // well timed, and one outside them is not judged a second time here.
      const conflicted = feasibility.conflicts.some(
        (c) => c.kind === 'OUTSIDE_OPENING_HOURS' && c.subjectIds.includes(item.id),
      );
      if (!conflicted)
        timeCriteria.push({
          id,
          source: timingSource
            ? weaker(timingSource, item.openingHours.source)
            : item.openingHours.source,
          satisfied: timingSource ? true : untimed,
        });
    } else if (profile.windows) {
      const windows =
        profile.windows === 'DAYLIGHT' ? daylightWindow(place?.coordinates) : profile.windows;
      const satisfied =
        !timingSource || !windows
          ? untimed
          : item.start
            ? withinWindows(item.start.minutes, windows)
            : windowMeets(
                item.startWindow!.earliestMinute,
                item.startWindow!.latestMinute,
                windows,
              );
      if (satisfied === false) timeOfDayMisses.push(item.id);
      timeCriteria.push({
        id,
        source: timingSource ? weaker(timingSource, placeSource) : placeSource,
        satisfied,
      });
    }
    if (input.holiday && profile.holidaySensitive) {
      // Weekly hours do not speak for a public holiday; only date-specific hours do.
      const confirmed =
        item.openingHours.status === 'KNOWN' && item.openingHours.source !== 'ESTIMATED';
      if (!confirmed) holidayRisks.push(item.id);
      timeCriteria.push({
        id: `holiday:${item.id}`,
        source:
          item.openingHours.status === 'KNOWN' && confirmed
            ? item.openingHours.source
            : 'ESTIMATED',
        satisfied: confirmed,
        weight: input.holiday.certainty === 'official' ? 0.5 : 0.25,
      });
    }
  }
  // Time allocation: a visit given less than its kind's minimum is rushed. Only
  // a stated duration or the traveller's own timing can show that; a typical
  // length would only agree with itself.
  const allocationCriteria: Criterion[] = [];
  const rushed: string[] = [];
  for (const item of visits) {
    const minimum = profileOf(item)?.visit?.minimum;
    const own = stated.get(item.id);
    const allowed = own?.minutes ?? inferred.allowedMinutes.get(item.id) ?? null;
    const satisfied =
      !profileOf(item) && gaps.location.has(item.id)
        ? ('MISSING' as const)
        : minimum === undefined
          ? null
          : allowed === null
            ? gaps.time.has(item.id) || gaps.duration.has(item.id)
              ? ('MISSING' as const)
              : null
            : allowed >= minimum;
    if (satisfied === false) rushed.push(item.id);
    allocationCriteria.push({
      id: `allocation:${item.id}`,
      source: own?.source ?? 'ESTIMATED',
      satisfied,
    });
  }
  const quality = !visitDay
    ? NOT_APPLICABLE
    : combineSignals([
        { weight: 35, result: supported(timeCriteria) },
        { weight: 25, result: supported(allocationCriteria) },
        { weight: 25, result: fit },
        {
          weight: 15,
          result: withMissingDetail(
            evaluatePlaceQuality([
              ...knownPlaces,
              ...labelVisits.map((item) => ({
                tripPlaceId: `item:${item.id}`,
                rating: { status: 'UNKNOWN' as const },
              })),
            ]),
            (100 *
              (knownPlaces.filter((p) => unlocatedPlaceIds.has(p.tripPlaceId)).length +
                labelVisits.length)) /
              Math.max(1, knownPlaces.length + labelVisits.length),
            [...gaps.location],
          ),
        },
      ]);
  const intentEvidence: PlanScoreEvidence[] = [{ ref: 'intent', source: 'USER_OWNED' }];
  const focused = context.intent === 'focused';
  // Coherent flow is the plan's own time order, from exact starts or dayparts.
  // Geographic flow is Route & Time Efficiency's to judge, not a second time here.
  const timedItems = dayItems.filter((item) => item.start || item.startWindow);
  const earliest = (item: PlanScoreDayItem) =>
    item.start?.minutes ?? item.startWindow!.earliestMinute;
  const latest = (item: PlanScoreDayItem) => item.start?.minutes ?? item.startWindow!.latestMinute;
  const inOrder = timedItems
    .slice(1)
    .filter((item, index) => earliest(timedItems[index]!) <= latest(item)).length;
  // One stop has no order to judge, and one timed stop among several proves
  // none. A stop the traveller left untimed has no place in the flow yet.
  const untimedStops = dayItems.filter((item) => gaps.time.has(item.id));
  const temporalFlow: PlanScoreFactorResult =
    dayItems.length < 2
      ? NOT_APPLICABLE
      : withMissingDetail(
          timedItems.length < 2
            ? UNKNOWN
            : {
                state: 'EVALUATED',
                score: (100 * inOrder) / (timedItems.length - 1),
                coverage: (100 * timedItems.length) / dayItems.length,
                evidence: timedItems.map((item) => ({
                  ref: `order:${item.id}`,
                  source: item.start?.source ?? item.startWindow!.source,
                })),
              },
          (100 * untimedStops.length) / dayItems.length,
          untimedStops.map((item) => item.id),
        );
  const coherence: PlanScoreFactorResult = restful
    ? { state: 'EVALUATED', score: 100, evidence: intentEvidence }
    : focused && fit.state === 'EVALUATED'
      ? fit
      : temporalFlow;
  // Purposeful variety: the mix of kinds of experience across the day's visits.
  // An unknown intent may still be a focused day, so repetition only counts
  // gently there; a declared Explore day expects a mix.
  const themed = visits.flatMap((item) => {
    const place = item.placeId ? places.get(item.placeId) : undefined;
    const theme = interestsForPlaceTypes(place?.types ?? [])[0];
    return theme ? [{ item, place, theme }] : [];
  });
  const distinctThemes = new Set(themed.map((entry) => entry.theme)).size;
  const explore = context.intent === 'explore';
  // A visit the traveller has not located has no kind yet, so it counts low
  // here as in every other category (rubric 12).
  const unlocatedVisits = visits.filter((item) => gaps.location.has(item.id));
  const variety: PlanScoreFactorResult =
    rest || transit || focused || visits.length < 2
      ? NOT_APPLICABLE
      : withMissingDetail(
          themed.length < 2
            ? UNKNOWN
            : {
                state: 'EVALUATED',
                score: distinctThemes >= 2 ? 100 : explore ? 50 : 75,
                coverage: (100 * themed.length) / visits.length,
                evidence: themed.map(({ item, place }) => ({
                  ref: `type:${item.placeId}`,
                  source: place?.source ?? 'CACHED_PROVIDER',
                  ...(distinctThemes < 2 && !explore ? { strength: 0.5 } : {}),
                })),
              },
          (100 * unlocatedVisits.length) / visits.length,
          unlocatedVisits.map((item) => item.id),
        );
  // Whether a day makes good use of its area needs sourced evidence about that
  // area's opportunities. The evaluator has none, so the signal is not part of
  // the rubric yet: counting it as unknown would cap every day's coverage.
  const utilization = NOT_APPLICABLE;
  const composition = combineSignals([
    { weight: 50, result: coherence },
    { weight: 50, result: variety },
  ]);
  // Seasonal fit weighs the day's outdoor time against the month's typical
  // conditions for its area. It feeds the trip component, not this day's score.
  const midday = (item: PlanScoreDayItem) =>
    item.start
      ? item.start.minutes < MIDDAY.endMinute &&
        MIDDAY.startMinute < item.start.minutes + (item.duration?.minutes ?? 0)
      : item.startWindow
        ? item.startWindow.earliestMinute >= MIDDAY.startMinute - 60 &&
          item.startWindow.earliestMinute < MIDDAY.endMinute
        : false;
  // Only a visit whose kind is known can be judged indoor or outdoor; an
  // unlocated stop is not assumed to be indoors.
  const knownKindVisits = visits.filter((item) => profileOf(item));
  const seasonal = !visitDay
    ? { factor: NOT_APPLICABLE, wet: false, heat: false }
    : knownKindVisits.length
      ? seasonalDayFit(
          knownKindVisits.map((item) => ({
            minutes: item.duration?.minutes ?? 60,
            outdoor: profileOf(item)?.outdoor ?? false,
            midday: midday(item),
          })),
          input.climate,
        )
      : { factor: UNKNOWN, wet: false, heat: false };
  let continuous = 0;
  for (const [index, item] of input.items.entries()) {
    const previous = input.items[index - 1];
    if (
      !item.start ||
      !item.duration ||
      (previous && (!previous.start || !previous.duration || !item.inboundTravel))
    ) {
      continuous = 0;
      continue;
    }
    if (
      previous?.start &&
      previous.duration &&
      item.start &&
      item.inboundTravel &&
      item.start.minutes -
        previous.start.minutes -
        previous.duration.minutes -
        item.inboundTravel.minutes >=
        30
    )
      continuous = 0;
    continuous += (item.duration?.minutes ?? 0) + (item.inboundTravel?.minutes ?? 0);
    if (continuous >= 240) {
      advisories.push({ code: 'CONTINUOUS_ACTIVITY', references: [item.id] });
      break;
    }
  }
  if (
    input.segments.some(
      (s) => s.mode === 'walk' && s.distanceMeters != null && s.distanceMeters >= 5000,
    )
  )
    advisories.push({
      code: 'WALKING_LOAD',
      references: input.segments.filter((s) => s.mode === 'walk').map((s) => s.id),
    });
  const fixedItems = input.items.filter((i) => i.fixed && i.start && i.duration);
  for (let i = 1; i < fixedItems.length; i++) {
    const a = fixedItems[i - 1]!,
      b = fixedItems[i]!;
    if (
      b.start!.minutes -
        a.start!.minutes -
        a.duration!.minutes -
        (b.inboundTravel?.minutes ?? Infinity) >=
      30
    ) {
      advisories.push({ code: 'NATURAL_DOWNTIME', references: [a.id, b.id] });
      break;
    }
  }
  const hard = feasibility.conflicts.filter((c) => c.severity === 'HARD' && c.verified);
  const material = feasibility.conflicts.filter((c) => c.severity === 'MATERIAL' && c.verified);
  const assessmentBasis: PlanScoreAssessmentBasis[] = [];
  const durationEstimated = dayItems.some((item) => item.duration && !stated.get(item.id));
  if (
    dayItems.some(
      (item) => item.duration && item.duration.minutes > 0 && (item.start || item.startWindow),
    ) ||
    commitments.some(
      (c) => c.startKnown !== false && c.endKnown !== false && c.endMinute > c.startMinute,
    )
  )
    assessmentBasis.push('TIMING');
  if (
    input.items.length > 0 &&
    input.items.every((item) => item.duration !== null) &&
    input.items.some((item) => (item.duration?.minutes ?? 0) > 0)
  )
    assessmentBasis.push('ACTIVITY_LOAD');
  if (feasibility.conflicts.some((c) => c.verified) || provedOverload)
    assessmentBasis.push('VERIFIED_PROBLEM');
  if (rest && availability && (restful || complete)) assessmentBasis.push('REST');
  const limitations: PlanScoreLimitation[] = [];
  if (requiredTravelUnknown) limitations.push('TRAVEL_TIME_UNKNOWN');
  else if (travelEstimated) limitations.push('TRAVEL_TIME_ESTIMATED');
  if (durationEstimated) limitations.push('DURATION_ESTIMATED');
  if (!complete) limitations.push('LOAD_INCOMPLETE');
  if (!assessmentBasis.includes('TIMING') && !restful) limitations.push('TIMING_UNKNOWN');
  if (gaps.location.size || gaps.time.size || gaps.duration.size)
    limitations.push('DETAIL_MISSING');
  if (
    quality.state === 'UNKNOWN' ||
    (quality.state === 'EVALUATED' && (quality.coverage ?? 100) < 100)
  )
    limitations.push('VENUE_EVIDENCE_INCOMPLETE');
  const dayInput: PlanScoreDayInput = {
    dayId: input.dayId,
    date: input.date,
    availableMinutes,
    loadRatio: complete ? ratio : null,
    partialLoadRatio: !complete && provenLoad > 0 ? provenRatio : null,
    assessmentBasis,
    limitations,
    rest,
    normalizedRevision: scoringInputRevision(input),
    conflictReferences: Object.fromEntries(feasibility.conflicts.map((c) => [c.id, c.subjectIds])),
    hardConflictIds: hard.map((c) => c.id),
    materialConflictIds: material.map((c) => c.id),
    indispensableConnectionConflict: hard.some((c) =>
      input.commitments.some(
        (commitment) => commitment.indispensable && c.subjectIds.includes(commitment.id),
      ),
    ),
    factors: {
      FEASIBILITY: feasibility.factor,
      ROUTE_EFFICIENCY: route,
      PACE_COMFORT: comfort,
      EXPERIENCE_QUALITY: quality,
      PLAN_COMPOSITION: composition,
    },
  };
  const missingTransfers = input.items.filter(
    (item) =>
      item.blockType === 'transport' && !input.commitments.some((c) => c.itemId === item.id),
  );
  const timedAccessLegs = input.segments.filter(
    (segment) =>
      segment.scope === 'LOCAL' &&
      segment.status === 'UNKNOWN' &&
      input.commitments.some(
        (c) => c.itemId && c.startKnown !== false && segment.itemIds?.at(-1) === c.itemId,
      ),
  );
  // A stop the traveller left unlocated is already asked for below.
  const missingLocations = input.items.filter(
    (item) =>
      !gaps.location.has(item.id) &&
      !input.places.find((place) => place.tripPlaceId === item.placeId)?.coordinates &&
      timedAccessLegs.some((segment) => segment.itemIds?.includes(item.id)),
  );
  const missingInformation: PlanScoreExplanation[] = [
    ...(missingLocations.length
      ? [
          {
            action: 'LINK_PLACE' as const,
            code: 'TIMED_ACCESS_LOCATION',
            factor: 'ROUTE_EFFICIENCY' as const,
            messageKey: 'missing.timedAccess',
            severity: 'INFO' as const,
            references: missingLocations.map((item) => item.id),
            values: { count: missingLocations.length },
          },
        ]
      : []),
    ...(missingTransfers.length
      ? [
          {
            action: 'EDIT_TRANSFER' as const,
            code: 'TRANSFER_DETAILS',
            factor: 'FEASIBILITY' as const,
            messageKey: 'missing.transfer',
            severity: 'INFO' as const,
            references: missingTransfers.map((item) => item.id),
            values: {},
          },
        ]
      : []),
    ...input.commitments
      .filter((c) => c.longDistance && c.endKnown === false)
      .map((c) => ({
        action: 'EDIT_TRANSFER' as const,
        code: 'MISSING_ARRIVAL',
        factor: 'FEASIBILITY' as const,
        messageKey: 'missing.arrival',
        severity: 'INFO' as const,
        references: [c.id],
        values: {},
      })),
  ];
  // What the traveller can add to plan the day better, and to score it on its
  // own detail rather than at the missing-detail value.
  const untimedOrUnmeasured = dayItems.filter(
    (item) => gaps.time.has(item.id) || gaps.duration.has(item.id),
  );
  const detailNudges: PlanScoreExplanation[] = [
    ...(gaps.location.size
      ? [
          {
            action: 'LINK_PLACE' as const,
            code: 'STOPS_NOT_LOCATED',
            factor: 'ROUTE_EFFICIENCY' as const,
            messageKey: 'missing.locations',
            severity: 'INFO' as const,
            references: [...gaps.location],
            values: { count: gaps.location.size },
          },
        ]
      : []),
    ...(untimedOrUnmeasured.length
      ? [
          {
            action: 'ADD_TIMING' as const,
            code: 'STOPS_WITHOUT_TIMING',
            factor: 'FEASIBILITY' as const,
            messageKey: 'missing.timing',
            severity: 'INFO' as const,
            references: untimedOrUnmeasured.map((item) => item.id),
            values: { count: untimedOrUnmeasured.length },
          },
        ]
      : []),
  ];
  return {
    detailNudges,
    missingInformation,
    requestedInterests: preferences.interests,
    interestEvidence: knownPlaces.flatMap((p) =>
      interestsForPlaceTypes(p.types ?? [])
        .filter((i) => preferences.interests.includes(i as (typeof preferences.interests)[number]))
        .map((interest) => ({
          ref: `interest:${p.tripPlaceId}:${interest}`,
          source: p.source ?? 'CACHED_PROVIDER',
          interest,
        })),
    ),
    input: dayInput,
    conflicts: feasibility.conflicts,
    pace: {
      factor: comfort,
      activeMinutes: complete ? load : null,
      smallestBufferMinutes: null,
      lowerBoundMinutes: !complete && provedOverload ? provenLoad : null,
    },
    travel: { ...travel, estimated: travelEstimated },
    route: routeComparison,
    advisories,
    experience: {
      timeOfDay: timeOfDayMisses,
      rushed,
      holiday: holidayRisks,
      singleTheme: explore && variety.state === 'EVALUATED' && distinctThemes < 2,
    },
    utilization,
    variety,
    seasonalFit: seasonal.factor,
    seasonal: { wet: seasonal.wet, heat: seasonal.heat },
  };
}
const parseMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
