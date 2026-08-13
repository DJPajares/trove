import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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
  destinations: TripDestination[];
  endDate: string;
  id: string;
  lifecycle: 'active' | 'completed' | 'planning';
  name: string;
  notes: string | null;
  partySize: number;
  planningReadiness: 'in_progress' | 'ready';
  referenceTimeZone: string;
  referenceTimeZoneSource:
    'destination' | 'device_fallback' | 'explicit' | 'profile_home' | 'starting_location';
  startDate: string;
  startingLocation: { isOverride: boolean; name: string; placeId: string } | null;
  startingLocationOverride: string | null;
  updatedAt: string;
};

export type TripInput = {
  confirmDateShrink?: boolean;
  coverPhotoPath?: string | null;
  destinations: Array<{ name: string }>;
  deviceTimeZone: string;
  endDate: string;
  name: string;
  notes: string | null;
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

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new TripApiError('not_authenticated', 401);

  return { accessToken: data.session.access_token, supabase, userId: data.session.user.id };
}

async function tripRequest<T>(path: string, init?: RequestInit) {
  const { accessToken } = await getAuthContext();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

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
  return tripRequest<{ trip: Trip }>(`/trips/${tripId}`);
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
}
