import { createBrowserSupabaseClient, getBrowserSession } from '@/lib/supabase/client';
import {
  getRememberedOfflineUser,
  readTripSnapshot,
  rememberOfflineUser,
  saveTripSnapshot,
  setOfflineApiReachable,
} from '@/lib/offline/trip-store';
import { forgetCachedMediaPath } from '@/lib/media/storage-cache-key';

export type TripDestination = {
  id: string;
  name: string;
  placeId: string;
  position: number;
  timeZone: string | null;
};

export type Trip = {
  coverPhotoPath: string | null;
  coverPhotoUrl: string | null;
  createdAt: string;
  /** Optional so snapshots written while this was `notes` remain readable offline. */
  description?: string | null;
  destinations: TripDestination[];
  endDate: string;
  experienceNote: string | null;
  experienceRating: number | null;
  id: string;
  /** Optional so snapshots written before WDL-190 remain readable offline. */
  itineraryCoverage?: { percentage: number; plannedDays: number; totalDays: number };
  lifecycle: 'active' | 'completed' | 'planning';
  memoryCount: number;
  name: string;
  partySize: number;
  planningReadiness: 'in_progress' | 'ready';
  referenceTimeZone: string;
  referenceTimeZoneSource:
    'destination' | 'device_fallback' | 'explicit' | 'profile_home' | 'starting_location';
  startDate: string;
  startingLocation: { isOverride: boolean; name: string; placeId: string } | null;
  startingLocationOverride: string | null;
  updatedAt: string;
  /**
   * `public` means anyone with `/shared/<id>` can read the itinerary. Optional so
   * snapshots written before sharing existed remain readable offline.
   */
  visibility?: 'private' | 'public';
  /** Optional so older offline snapshots omit weather instead of failing. */
  weatherLocation?: { latitude: number; longitude: number; timeZone: string } | null;
};

export type TripInput = {
  confirmDateShrink?: boolean;
  coverPhotoPath?: string | null;
  description: string | null;
  destinations: Array<{ name: string }>;
  deviceTimeZone: string;
  endDate: string;
  name: string;
  partySize: number;
  planningReadiness: 'in_progress' | 'ready';
  referenceTimeZone: string | null;
  startDate: string;
  startingLocation: string | null;
};

export class TripApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly affectedItemCount?: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new TripApiError('supabase_not_configured', 500);

  const session = await getBrowserSession();
  if (session) {
    rememberOfflineUser(session.user.id);
    return {
      accessToken: session.access_token,
      supabase,
      userId: session.user.id,
    };
  }

  const rememberedUser =
    typeof navigator !== 'undefined' && !navigator.onLine ? getRememberedOfflineUser() : null;
  if (rememberedUser) return { accessToken: null, supabase, userId: rememberedUser };
  throw new TripApiError('not_authenticated', 401);
}

async function tripRequest<T>(path: string, init?: RequestInit) {
  const { accessToken } = await getAuthContext();
  if (!accessToken) throw new TripApiError('offline_session', 503);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch (error) {
    setOfflineApiReachable(false);
    throw error;
  }
  setOfflineApiReachable(response.status < 500);

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      affectedItemCount?: number;
      code?: string;
    };
    throw new TripApiError(
      body.code ?? `trip_request_failed_${response.status}`,
      response.status,
      body.affectedItemCount,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchTrips() {
  return tripRequest<{ trips: Trip[] }>('/trips');
}

export async function fetchTrip(tripId: string) {
  const { userId } = await getAuthContext();
  const snapshot = await readTripSnapshot(userId, tripId).catch(() => undefined);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (snapshot?.trip) return { trip: snapshot.trip };
    throw new TripApiError('offline_trip_not_prepared', 503);
  }
  try {
    const result = await tripRequest<{ trip: Trip }>(`/trips/${tripId}`);
    await saveTripSnapshot(userId, result.trip);
    return result;
  } catch (error) {
    if (
      snapshot?.trip &&
      (error instanceof TypeError || (error instanceof TripApiError && error.status >= 500))
    ) {
      return { trip: snapshot.trip };
    }
    throw error;
  }
}

export async function createTrip(input: TripInput) {
  return tripRequest<{ trip: Trip }>('/trips', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export async function saveTrip(tripId: string, input: TripInput) {
  return tripRequest<{ trip: Trip }>(`/trips/${tripId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export async function deleteTrip(tripId: string) {
  return tripRequest<void>(`/trips/${tripId}`, { method: 'DELETE' });
}

/**
 * Experience Rating is the traveller's own private reflection on the trip,
 * entered independently of Plan Score and never averaged from day ratings.
 */
export async function updateTripExperienceRating(
  tripId: string,
  rating: number | null,
  note: string | null,
) {
  return tripRequest<{ trip: Trip }>(`/trips/${tripId}/experience-rating`, {
    body: JSON.stringify({ note, rating }),
    method: 'PATCH',
  });
}

/**
 * Turns the shared link on or off. Its own endpoint rather than a field on
 * `saveTrip`, because publishing a trip is the one change that alters who can
 * see it and should not be able to ride along with an unrelated edit.
 */
export async function updateTripVisibility(tripId: string, visibility: 'private' | 'public') {
  return tripRequest<{ trip: Trip }>(`/trips/${tripId}/visibility`, {
    body: JSON.stringify({ visibility }),
    method: 'PATCH',
  });
}

export async function uploadTripCover(file: File) {
  const { supabase, userId } = await getAuthContext();
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  if (!allowedTypes.has(file.type) || file.size > 8 * 1024 * 1024) {
    throw new TripApiError('invalid_trip_cover', 400);
  }

  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.slice('image/'.length);
  const path = `${userId}/cover-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('trip-covers').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new TripApiError('trip_cover_upload_failed', 500);
  return { path };
}

export async function removeTripCover(path: string) {
  const { supabase } = await getAuthContext();
  await supabase.storage.from('trip-covers').remove([path]);
  // A removed cover must not survive in the device's image cache.
  await forgetCachedMediaPath('trip-covers', path);
}
