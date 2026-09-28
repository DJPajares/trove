import { getPrismaClient, Prisma } from '@trove/db';
import { PLACE_EVIDENCE_TTL_MS } from './place-evidence-cache.js';

/** Reads exclude expired evidence immediately; scheduled cleanup removes the raw values. */
export async function cleanupProviderEvidence(now = new Date()) {
  const prisma = getPrismaClient();
  const cutoff = new Date(now.getTime() - PLACE_EVIDENCE_TTL_MS);
  const result = await prisma.placeProviderRef.updateMany({
    where: { cachedEvidenceAt: { lte: cutoff } },
    data: {
      cachedEvidence: Prisma.DbNull,
      cachedEvidenceAt: null,
      cachedEvidenceLanguage: null,
      cachedEvidenceRegion: null,
    },
  });
  return { clearedPlaceEvidence: result.count };
}
