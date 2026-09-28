import { z } from 'zod';

export const TRAVEL_INTERESTS = [
  'culture_history',
  'art_museums',
  'food_drink',
  'nature_scenery',
  'outdoor_activities',
  'architecture',
  'shopping',
  'entertainment_nightlife',
  'wellness_relaxation',
] as const;
export const tripPlanningPreferencesSchema = z
  .object({
    pace: z.enum(['relaxed', 'balanced', 'packed']).nullable(),
    interests: z
      .array(z.enum(TRAVEL_INTERESTS))
      .max(TRAVEL_INTERESTS.length)
      .transform((values) => [...new Set(values)]),
    unmatchedInterests: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  })
  .strict();
export type TripPlanningPreferences = z.infer<typeof tripPlanningPreferencesSchema>;
export function readTripPlanningPreferences(value: unknown): TripPlanningPreferences {
  const result = tripPlanningPreferencesSchema.safeParse(value);
  return result.success ? result.data : { pace: null, interests: [], unmatchedInterests: [] };
}
export function effectiveTripPace(value: TripPlanningPreferences) {
  return {
    pace: value.pace ?? 'balanced',
    source: value.pace ? ('user' as const) : ('default' as const),
  };
}
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const dayPlanningContextSchema = z
  .object({
    intent: z.enum(['explore', 'focused', 'rest', 'transit']).nullable(),
    availability: z
      .object({ start: localTime, end: localTime })
      .strict()
      .refine((window) => window.end > window.start, { error: 'invalid_availability_window' })
      .nullable(),
  })
  .strict();
export type DayPlanningContext = z.infer<typeof dayPlanningContextSchema>;
export function readDayPlanningContext(value: unknown): DayPlanningContext {
  const result = dayPlanningContextSchema.safeParse(value);
  return result.success ? result.data : { intent: null, availability: null };
}

/** Only reviewed aliases make deterministic matches. Unmatched prose stays available. */
export function planningPreferencesFromAi(
  input: { interests: string[]; pace: string | null },
  explicitPace: boolean,
  inferredInterests: boolean,
): TripPlanningPreferences {
  const aliases: Record<string, (typeof TRAVEL_INTERESTS)[number]> = {
    culture: 'culture_history',
    history: 'culture_history',
    art: 'art_museums',
    museums: 'art_museums',
    food: 'food_drink',
    dining: 'food_drink',
    nature: 'nature_scenery',
    scenery: 'nature_scenery',
    outdoors: 'outdoor_activities',
    hiking: 'outdoor_activities',
    architecture: 'architecture',
    shopping: 'shopping',
    nightlife: 'entertainment_nightlife',
    entertainment: 'entertainment_nightlife',
    wellness: 'wellness_relaxation',
    relaxation: 'wellness_relaxation',
  };
  const interests = new Set<(typeof TRAVEL_INTERESTS)[number]>();
  const unmatchedInterests: string[] = [];
  if (!inferredInterests)
    for (const label of input.interests) {
      const normalized = label.toLowerCase().trim().replaceAll('_', ' ');
      const match =
        aliases[normalized] ??
        TRAVEL_INTERESTS.find((id) => id.replaceAll('_', ' ') === normalized);
      if (match) interests.add(match);
      else unmatchedInterests.push(label);
    }
  return tripPlanningPreferencesSchema.parse({
    pace: explicitPace ? input.pace : null,
    interests: [...interests],
    unmatchedInterests,
  });
}
