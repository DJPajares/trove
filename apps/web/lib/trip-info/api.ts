import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type TripInfoEntry = {
  category: string | null;
  createdAt: string;
  id: string;
  isPinned: boolean;
  label: string;
  link: string | null;
  note: string | null;
  updatedAt: string;
  value: string;
};

export type TripInfoInput = {
  category?: string | null;
  isPinned?: boolean;
  label?: string;
  link?: string | null;
  note?: string | null;
  value?: string;
};

export type TripInfoResponse = {
  entries: TripInfoEntry[];
  trip: { id: string; name: string };
};

export class TripInfoApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new TripInfoApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new TripInfoApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function tripInfoRequest<T>(path: string, init?: RequestInit) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new TripInfoApiError(
      body.code ?? `trip_info_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchTripInfo(tripId: string) {
  return tripInfoRequest<TripInfoResponse>(`/trips/${tripId}/info`);
}

export function createTripInfo(
  tripId: string,
  input: Required<Pick<TripInfoInput, 'label' | 'value'>> & TripInfoInput,
) {
  return tripInfoRequest<{ entry: TripInfoEntry }>(`/trips/${tripId}/info`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateTripInfo(tripId: string, entryId: string, input: TripInfoInput) {
  return tripInfoRequest<{ entry: TripInfoEntry }>(`/trips/${tripId}/info/${entryId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteTripInfo(tripId: string, entryId: string) {
  return tripInfoRequest<void>(`/trips/${tripId}/info/${entryId}`, { method: 'DELETE' });
}
