import { getPrismaClient, Prisma } from '@trove/db';
import { PLACE_CACHE_TTL_MS } from './cached-places.js';
import { PLACE_DETAILS_FAILURE_TTL_MS } from './place-details-failures.js';
import { PLACE_EVIDENCE_TTL_MS } from './place-evidence-cache.js';
import { TRAVEL_LEG_CACHE_TTL_MS } from './route-evidence-cache.js';
import { WEATHER_CACHE_TTL_MS, WEATHER_CACHE_POLICY } from '@trove/types';

/** Grounding decisions are reused for as long as the place snapshot they point at. */
export const GROUNDING_CACHE_TTL_MS = PLACE_CACHE_TTL_MS;

/**
 * A stored forecast is served past its one/six-hour freshness only when the weather
 * provider is down, so it is kept for the same 30 days as other provider data.
 */
export const WEATHER_SNAPSHOT_RETENTION_MS = PLACE_CACHE_TTL_MS;

/**
 * Removes provider-derived values once they reach the end of their stored life.
 *
 * Nothing here is removed early: every dataset is cut off at exactly its own
 * lifetime, so a row is kept for the whole of it. Reads already ignore expired
 * values immediately; this removes the raw values themselves (PRD 11.7).
 */
export async function cleanupProviderEvidence(now = new Date()) {
  const prisma = getPrismaClient();
  const before = (lifetimeMs: number) => new Date(now.getTime() - lifetimeMs);

  const evidence = await prisma.placeProviderRef.updateMany({
    where: { cachedEvidenceAt: { lte: before(PLACE_EVIDENCE_TTL_MS) } },
    data: {
      cachedEvidence: Prisma.DbNull,
      cachedEvidenceAt: null,
      cachedEvidenceLanguage: null,
      cachedEvidenceRegion: null,
    },
  });

  // The provider reference itself stays: it is the Place's link to Google. Only
  // what Google said about the place is cleared, and the next time its owner
  // opens the trip the place is re-resolved on demand.
  const identity = await prisma.placeProviderRef.updateMany({
    where: { cachedAt: { lte: before(PLACE_CACHE_TTL_MS) } },
    data: {
      cachedAt: null,
      cachedFormattedAddress: null,
      cachedGoogleMapsUri: null,
      cachedLanguageCode: null,
      cachedLatitude: null,
      cachedLongitude: null,
      cachedName: null,
      cachedPrimaryType: null,
      cachedTimeZone: null,
      cachedTypes: [],
      cachedUtcOffsetMinutes: null,
    },
  });

  const failures = await prisma.placeProviderRef.updateMany({
    where: { detailsFailedAt: { lte: before(PLACE_DETAILS_FAILURE_TTL_MS) } },
    data: { detailsFailedAt: null, detailsFailureCode: null },
  });

  const legs = await prisma.travelLegCache.deleteMany({
    where: { fetchedAt: { lte: before(TRAVEL_LEG_CACHE_TTL_MS) } },
  });

  const grounding = await prisma.aiPlaceGroundingCache.deleteMany({
    where: { checkedAt: { lte: before(GROUNDING_CACHE_TTL_MS) } },
  });

  // The snapshot's day rows go with it (cascade).
  const weather = await prisma.weatherForecastSnapshot.deleteMany({
    where: { fetchedAt: { lte: before(WEATHER_SNAPSHOT_RETENTION_MS) } },
  });
  const weatherContext = await prisma.weatherContextSnapshot.deleteMany({
    where: { fetchedAt: { lte: before(WEATHER_CACHE_TTL_MS) } },
  });

  const climate = await prisma.climateNormSnapshot.deleteMany({
    where: { fetchedAt: { lte: before(WEATHER_CACHE_POLICY.seasonalMs) } },
  });

  return {
    clearedFailureMarkers: failures.count,
    clearedPlaceEvidence: evidence.count,
    clearedPlaceIdentity: identity.count,
    deletedGroundingDecisions: grounding.count,
    deletedTravelLegs: legs.count,
    deletedWeatherSnapshots: weather.count,
    deletedWeatherContextSnapshots: weatherContext.count,
    deletedClimateNormSnapshots: climate.count,
  };
}
