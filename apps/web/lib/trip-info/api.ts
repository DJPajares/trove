import {
  canUseSupportingOfflineFallback,
  queueSupportingMutation,
  readPreparedSupportingData,
} from '@/lib/offline/supporting-sync';
import {
  saveSupportingSnapshot,
  setOfflineApiReachable,
  type OfflineMutationOperation,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

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

async function getAuthContext() {
  try {
    return await getOfflineAuthContext();
  } catch {
    throw new TripInfoApiError('not_authenticated', 401);
  }
}

async function tripInfoRequest<T>(
  path: string,
  init: RequestInit | undefined,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
) {
  if (!auth.accessToken) throw new TripInfoApiError('offline_session', 503);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        // A JSON content type with no body makes Fastify reject the request, so this
        // is declared only when the request actually carries one.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    setOfflineApiReachable(false);
    throw new TripInfoApiError('trip_info_unavailable', 503);
  }
  setOfflineApiReachable(response.status < 500);
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

export async function fetchTripInfo(tripId: string) {
  const auth = await getAuthContext();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return readPreparedSupportingData(auth.userId, tripId, 'tripInfo');
  }
  try {
    const data = await tripInfoRequest<TripInfoResponse>(`/trips/${tripId}/info`, undefined, auth);
    await saveSupportingSnapshot(auth.userId, tripId, 'tripInfo', data);
    return data;
  } catch (error) {
    if (canUseSupportingOfflineFallback(error)) {
      return readPreparedSupportingData(auth.userId, tripId, 'tripInfo');
    }
    throw error;
  }
}

export async function createTripInfo(
  tripId: string,
  input: Required<Pick<TripInfoInput, 'label' | 'value'>> & TripInfoInput,
) {
  const auth = await getAuthContext();
  const operation: OfflineMutationOperation = {
    clientEntryId: crypto.randomUUID(),
    input,
    kind: 'trip_info_create',
  };
  try {
    const result = await tripInfoRequest<{ entry: TripInfoEntry }>(
      `/trips/${tripId}/info`,
      {
        body: JSON.stringify({ ...input, clientEntryId: operation.clientEntryId }),
        method: 'POST',
      },
      auth,
    );
    const current = await readPreparedSupportingData(auth.userId, tripId, 'tripInfo').catch(
      () => null,
    );
    if (current) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tripInfo', {
        ...current,
        entries: [result.entry, ...current.entries.filter((entry) => entry.id !== result.entry.id)],
      });
    }
    return result;
  } catch (error) {
    if (!canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, operation);
    const data = await readPreparedSupportingData(auth.userId, tripId, 'tripInfo');
    const entry = data.entries.find((candidate) => candidate.id === operation.clientEntryId);
    if (!entry) throw error;
    return { entry };
  }
}

export async function updateTripInfo(tripId: string, entryId: string, input: TripInfoInput) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'tripInfo').catch(
    () => null,
  );
  const baseEntry = stored?.entries.find((entry) => entry.id === entryId) ?? null;
  try {
    const result = await tripInfoRequest<{ entry: TripInfoEntry }>(
      `/trips/${tripId}/info/${entryId}`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    );
    if (stored) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tripInfo', {
        ...stored,
        entries: stored.entries.map((entry) => (entry.id === entryId ? result.entry : entry)),
      });
    }
    return result;
  } catch (error) {
    if (!baseEntry || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseEntry: structuredClone(baseEntry),
      entryId,
      input,
      kind: 'trip_info_update',
    });
    const data = await readPreparedSupportingData(auth.userId, tripId, 'tripInfo');
    const entry = data.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw error;
    return { entry };
  }
}

export async function deleteTripInfo(tripId: string, entryId: string) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'tripInfo').catch(
    () => null,
  );
  const baseEntry = stored?.entries.find((entry) => entry.id === entryId) ?? null;
  try {
    const result = await tripInfoRequest<void>(
      `/trips/${tripId}/info/${entryId}`,
      { method: 'DELETE' },
      auth,
    );
    if (stored) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tripInfo', {
        ...stored,
        entries: stored.entries.filter((entry) => entry.id !== entryId),
      });
    }
    return result;
  } catch (error) {
    if (!baseEntry || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseEntry: structuredClone(baseEntry),
      entryId,
      kind: 'trip_info_delete',
    });
  }
}
