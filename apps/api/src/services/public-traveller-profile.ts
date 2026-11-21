import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';

import { MEMORY_PHOTOS_BUCKET } from './memories.js';
import { PROFILE_PHOTOS_BUCKET } from './profile.js';
import { createStorageCleanupClient } from './trip-media-cleanup.js';
import { formatDateOnly } from './trip-rules.js';

/** Long enough to load the page's two images, short enough to lapse soon after a removal. */
const PUBLIC_PHOTO_LINK_SECONDS = 10 * 60;

/**
 * No such traveller. One error for an unknown id and a malformed one, so the
 * endpoint answers every miss the same way.
 */
export class PublicTravellerNotFoundError extends Error {
  constructor() {
    super('traveller_not_found');
    this.name = 'PublicTravellerNotFoundError';
  }
}

export type PublicTravellerTrip = {
  /** ISO 3166-1 alpha-2, in the order the traveller picked them. */
  countries: string[];
  endDate: string;
  id: string;
  name: string;
  startDate: string;
};

export type PublicTravellerProfile = {
  traveller: {
    /** Signed briefly; null without one or where a link cannot be made. */
    avatarUrl: string | null;
    bio: string | null;
    /** The Memory photo they chose as their profile's cover, signed briefly. */
    coverPhoto: { contentType: string; url: string } | null;
    /** ISO 3166-1 alpha-2, for "Based in". */
    homeCountryCode: string | null;
    id: string;
    /** Null where they have not set one; the reader supplies its own wording. */
    name: string | null;
  };
  trips: PublicTravellerTrip[];
};

/**
 * A traveller as a stranger sees them (PRD 8.3): their name, photo, cover, bio and
 * home country, and the Public trips they have listed. Nothing else from their
 * profile - travel styles, preferences, settings - is read, let alone sent.
 *
 * Each trip carries only fields the trip's own read-only link already shows, so
 * the list can never say more about a trip than opening it would. It reads
 * Trove's database and nothing else - no Place, no editorial image, no billable
 * provider. The only other call is to Trove's own Storage, to sign the avatar
 * and cover.
 *
 * A trip is listed only when it is Public *and* stamped `publicListedAt`, which is
 * set when its owner chose Public under the current disclosure. Private trips are
 * filtered out in the query itself, so neither they nor their count ever reach
 * this process's response.
 */
export async function readPublicTravellerProfile(
  travellerId: string,
  options: { storage?: () => SupabaseClient | null } = {},
): Promise<PublicTravellerProfile> {
  const createStorage = options.storage ?? createStorageCleanupClient;
  const prisma = getPrismaClient();
  const profile = await prisma.profile.findUnique({
    where: { id: travellerId },
    select: {
      avatarPath: true,
      bio: true,
      coverMemoryPhoto: { select: { contentType: true, path: true } },
      displayName: true,
      homeCountryCode: true,
      id: true,
      ownedTrips: {
        where: { archivedAt: null, publicListedAt: { not: null }, visibility: 'PUBLIC' },
        select: { countries: true, endDate: true, id: true, name: true, startDate: true },
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      },
    },
  });
  if (!profile) throw new PublicTravellerNotFoundError();

  const storage = profile.avatarPath || profile.coverMemoryPhoto ? createStorage() : null;
  const [avatarUrl, coverUrl] = await Promise.all([
    signPhoto(storage, PROFILE_PHOTOS_BUCKET, profile.avatarPath),
    signPhoto(storage, MEMORY_PHOTOS_BUCKET, profile.coverMemoryPhoto?.path ?? null),
  ]);

  return {
    traveller: {
      avatarUrl,
      bio: profile.bio?.trim() || null,
      coverPhoto:
        coverUrl && profile.coverMemoryPhoto
          ? { contentType: profile.coverMemoryPhoto.contentType, url: coverUrl }
          : null,
      homeCountryCode: profile.homeCountryCode,
      id: profile.id,
      name: profile.displayName?.trim() || null,
    },
    trips: profile.ownedTrips.map((trip) => ({
      countries: trip.countries,
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      startDate: formatDateOnly(trip.startDate),
    })),
  };
}

/**
 * A short-lived link to one of this traveller's own two photos.
 *
 * A visitor has no session to sign with, so this uses the server's Storage
 * credential - and only ever for the paths stored on this profile row, never a
 * path from the request. A missing credential or a failed signature leaves the
 * photo out, and the page falls back to initials and its own cover.
 */
async function signPhoto(storage: SupabaseClient | null, bucket: string, path: string | null) {
  if (!storage || !path) return null;
  try {
    const { data, error } = await storage.storage
      .from(bucket)
      .createSignedUrl(path, PUBLIC_PHOTO_LINK_SECONDS);
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}
