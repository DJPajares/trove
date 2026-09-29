import {
  effectiveTripPace,
  readTripPlanningPreferences,
  readDayPlanningContext,
  type DestinationContextGroup,
} from '@trove/types';
import {
  evaluateFeasibility,
  evaluateTravelEffort,
  evaluatePlaceQuality,
  evaluateRouteEfficiency,
  type PlanScoreDayItem,
  type PlanScoreFixedCommitment,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
  type PlanScoreRouteEfficiencyInput,
} from './plan-score-factors.js';
import {
  combineSignals,
  UNKNOWN,
  NOT_APPLICABLE,
  scoringInputRevision,
  type PlanScoreDayInput,
  type PlanScoreEvidence,
  type PlanScoreFactorResult,
} from './plan-score-rules.js';
import { matchContextDestination } from './destination-context.js';

/** Reviewed semantic mappings, not an inferred preference from selecting a Place. */
const TYPE_INTERESTS: Record<string, readonly string[]> = {
  museum: ['art_museums'],
  art_gallery: ['art_museums'],
  historical_landmark: ['culture_history', 'architecture'],
  cultural_landmark: ['culture_history'],
  historical_place: ['culture_history'],
  monument: ['culture_history', 'architecture'],
  buddhist_temple: ['culture_history', 'architecture'],
  hindu_temple: ['culture_history', 'architecture'],
  mosque: ['culture_history', 'architecture'],
  church: ['culture_history', 'architecture'],
  national_park: ['nature_scenery', 'outdoor_activities'],
  park: ['nature_scenery', 'outdoor_activities'],
  botanical_garden: ['nature_scenery'],
  garden: ['nature_scenery'],
  hiking_area: ['nature_scenery', 'outdoor_activities'],
  beach: ['nature_scenery', 'outdoor_activities'],
  restaurant: ['food_drink'],
  cafe: ['food_drink'],
  food_court: ['food_drink'],
  market: ['shopping'],
  shopping_mall: ['shopping'],
  department_store: ['shopping'],
  night_club: ['entertainment_nightlife'],
  bar: ['food_drink', 'entertainment_nightlife'],
  performing_arts_theater: ['entertainment_nightlife', 'art_museums'],
  spa: ['wellness_relaxation'],
  wellness_center: ['wellness_relaxation'],
};
const OUTDOOR = new Set([
  'national_park',
  'park',
  'botanical_garden',
  'garden',
  'hiking_area',
  'beach',
]);
export type ScoringPlace = PlanScorePlace & {
  types?: readonly string[];
  source?: PlanScoreEvidence['source'];
  coordinates?: { latitude: number; longitude: number } | null;
  name?: string | null;
};
export const interestsForPlaceTypes = (types: readonly string[]) => [
  ...new Set(types.flatMap((type) => TYPE_INTERESTS[type] ?? [])),
];
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
  context?: DestinationContextGroup[];
  forecasts?: readonly ScoringForecast[];
  routeComparison?: PlanScoreRouteEfficiencyInput;
};
function supported(
  criteria: readonly {
    id: string;
    source: PlanScoreEvidence['source'];
    satisfied: boolean | null;
  }[],
): PlanScoreFactorResult {
  const known = criteria.filter((c) => c.satisfied !== null);
  if (!known.length) return UNKNOWN;
  return {
    state: 'EVALUATED',
    score: (100 * known.filter((c) => c.satisfied).length) / known.length,
    coverage: (100 * known.length) / criteria.length,
    evidence: known.map((c) => ({ ref: c.id, source: c.source })),
  };
}
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
    | 'SEASONAL_PATTERN'
    | 'PUBLIC_HOLIDAY'
    | 'PARTIAL_ACCESS'
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
  const items = input.items.map((item) => {
    const place = input.places.find((p) => p.tripPlaceId === item.placeId);
    const closure = (input.context ?? [])
      .flatMap((g) => g.records)
      .find(
        (r) =>
          r.kind === 'closure' &&
          r.certainty === 'fact' &&
          r.accessEffect === 'full_closure' &&
          input.date &&
          r.matchedDates.includes(input.date) &&
          r.scope.venueAliases?.some(
            (alias) => alias.toLocaleLowerCase() === place?.name?.toLocaleLowerCase(),
          ),
      );
    return closure
      ? {
          ...item,
          openingHours: {
            status: 'KNOWN' as const,
            intervals: [],
            source: 'FRESH_PROVIDER' as const,
          },
        }
      : item;
  });
  const feasibility = evaluateFeasibility({ items, commitments: input.commitments, availability });
  const travel =
    noVisits && !input.segments.some((s) => s.scope === 'LOCAL')
      ? { factor: NOT_APPLICABLE, totalMinutes: null }
      : evaluateTravelEffort(input.segments);
  const routeComparison = input.routeComparison
    ? evaluateRouteEfficiency(input.routeComparison)
    : {
        factor:
          input.items.length < 2 || travel.factor.state === 'NOT_APPLICABLE'
            ? NOT_APPLICABLE
            : UNKNOWN,
        bestMinutes: null,
        plannedMinutes: null,
      };
  const route = combineSignals([
    { weight: 60, result: travel.factor },
    { weight: 40, result: routeComparison.factor },
  ]);
  const pace = effectiveTripPace(preferences);
  const target = Math.min(
    { relaxed: 360, balanced: 480, packed: 600 }[pace.pace],
    availableMinutes ?? Infinity,
  );
  const evidence: PlanScoreEvidence[] = [
    { ref: 'pace', source: pace.source === 'user' ? 'USER_OWNED' : 'ESTIMATED' },
  ];
  let load = 0;
  const journeyCovered = input.segments
    .filter((s) => s.scope === 'LONG_DISTANCE')
    .every((s) =>
      input.commitments.some(
        (c) => c.longDistance && c.endKnown !== false && c.itemId && s.itemIds?.includes(c.itemId),
      ),
    );
  let complete =
    journeyCovered &&
    !input.items.some(
      (item, index) => (item.inboundRequired ?? index > 0) && item.inboundTravel === null,
    );
  const represented = new Set(
    input.commitments.flatMap((c) => (c.longDistance && c.itemId ? [c.itemId] : [])),
  );
  for (const item of input.items) {
    if (represented.has(item.id)) continue;
    if (!item.duration) {
      complete = false;
      continue;
    }
    load += item.duration.minutes * (item.longDistance ? 0.5 : 1);
    // Unknown activity intensity is a neutral estimate, never an exhaustion claim.
    evidence.push(
      { ref: `duration:${item.id}`, source: item.duration.source },
      { ref: `intensity:${item.id}`, source: 'ESTIMATED' },
    );
  }
  for (const c of input.commitments) {
    if (!c.longDistance && c.itemId && input.items.some((i) => i.id === c.itemId)) continue;
    if (!c.longDistance && c.endMinute === c.startMinute) complete = false;
    if (c.endKnown === false) {
      complete = false;
      continue;
    }
    load += (c.endMinute - c.startMinute) * (c.longDistance ? 0.5 : 1);
    evidence.push({ ref: `commitment:${c.id}`, source: c.source });
  }
  for (const leg of input.segments) {
    if (leg.scope === 'LONG_DISTANCE') continue; // Structured journey duration is counted above.
    if (leg.status !== 'KNOWN') {
      complete = false;
      continue;
    }
    const multiplier = leg.mode === 'walk' ? 1.25 : leg.mode === 'transit' ? 0.75 : 1;
    load += leg.duration.minutes * multiplier;
    evidence.push({ ref: `segment:${leg.id}`, source: leg.duration.source });
  }
  if (!input.items.length && !input.commitments.length && !rest && !input.segments.length)
    complete = false;
  if (rest && !input.items.length && availableMinutes === null) complete = false;
  if (availability) evidence.push({ ref: 'availability', source: 'USER_OWNED' });
  const ratio = target > 0 ? load / target : null;
  const provedOverload = ratio !== null && ratio > 1;
  const comfort: PlanScoreFactorResult =
    complete || provedOverload
      ? {
          state: 'EVALUATED',
          score: loadScore(ratio ?? 0),
          coverage: complete ? 100 : 50,
          evidence,
        }
      : UNKNOWN;
  const knownPlaces = [...new Map(input.places.map((p) => [p.tripPlaceId, p])).values()];
  const fit = preferences.interests.length
    ? supported(
        knownPlaces.map((place) => ({
          id: `interest:${place.tripPlaceId}`,
          source: place.source ?? 'CACHED_PROVIDER',
          satisfied: interestsForPlaceTypes(place.types ?? []).some((i) =>
            preferences.interests.includes(i as (typeof preferences.interests)[number]),
          )
            ? true
            : null,
        })),
      )
    : UNKNOWN;
  const advisories: DayAdvisory[] = [];
  // City-wide seasonal guidance does not prove suitability at an individual venue.
  const timeCriteria: Array<{
    id: string;
    source: PlanScoreEvidence['source'];
    satisfied: boolean | null;
  }> = knownPlaces.map((place) => ({
    id: `season:${place.tripPlaceId}`,
    source: 'ESTIMATED',
    satisfied: null,
  }));
  for (const group of input.context ?? [])
    for (const record of group.records) {
      if (record.kind === 'season' || record.kind === 'demand')
        advisories.push({ code: 'SEASONAL_PATTERN', references: [record.id] });
      if (record.kind === 'holiday')
        advisories.push({ code: 'PUBLIC_HOLIDAY', references: [record.id] });
      if (record.accessEffect === 'partial_restriction')
        advisories.push({ code: 'PARTIAL_ACCESS', references: [record.id] });
    }
  for (const forecast of input.forecasts ?? [])
    if (
      forecast.precipitationProbability != null &&
      forecast.precipitationProbability >= 60 &&
      knownPlaces.some(
        (p) => forecast.placeIds.includes(p.tripPlaceId) && p.types?.some((t) => OUTDOOR.has(t)),
      )
    )
      advisories.push({ code: 'RAIN_FORECAST', references: [...forecast.placeIds] });
  if (input.date)
    for (const place of knownPlaces) {
      if (!place.coordinates || !place.types?.some((t) => OUTDOOR.has(t))) continue;
      const sunlight = daylightUtc(input.date, place.coordinates);
      const item = input.items.find((i) => i.placeId === place.tripPlaceId);
      if (sunlight && item?.start && item.duration) {
        if (input.originInstant !== undefined) {
          const start = input.originInstant + item.start.minutes * 60000;
          const end = start + item.duration.minutes * 60000;
          timeCriteria.push({
            id: `daylight:${place.tripPlaceId}`,
            source: 'ESTIMATED',
            satisfied: start >= sunlight.sunrise && end <= sunlight.sunset ? true : null,
          });
          if (
            place.types.includes('hiking_area') &&
            (start < sunlight.sunrise || end > sunlight.sunset)
          )
            advisories.push({ code: 'DAYLIGHT_LIMIT', references: [item.id] });
        }
      }
    }
  const supportedTiming = supported(timeCriteria);
  const timing = knownPlaces.length
    ? supportedTiming.state === 'EVALUATED'
      ? { ...supportedTiming, coverage: (supportedTiming.coverage ?? 100) / 4 }
      : supportedTiming
    : noVisits
      ? NOT_APPLICABLE
      : UNKNOWN;
  const quality = noVisits
    ? NOT_APPLICABLE
    : combineSignals([
        { weight: 40, result: fit },
        { weight: 25, result: UNKNOWN },
        { weight: 20, result: timing },
        { weight: 15, result: evaluatePlaceQuality(knownPlaces) },
      ]);
  const intentEvidence: PlanScoreEvidence[] = [{ ref: 'intent', source: 'USER_OWNED' }];
  const restful =
    rest && input.items.length === 0 && input.commitments.length === 0 && availableMinutes !== null;
  const focused = context.intent === 'focused';
  const coherence: PlanScoreFactorResult = restful
    ? { state: 'EVALUATED', score: 100, evidence: intentEvidence }
    : focused && fit.state === 'EVALUATED'
      ? fit
      : feasibility.factor.state === 'EVALUATED' &&
          feasibility.factor.coverage === 100 &&
          !feasibility.conflicts.length &&
          travel.factor.state === 'EVALUATED'
        ? { ...feasibility.factor, coverage: 100 / 3 }
        : UNKNOWN;
  const themes = [...new Set(knownPlaces.flatMap((p) => interestsForPlaceTypes(p.types ?? [])))];
  const variety: PlanScoreFactorResult =
    rest || transit || focused
      ? NOT_APPLICABLE
      : context.intent === 'explore' &&
          themes.filter((t) =>
            preferences.interests.includes(t as (typeof preferences.interests)[number]),
          ).length >= 2
        ? {
            state: 'EVALUATED',
            score: 100,
            evidence: knownPlaces.map((p) => ({
              ref: `type:${p.tripPlaceId}`,
              source: p.source ?? 'CACHED_PROVIDER',
            })),
            coverage:
              (100 * knownPlaces.filter((p) => p.types?.length).length) /
              Math.max(1, knownPlaces.length),
          }
        : UNKNOWN;
  const areaFit = supported(
    knownPlaces.map((place) => ({
      id: `area:${place.tripPlaceId}`,
      source: place.source ?? 'CACHED_PROVIDER',
      satisfied: (input.context ?? [])
        .filter(
          (g) =>
            g.destination ===
            matchContextDestination({ name: place.name, coordinates: place.coordinates }),
        )
        .some((g) =>
          g.records.some(
            (r) =>
              r.kind === 'experience' &&
              r.interestMatch &&
              r.interests.some((i) => interestsForPlaceTypes(place.types ?? []).includes(i)),
          ),
        )
        ? true
        : null,
    })),
  );
  const utilization =
    rest || transit
      ? NOT_APPLICABLE
      : areaFit.state === 'EVALUATED'
        ? { ...areaFit, coverage: (areaFit.coverage ?? 100) / 2 }
        : UNKNOWN;
  const composition = combineSignals([
    { weight: 30, result: coherence },
    { weight: 30, result: variety },
    { weight: 40, result: utilization },
  ]);
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
  const dayInput: PlanScoreDayInput = {
    dayId: input.dayId,
    date: input.date,
    availableMinutes,
    loadRatio: complete ? ratio : null,
    rest,
    normalizedRevision: scoringInputRevision(input),
    conflictReferences: Object.fromEntries(feasibility.conflicts.map((c) => [c.id, c.subjectIds])),
    coreEvaluated: feasibility.factor.state === 'EVALUATED' || travel.factor.state === 'EVALUATED',
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
  return {
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
      lowerBoundMinutes: !complete && provedOverload ? load : null,
    },
    travel,
    route: routeComparison,
    advisories,
    utilization,
    variety,
    // Daylight supports an outdoor time slot, not seasonal destination suitability.
    // The current catalogue's seasonal tendencies cannot establish this trip component.
    seasonalFit: noVisits ? NOT_APPLICABLE : UNKNOWN,
  };
}
const parseMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
