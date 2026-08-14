import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export const MEMORY_PHOTOS_BUCKET = 'memory-photos';

export const allowedMemoryPhotoTypes = new Set([
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const maxMemoryPhotoSize = 15 * 1024 * 1024;

export type MemoryPhoto = {
  contentType: string;
  createdAt: string;
  fileName: string;
  id: string;
  position: number;
  sizeBytes: number;
  url: string | null;
};

export type Memory = {
  capturedAt: string;
  capturedLocalDate: string;
  capturedLocalTime: string | null;
  createdAt: string;
  id: string;
  isHighlight: boolean;
  itineraryDay: { date: string; id: string } | null;
  itineraryItem: { id: string; label: string | null } | null;
  note: string | null;
  photos: MemoryPhoto[];
  timeZone: string;
  timeZoneSource: string;
  tripPlace: { id: string; name: string | null } | null;
  updatedAt: string;
};

export type MemoryInput = {
  capturedAt?: string;
  isHighlight?: boolean;
  itineraryDayId?: string | null;
  itineraryItemId?: string | null;
  note?: string | null;
  tripPlaceId?: string | null;
};

export class MemoriesApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new MemoriesApiError('supabase_not_configured', 500);

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new MemoriesApiError('not_authenticated', 401);

  return {
    accessToken: data.session.access_token,
    supabase,
    userId: data.session.user.id,
  };
}

async function memoryRequest<T>(path: string, init?: RequestInit) {
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
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new MemoriesApiError(
      body.code ?? `memory_request_failed_${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchMemories(tripId: string) {
  return memoryRequest<{ memories: Memory[] }>(`/trips/${tripId}/memories`);
}

export function createMemory(tripId: string, input: MemoryInput) {
  return memoryRequest<Memory>(`/trips/${tripId}/memories`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateMemory(tripId: string, memoryId: string, input: MemoryInput) {
  return memoryRequest<{ localDateChanged: boolean; memory: Memory }>(
    `/trips/${tripId}/memories/${memoryId}`,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteMemory(tripId: string, memoryId: string) {
  return memoryRequest<void>(`/trips/${tripId}/memories/${memoryId}`, { method: 'DELETE' });
}

/**
 * Uploads a traveller's own photo to the private Memories bucket, then registers
 * it. A failed registration removes the object again so no orphan media is left.
 */
export async function uploadMemoryPhoto(tripId: string, memoryId: string, file: File) {
  if (!allowedMemoryPhotoTypes.has(file.type) || file.size > maxMemoryPhotoSize) {
    throw new MemoriesApiError('invalid_memory_photo', 400);
  }

  const { supabase, userId } = await getAuthContext();
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/${tripId}/${memoryId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(MEMORY_PHOTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new MemoriesApiError('memory_photo_upload_failed', 500);

  try {
    return await memoryRequest<MemoryPhoto>(`/trips/${tripId}/memories/${memoryId}/photos`, {
      body: JSON.stringify({
        contentType: file.type,
        fileName: file.name,
        path,
        sizeBytes: file.size,
      }),
      method: 'POST',
    });
  } catch (requestError) {
    await supabase.storage.from(MEMORY_PHOTOS_BUCKET).remove([path]);
    throw requestError;
  }
}
