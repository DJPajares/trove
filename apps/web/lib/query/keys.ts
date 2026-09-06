import { EDITORIAL_IMAGE_RESOLUTION_VERSION } from '@/lib/media/editorial-images';
import { WEATHER_CONTRACT_VERSION } from '@/lib/weather/api';

import type { TripModeContextRequestOptions } from '@/lib/itinerary/api';
import type { TemperatureUnit } from '@/lib/profile/preferences';

/**
 * Every query key in Trove, in one place.
 *
 * The first element is the key's *root*, and roots are load-bearing twice over:
 * `invalidateTripQueries` matches on them, and `shouldDehydrateQuery` decides
 * from them whether an entry may be written to disk. A key assembled inline at
 * a call site is invisible to both, so keys are only ever built here.
 */
export const queryKeys = {
  aiPlanningAvailability: () => ['ai-planning', 'availability'] as const,
  aiPlanningRecovery: () => ['ai-planning', 'recovery'] as const,
  aiPlanningSession: (sessionId: string) => ['ai-planning', 'session', sessionId] as const,
  currencies: () => ['currency', 'list'] as const,
  currencyRate: (base: string, quote: string) => ['currency', 'rate', base, quote] as const,

  /**
   * The whole day's board, which is what makes converting a trip's spending one
   * request rather than one per currency. It sits under `currency` so it
   * inherits that root's twelve-hour stale time and its permission to persist -
   * both of which already match the board's own cache window.
   */
  currencyRateBoard: () => ['currency', 'rate-board'] as const,

  /**
   * Keyed by resolved subject keys rather than by the subjects themselves, so
   * two screens asking for the same photographs in a different order share one
   * answer instead of billing the resolve endpoint twice. The resolution version
   * rides along because this cache is never refetched on a timer: without it a
   * client keeps serving an answer the server has already stopped agreeing with.
   */
  editorialImages: (subjectKeys: readonly string[]) =>
    [
      'editorial-images',
      EDITORIAL_IMAGE_RESOLUTION_VERSION,
      [...subjectKeys].sort().join(' '),
    ] as const,

  expenses: (tripId: string) => ['expenses', tripId] as const,
  itinerary: (tripId: string) => ['itinerary', tripId] as const,

  /**
   * `revision` is the ordering signature the caller is showing. It belongs in
   * the key because a leg chain computed for one ordering is wrong for any
   * other - see `itineraryDayRouteRevision`.
   */
  itineraryDayRoutes: (
    tripId: string,
    itineraryDayId: string,
    revision: string,
    includePolyline: boolean,
    languageCode: string | undefined,
  ) =>
    [
      'itinerary-day-routes',
      tripId,
      itineraryDayId,
      revision,
      includePolyline,
      languageCode ?? null,
    ] as const,

  memories: (tripId: string) => ['memories', tripId] as const,
  notifications: () => ['notifications', 'list'] as const,
  planScore: (tripId: string) => ['plan-score', tripId] as const,
  profile: () => ['profile'] as const,
  reservations: (tripId: string) => ['reservations', tripId] as const,
  savedPlaces: () => ['saved'] as const,
  taskTemplates: () => ['task-templates'] as const,
  tasks: (tripId: string) => ['tasks', tripId] as const,
  trip: (tripId: string) => ['trip', tripId] as const,
  tripInfo: (tripId: string) => ['trip-info', tripId] as const,
  tripPlaces: (tripId: string) => ['trip-places', tripId] as const,
  trips: () => ['trips'] as const,

  /**
   * Date and time are in the key on purpose: Preview day-stepping asks a
   * different question for each day, so stepping back to a day already seen
   * costs nothing rather than re-billing an endpoint that can reach Routes and
   * Places.
   */
  tripModeContext: (
    tripId: string,
    options: Pick<
      TripModeContextRequestOptions,
      'at' | 'clockTimeZone' | 'date' | 'languageCode' | 'time'
    >,
  ) =>
    [
      'trip-mode-context',
      tripId,
      options.date ?? null,
      options.time ?? null,
      options.at ?? null,
      options.languageCode ?? null,
      // The clock the answer was computed on. A traveller who lands somewhere
      // new is asking a different question, and this root never refetches on a
      // timer, so without it they would keep the answer from the last country.
      options.clockTimeZone ?? null,
    ] as const,

  /**
   * One question about the whole trip, asked by Today, the day rail, the trip
   * overview, the Now card and the home ribbon alike.
   *
   * The unit is in the key because it changes the numbers, and the contract
   * version because this entry is written to disk and never refetched on a
   * timer - without it a returning traveller keeps reading a shape the server
   * has stopped producing. Nothing else varies: every surface asks the same
   * question, so crossing between them reads the answer already in hand.
   */
  tripWeather: (tripId: string, temperatureUnit: TemperatureUnit) =>
    ['trip-weather', tripId, WEATHER_CONTRACT_VERSION, temperatureUnit] as const,
} as const;

/**
 * Keys whose answers cost a Google Places or Routes call to produce.
 *
 * These carry `staleTime: Infinity` and are refreshed only by an explicit
 * invalidation or by a change in the key itself - never by a timer, a window
 * focus, or a remount. AGENTS.md's warning about a per-day call inside a
 * per-trip loop is what this list exists to keep true.
 */
export const PROVIDER_BILLABLE_QUERY_ROOTS = new Set([
  'editorial-images',
  'itinerary-day-routes',
  'plan-score',
  'trip-mode-context',
]);

/**
 * Roots the offline trip snapshot does not already own, and which may therefore
 * be written to disk. See `shouldDehydrateQuery` in ./client for why the
 * snapshot-owned roots are deliberately absent from this set.
 */
export const PERSISTED_QUERY_ROOTS = new Set([
  'currency',
  'editorial-images',
  'itinerary-day-routes',
  'plan-score',
  'profile',
  'saved',
  'task-templates',
  'trip-places',
  'trip-weather',
]);

/** Roots scoped to a single trip, and the set `invalidateTripQueries` clears. */
export const TRIP_SCOPED_QUERY_ROOTS = [
  'expenses',
  'itinerary',
  'itinerary-day-routes',
  'memories',
  'plan-score',
  'reservations',
  'tasks',
  'trip',
  'trip-info',
  'trip-mode-context',
  'trip-places',
  'trip-weather',
] as const;

export type TripScopedQueryRoot = (typeof TRIP_SCOPED_QUERY_ROOTS)[number];
