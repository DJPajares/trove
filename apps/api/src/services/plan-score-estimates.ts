import type { ItineraryDayRoutes } from './itinerary-route-reader.js';
import type { PlanScoreDayItem } from './plan-score-factors.js';
import { haversineKm } from './plan-score-route-comparison.js';
import { NOT_APPLICABLE, UNKNOWN, type PlanScoreFactorResult } from './plan-score-rules.js';

/**
 * Itinerary-native estimates for Plan Score (PRD section 29.1). When a day has
 * no routed leg or no stated duration, the plan itself - where its stops are,
 * how they are timed, what kind of place each is - still says a good deal.
 * Everything here is local arithmetic on stored data, never a provider request,
 * and every value it produces is `ESTIMATED`, so it can qualify a risk but
 * never verify a conflict or a cap.
 */

type Coordinates = { latitude: number; longitude: number };
type EstimableMode = 'drive' | 'transit' | 'walk';
const ESTIMABLE_MODES = ['drive', 'transit', 'walk'] as const;

/**
 * Minutes for a straight-line distance, fitted to routed local legs: driving
 * has a fixed overhead and gets faster per kilometre on longer legs, reaching
 * highway pace between stays in different towns.
 */
const LEG_MODELS: Record<EstimableMode, (km: number) => number> = {
  drive: (km) =>
    8 +
    2.2 * Math.min(km, 10) +
    1.2 * Math.min(Math.max(0, km - 10), 40) +
    0.9 * Math.max(0, km - 50),
  transit: (km) => 12 + 2.5 * km,
  walk: (km) => 17 * km,
};
/** Beyond these distances a leg is not travel the mode plausibly covers; it stays unknown. */
const MAXIMUM_ESTIMATED_KM: Record<EstimableMode, number> = { drive: 600, transit: 300, walk: 25 };
/** Routed distance over straight-line distance, for the walking-load advisory. */
const ROAD_DETOUR = 1.35;
/** A duration inferred from the gap to the next start never exceeds this. */
const MAXIMUM_INFERRED_MINUTES = 6 * 60;
/**
 * An inferred visit leaves this much of the gap for the move on, so the
 * inference never manufactures the tight transition (PRD 29.1) it would
 * otherwise create by filling the whole gap.
 */
const TRANSITION_BUFFER_MINUTES = 15;

const isEstimableMode = (mode: string): mode is EstimableMode =>
  (ESTIMABLE_MODES as readonly string[]).includes(mode);

/** How the trip's own routed legs compare with the model, per mode. */
export type LegCalibration = Partial<Record<EstimableMode, number>>;

/**
 * Scales the model by the trip's routed legs of the same mode, so a city with
 * slow traffic estimates slow legs. Two samples are the minimum for a median,
 * and the factor is bounded so one odd leg cannot distort a whole trip.
 */
export function legCalibration(
  samples: ReadonlyArray<{ mode: string; km: number; minutes: number }>,
): LegCalibration {
  const calibration: LegCalibration = {};
  for (const mode of ESTIMABLE_MODES) {
    const ratios = samples
      .filter((sample) => sample.mode === mode && sample.km >= 0.2 && sample.minutes > 0)
      .map((sample) => sample.minutes / LEG_MODELS[mode](sample.km))
      .toSorted((a, b) => a - b);
    if (ratios.length < 2) continue;
    const middle = (ratios.length - 1) / 2;
    const median = (ratios[Math.floor(middle)]! + ratios[Math.ceil(middle)]!) / 2;
    calibration[mode] = Math.min(2, Math.max(0.5, median));
  }
  return calibration;
}

/** Estimated minutes for one local leg, or `null` when it cannot be estimated honestly. */
export function estimateLegMinutes(
  from: Coordinates,
  to: Coordinates,
  mode: string,
  calibration: LegCalibration = {},
): number | null {
  if (!isEstimableMode(mode)) return null;
  const km = haversineKm(from, to);
  if (!Number.isFinite(km) || km > MAXIMUM_ESTIMATED_KM[mode]) return null;
  if (km === 0) return 0;
  return LEG_MODELS[mode](km) * (calibration[mode] ?? 1);
}

type ChainPoint = ItineraryDayRoutes['segments'][number]['origin'];

/** Routed local legs with located ends, as calibration samples. */
export function routedLegSamples(
  routes: Iterable<ItineraryDayRoutes | undefined>,
  locate: (point: ChainPoint) => Coordinates | null,
) {
  const samples: Array<{ mode: string; km: number; minutes: number }> = [];
  for (const day of routes)
    for (const segment of day?.segments ?? []) {
      if (segment.scope !== 'local' || segment.durationSeconds === null || !segment.evidenceAsOf)
        continue;
      const from = locate(segment.origin);
      const to = locate(segment.destination);
      if (from && to)
        samples.push({
          mode: segment.mode,
          km: haversineKm(from, to),
          minutes: segment.durationSeconds / 60,
        });
    }
  return samples;
}

/**
 * Fills each unrouted local leg whose ends are both located with an estimate.
 * A leg with an unlocated end, a long-distance leg, or one too long to be local
 * travel stays unknown: the day never bypasses a stop it cannot place.
 */
export function withEstimatedLegs(
  routes: ItineraryDayRoutes | undefined,
  locate: (point: ChainPoint) => Coordinates | null,
  calibration: LegCalibration,
): ItineraryDayRoutes | undefined {
  if (!routes) return routes;
  return {
    ...routes,
    segments: routes.segments.map((segment) => {
      if (segment.scope !== 'local' || segment.durationSeconds !== null) return segment;
      const from = locate(segment.origin);
      const to = locate(segment.destination);
      if (!from || !to) return segment;
      const minutes = estimateLegMinutes(from, to, segment.mode, calibration);
      if (minutes === null) return segment;
      return {
        ...segment,
        durationSeconds: minutes * 60,
        distanceMeters: haversineKm(from, to) * 1000 * ROAD_DETOUR,
        estimated: true,
      };
    }),
  };
}

export type InferredDurations = {
  items: PlanScoreDayItem[];
  /** Time the traveller's own schedule leaves for an item before the next one. */
  allowedMinutes: ReadonlyMap<string, number>;
  /** Items whose duration is only the typical length for their kind of place. */
  typeInferred: ReadonlySet<string>;
};

/**
 * Durations for items without one: first from the traveller's own timing (the
 * gap to the next start, less the travel to it), then from the typical visit
 * length for the kind of place. A known duration is never replaced.
 */
export function inferDurations(
  items: readonly PlanScoreDayItem[],
  typicalMinutes: (item: PlanScoreDayItem) => number | null,
): InferredDurations {
  const allowedMinutes = new Map<string, number>();
  const typeInferred = new Set<string>();
  const inferred = items.map((item, index) => {
    const next = items[index + 1];
    if (item.start && next?.start && next.start.minutes > item.start.minutes) {
      const gap = next.start.minutes - item.start.minutes - (next.inboundTravel?.minutes ?? 0);
      if (gap > 0 && gap <= MAXIMUM_INFERRED_MINUTES) allowedMinutes.set(item.id, gap);
    }
    if (item.duration || item.longDistance) return item;
    if (item.blockType && item.blockType !== 'activity') return item;
    const typical = typicalMinutes(item);
    const allowed = allowedMinutes.get(item.id);
    if (allowed !== undefined) {
      const window = Math.max(0, allowed - TRANSITION_BUFFER_MINUTES);
      return {
        ...item,
        duration: {
          minutes: typical === null ? window : Math.min(window, typical),
          source: 'ESTIMATED' as const,
        },
      };
    }
    if (typical === null) return item;
    typeInferred.add(item.id);
    return { ...item, duration: { minutes: typical, source: 'ESTIMATED' as const } };
  });
  return { items: inferred, allowedMinutes, typeInferred };
}

/** Typical monthly conditions for a day's area, never a forecast. */
export type ScoringClimate = {
  temperatureMaxC: number;
  temperatureMinC: number;
  wetDayShare: number;
};

export type SeasonalVisit = { minutes: number; outdoor: boolean; midday: boolean };

const ramp = (value: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (value - from) / (to - from)));

/**
 * How well a day's outdoor plans suit the month's typical conditions. Indoor
 * plans suit any season, so a wet month only costs a day in proportion to its
 * outdoor time; there is no blanket rain-season deduction.
 */
export function seasonalDayFit(
  visits: readonly SeasonalVisit[],
  climate: ScoringClimate | null | undefined,
): { factor: PlanScoreFactorResult; wet: boolean; heat: boolean } {
  if (!visits.length) return { factor: NOT_APPLICABLE, wet: false, heat: false };
  if (!climate) return { factor: UNKNOWN, wet: false, heat: false };
  const total = visits.reduce((sum, visit) => sum + visit.minutes, 0);
  if (total <= 0) return { factor: UNKNOWN, wet: false, heat: false };
  const outdoor =
    visits.reduce((sum, visit) => sum + (visit.outdoor ? visit.minutes : 0), 0) / total;
  const middayOutdoor =
    visits.reduce((sum, visit) => sum + (visit.outdoor && visit.midday ? visit.minutes : 0), 0) /
    total;
  const wetness = ramp(climate.wetDayShare, 0.3, 0.7);
  const heat = ramp(climate.temperatureMaxC, 30, 35);
  const cold = ramp(-climate.temperatureMaxC, -10, 0);
  return {
    factor: {
      state: 'EVALUATED',
      score: 100 - 40 * outdoor * wetness - 20 * middayOutdoor * heat - 20 * outdoor * cold,
      evidence: [
        { ref: 'climate', source: 'ESTIMATED' },
        { ref: 'visit-kinds', source: 'CACHED_PROVIDER' },
      ],
    },
    wet: outdoor >= 0.5 && wetness >= 0.5,
    heat: middayOutdoor >= 0.3 && heat >= 0.6,
  };
}
