import { getPrismaClient } from '@trove/db';

import type { PlaceSnapshotSource } from './place-data.js';

export type GroundingCacheReference = PlaceSnapshotSource & {
  id: string;
  placeId: string;
  provider: 'GOOGLE';
};

export type GroundingCacheEntry = {
  checkedAt: Date;
  outcome: string;
  placeProviderRef: GroundingCacheReference | null;
};

export type GroundingCacheWrite = { checkedAt: Date } & (
  | { outcome: 'verified'; externalPlaceId: string; placeId: string }
  | { outcome: 'unresolved' | 'ambiguous' }
);

export interface AiPlaceGroundingCacheRepository {
  read(key: string): Promise<GroundingCacheEntry | null>;
  write(key: string, entry: GroundingCacheWrite): Promise<void>;
}

/**
 * Stores an identity decision, never a search response. Only the grounder can
 * establish uniqueness: a lookup among known Place names cannot reproduce it.
 *
 * Google permits storing Place IDs (https://developers.google.com/maps/documentation/places/web-service/policies).
 * The lookup fingerprint and outcome are Trove metadata; provider display data
 * remains in the existing snapshot, whose lifetime this cache never extends.
 */
export class PrismaAiPlaceGroundingCacheRepository implements AiPlaceGroundingCacheRepository {
  async read(key: string): Promise<GroundingCacheEntry | null> {
    return getPrismaClient().aiPlaceGroundingCache.findUnique({
      where: { key },
      include: { placeProviderRef: true },
    });
  }

  async write(key: string, entry: GroundingCacheWrite) {
    const prisma = getPrismaClient();
    let placeProviderRefId: string | null = null;
    if (entry.outcome === 'verified') {
      const reference = await prisma.placeProviderRef.findUnique({
        where: {
          provider_externalPlaceId: { provider: 'GOOGLE', externalPlaceId: entry.externalPlaceId },
          placeId: entry.placeId,
        },
        select: { id: true },
      });
      if (!reference) return;
      placeProviderRefId = reference.id;
    }
    const data = { checkedAt: entry.checkedAt, outcome: entry.outcome, placeProviderRefId };
    await prisma.aiPlaceGroundingCache.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  }
}
