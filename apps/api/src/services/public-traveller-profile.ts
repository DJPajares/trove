import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';

import { MEMORY_PHOTOS_BUCKET } from './memories.js';
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import { PROFILE_PHOTOS_BUCKET } from './profile.js';
import { createStorageCleanupClient } from './trip-media-cleanup.js';
import {
  selectTripMemoryPreview,
  TRIP_MEMORY_PREVIEW_LIMIT,
  type MemoryPreviewPhotoRecord,
} from './trip-memory-preview.js';
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
  /** The trip's destinations, for the map and the count of places been. */
  destinations: {
    location: { latitude: number; longitude: number } | null;
    name: string;
    placeId: string;
  }[];
  endDate: string;
  experienceNote: string | null;
  experienceRating: number | null;
  id: string;
  /** A few of an ended trip's own Memory photos, signed briefly; empty while it is still ahead. */
  memoryPhotos: { contentType: string; id: string; url: string }[];
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
    /** Short tags for how they like to travel. */
    travelStyles: string[];
  };
  trips: PublicTravellerTrip[];
};

const PUBLIC_TRIP_MEMORY_ORDER = [
  { isHighlight: 'desc' as const },
  { highlightPosition: 'asc' as const },
  { capturedInstant: 'asc' as const },
];
const photoSelect = { contentType: true, id: true, path: true } as const;

/**
 * A traveller as anyone sees them (PRD 8.3): the same profile they see, with
 * everything that is not Public left out. Every traveller has one; there is no
 * profile switch.
 *
 * What is left out is decided here, in the queries, so it never reaches this
 * process's response: only their Public, unarchived trips are read - Private
 * ones, and how many there are, never are - and only those trips' Memories.
 * Their profile cover is shown only when it is a photograph from one of those
 * trips. Preferences and settings are never read.
 *
 * Each trip carries what the traveller's own profile shows of it - name, dates,
 * countries, destinations, their rating and note - and, once it has ended, up
 * to three of its own Memory photos. No billable provider and no editorial
 * image is reached; the only other call is to Trove's own Storage, to sign the
 * photos, with the server's credential and only for paths read from these rows.
 */
export async function readPublicTravellerProfile(
  travellerId: string,
  options: { now?: Date; storage?: () => SupabaseClient | null } = {},
): Promise<PublicTravellerProfile> {
  const createStorage = options.storage ?? createStorageCleanupClient;
  const today = formatDateOnly(options.now ?? new Date());
  const prisma = getPrismaClient();
  const profile = await prisma.profile.findUnique({
    where: { id: travellerId },
    select: {
      avatarPath: true,
      bio: true,
      coverMemoryPhoto: {
        select: { ...photoSelect, memory: { select: { trip: { select: { visibility: true } } } } },
      },
      displayName: true,
      homeCountryCode: true,
      id: true,
      travelStyles: true,
      ownedTrips: {
        where: { archivedAt: null, visibility: 'PUBLIC' },
        select: {
          countries: true,
          destinations: {
            orderBy: { position: 'asc' },
            select: {
              place: { include: placeProviderRefInclude },
              placeId: true,
            },
          },
          endDate: true,
          experienceNote: true,
          experienceRating: true,
          id: true,
          memories: {
            where: { photos: { some: {} } },
            orderBy: PUBLIC_TRIP_MEMORY_ORDER,
            take: TRIP_MEMORY_PREVIEW_LIMIT + 1,
            select: { photos: { orderBy: { position: 'asc' }, take: 1, select: photoSelect } },
          },
          name: true,
          startDate: true,
          storyCoverPhoto: { select: photoSelect },
        },
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      },
    },
  });
  if (!profile) throw new PublicTravellerNotFoundError();

  // A cover from a Private trip's Memories is that trip's, not the profile's to show.
  const cover =
    profile.coverMemoryPhoto?.memory.trip.visibility === 'PUBLIC' ? profile.coverMemoryPhoto : null;
  const trips = profile.ownedTrips.map((trip) => ({
    trip,
    endDate: formatDateOnly(trip.endDate),
  }));
  const previews = trips.map(({ endDate, trip }) =>
    endDate < today ? selectTripMemoryPreview(trip.storyCoverPhoto, trip.memories) : [],
  );
  const storage =
    profile.avatarPath || cover || previews.some((photos) => photos.length)
      ? createStorage()
      : null;
  const [avatarUrl, coverUrl, signedPreviews] = await Promise.all([
    signPhoto(storage, PROFILE_PHOTOS_BUCKET, profile.avatarPath),
    signPhoto(storage, MEMORY_PHOTOS_BUCKET, cover?.path ?? null),
    signPreviews(storage, previews),
  ]);

  return {
    traveller: {
      avatarUrl,
      bio: profile.bio?.trim() || null,
      coverPhoto: coverUrl && cover ? { contentType: cover.contentType, url: coverUrl } : null,
      homeCountryCode: profile.homeCountryCode,
      id: profile.id,
      name: profile.displayName?.trim() || null,
      travelStyles: profile.travelStyles,
    },
    trips: trips.map(({ endDate, trip }, index) => ({
      countries: trip.countries,
      destinations: trip.destinations.map((destination) => {
        const { location } = serializeCanonicalPlace({
          ...destination.place,
          providerRefs: destination.place.providerRefs ?? [],
        });
        return {
          location: location
            ? { latitude: location.latitude, longitude: location.longitude }
            : null,
          name: destination.place.customName ?? '',
          placeId: destination.placeId,
        };
      }),
      endDate,
      experienceNote: trip.experienceNote?.trim() || null,
      experienceRating: trip.experienceRating,
      id: trip.id,
      memoryPhotos: signedPreviews[index] ?? [],
      name: trip.name,
      startDate: formatDateOnly(trip.startDate),
    })),
  };
}

/** Every trip's preview photographs, signed in one request; any that fail are left out. */
async function signPreviews(
  storage: SupabaseClient | null,
  previews: MemoryPreviewPhotoRecord[][],
): Promise<{ contentType: string; id: string; url: string }[][]> {
  const all = previews.flat();
  if (!storage || !all.length) return previews.map(() => []);
  try {
    const { data, error } = await storage.storage.from(MEMORY_PHOTOS_BUCKET).createSignedUrls(
      all.map((photo) => photo.path),
      PUBLIC_PHOTO_LINK_SECONDS,
    );
    if (error || !data) return previews.map(() => []);
    const urls = new Map(
      all.flatMap((photo, index) => {
        const signed = data[index];
        return signed?.signedUrl && !signed.error ? [[photo.id, signed.signedUrl] as const] : [];
      }),
    );
    return previews.map((photos) =>
      photos.flatMap((photo) => {
        const url = urls.get(photo.id);
        return url ? [{ contentType: photo.contentType, id: photo.id, url }] : [];
      }),
    );
  } catch {
    return previews.map(() => []);
  }
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
