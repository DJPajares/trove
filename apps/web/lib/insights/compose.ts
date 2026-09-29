import type { PlanScoreExplanation, PlanScoreExplanationGroups, TripContext } from '@trove/types';

/**
 * Insights answer "what should the traveller know?", never "how good is the
 * plan?". They come from two places Trove already has: the trip context (public
 * holidays, typical conditions) and the day advisories the Plan Score evaluator
 * computes but never scores.
 */
export type InsightKind = 'rain' | 'holiday' | 'daylight' | 'walking' | 'continuous' | 'climate';
/** How sure an item is, shown beside it so a pattern never reads as a fact. */
export type InsightCertainty = 'forecast' | 'official' | 'expected' | 'estimate' | 'pattern';
/** The one practical takeaway a typical month suggests, if any. */
export type ClimateAdvice = 'indoor' | 'heat' | 'cold' | 'none';

export type Insight = {
  id: string;
  kind: InsightKind;
  certainty: InsightCertainty;
  /** 1-based day numbers the item applies to, for trip-wide views. */
  dayNumbers: number[];
  holiday?: { name: string; date: string };
  climate?: {
    month: number;
    years: { from: number; to: number };
    temperatureMaxC: number;
    temperatureMinC: number;
    /** Days with rain in ten, rounded. */
    wetDays: number;
    advice: ClimateAdvice;
  };
  /** The advisory an item came from, so its suggested action can resolve. */
  explanation?: PlanScoreExplanation;
};

export type InsightScope = { kind: 'trip' } | { kind: 'day'; dayId: string };

const ADVISORY_KINDS: Record<string, InsightKind> = {
  RAIN_FORECAST: 'rain',
  DAYLIGHT_LIMIT: 'daylight',
  WALKING_LOAD: 'walking',
  CONTINUOUS_ACTIVITY: 'continuous',
};
/** Most specific and time-sensitive first; a month's pattern last. */
const RANK: Record<InsightKind, number> = {
  rain: 0,
  holiday: 1,
  daylight: 2,
  walking: 3,
  continuous: 4,
  climate: 5,
};
const CERTAINTY: Record<InsightKind, InsightCertainty> = {
  rain: 'forecast',
  holiday: 'official',
  daylight: 'estimate',
  walking: 'estimate',
  continuous: 'estimate',
  climate: 'pattern',
};

/** Thresholds are about what a month typically brings, stated as a tendency. */
export function climateAdvice(norm: { temperatureMaxC: number; wetDayShare: number }) {
  if (norm.wetDayShare >= 0.5) return 'indoor' as const;
  if (norm.temperatureMaxC >= 32) return 'heat' as const;
  if (norm.temperatureMaxC <= 8) return 'cold' as const;
  return 'none' as const;
}

export function composeInsights(input: {
  context: TripContext | null | undefined;
  /** Day-level Plan Score explanations, where a score is available. */
  explanations?: ReadonlyMap<string, PlanScoreExplanationGroups>;
  scope: InsightScope;
}): Insight[] {
  const days = input.context?.days ?? [];
  const inScope = (dayId: string) => input.scope.kind === 'trip' || input.scope.dayId === dayId;
  const dayNumbers = (ids: readonly string[]) =>
    days.flatMap((day, index) => (ids.includes(day.id) && inScope(day.id) ? [index + 1] : []));

  const insights: Insight[] = [];

  // One item per kind of advisory across the scope, naming every day it hits.
  const advisories = new Map<InsightKind, { explanation: PlanScoreExplanation; ids: string[] }>();
  for (const [dayId, groups] of input.explanations ?? []) {
    if (!inScope(dayId)) continue;
    for (const explanation of [...groups.worthImproving, ...groups.whatWorks]) {
      const kind = ADVISORY_KINDS[explanation.code];
      if (!kind) continue;
      const entry = advisories.get(kind) ?? { explanation, ids: [] };
      if (!entry.ids.includes(dayId)) entry.ids.push(dayId);
      advisories.set(kind, entry);
    }
  }
  for (const [kind, { explanation, ids }] of advisories)
    insights.push({
      id: kind,
      kind,
      certainty: CERTAINTY[kind],
      dayNumbers: dayNumbers(ids),
      explanation,
    });

  for (const holiday of input.context?.holidays ?? []) {
    if (!holiday.dayIds.some(inScope)) continue;
    insights.push({
      id: `holiday:${holiday.countryCode}:${holiday.date}:${holiday.name}`,
      kind: 'holiday',
      certainty: holiday.certainty === 'expected' ? 'expected' : 'official',
      dayNumbers: dayNumbers(holiday.dayIds),
      holiday: { name: holiday.name, date: holiday.date },
    });
  }

  for (const norm of input.context?.climate ?? []) {
    if (!norm.dayIds.some(inScope)) continue;
    insights.push({
      id: `climate:${norm.month}:${norm.dayIds[0]}`,
      kind: 'climate',
      certainty: 'pattern',
      dayNumbers: dayNumbers(norm.dayIds),
      climate: {
        month: norm.month,
        years: norm.years,
        temperatureMaxC: norm.temperatureMaxC,
        temperatureMinC: norm.temperatureMinC,
        wetDays: Math.round(norm.wetDayShare * 10),
        advice: climateAdvice(norm),
      },
    });
  }

  return insights.toSorted(
    (a, b) =>
      RANK[a.kind] - RANK[b.kind] ||
      (a.dayNumbers[0] ?? 0) - (b.dayNumbers[0] ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
