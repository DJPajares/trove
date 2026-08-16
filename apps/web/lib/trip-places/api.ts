import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { CanonicalPlace } from '@/lib/saved/api';

export type TripPlacePriority = 'interested' | 'maybe' | 'must_go';

export type TripPlace = {
  createdAt: string;
  id: string;
  isSaved: boolean;
  note: string | null;
  place: CanonicalPlace;
  priority: TripPlacePriority | null;
  referenceCount: number;
};

export class TripPlaceApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly referenceCount?: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new TripPlaceApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new TripPlaceApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function tripPlaceRequest<T>(path: string, init?: RequestInit) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // A JSON content type with no body makes Fastify reject the request, so this
      // is declared only when the request actually carries one.
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      referenceCount?: number;
    };
    throw new TripPlaceApiError(
      body.code ?? `trip_place_request_failed_${response.status}`,
      response.status,
      body.referenceCount,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchTripPlaces(tripId: string) {
  return tripPlaceRequest<{ trip: { id: string; name: string }; tripPlaces: TripPlace[] }>(
    `/trips/${tripId}/places`,
  );
}

export function addTripPlace(tripId: string, placeId: string) {
  return tripPlaceRequest<{ tripPlace: TripPlace }>(`/trips/${tripId}/places`, {
    body: JSON.stringify({ placeId }),
    method: 'POST',
  });
}

export function updateTripPlace(
  tripId: string,
  tripPlaceId: string,
  input: { note?: string | null; priority?: TripPlacePriority | null },
) {
  return tripPlaceRequest<{ tripPlace: TripPlace }>(`/trips/${tripId}/places/${tripPlaceId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function removeTripPlace(tripId: string, tripPlaceId: string) {
  return tripPlaceRequest<void>(`/trips/${tripId}/places/${tripPlaceId}`, { method: 'DELETE' });
}
