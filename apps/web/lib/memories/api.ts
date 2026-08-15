import { canUseSupportingOfflineFallback } from '@/lib/offline/supporting-sync';
import {
  listOfflineMemoryMedia,
  listUserMutations,
  mergeQueuedMemories,
  type OfflineMemoryMedia,
  type OfflineMutation,
  type OfflineMutationOperation,
  queueOfflineMemoryCapture,
  readTripSnapshot,
  removePendingMemoryCapture,
  removePendingMemoryPhoto,
  saveSupportingSnapshot,
  setOfflineApiReachable,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import {
  isAllowedMemoryPhoto,
  memoryPhotoPath,
  removeMemoryPhotoObject,
  uploadMemoryPhotoObject,
} from './storage';

export { allowedMemoryPhotoTypes, MEMORY_PHOTOS_BUCKET, maxMemoryPhotoSize } from './storage';

/**
 * Photos waiting to upload live in the browser's storage. This ceiling keeps a
 * long offline stretch from filling the device, and is checked before a capture
 * is accepted so the traveller finds out immediately rather than at sync time.
 */
const maxPendingMemoryMediaBytes = 200 * 1024 * 1024;

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

export type MemoriesResponse = { memories: Memory[] };

export type MemoryInput = {
  capturedAt?: string;
  isHighlight?: boolean;
  itineraryDayId?: string | null;
  itineraryItemId?: string | null;
  note?: string | null;
  tripPlaceId?: string | null;
};

/** What still has to reach the server for one locally captured Memory. */
export type PendingMemory = {
  capturedAt: string;
  clientMemoryId: string;
  errorCode: string | null;
  isHighlight: boolean;
  note: string | null;
  photos: Array<{
    clientPhotoId: string;
    fileName: string;
    previewUrl: string | null;
    sizeBytes: number;
  }>;
  state: 'conflict' | 'failed' | 'partial' | 'pending';
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

async function getSupabaseContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new MemoriesApiError('supabase_not_configured', 500);
  return supabase;
}

async function memoryRequest<T>(path: string, init?: RequestInit) {
  const { accessToken } = await getOfflineAuthContext();
  if (!accessToken) throw new MemoriesApiError('memories_unavailable', 503);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    setOfflineApiReachable(false);
    throw new MemoriesApiError('memories_unavailable', 503);
  }

  setOfflineApiReachable(response.status < 500);
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

/** Attaches on-device previews so a queued photo is visible before it uploads. */
async function withLocalPreviews(userId: string, tripId: string, data: MemoriesResponse) {
  const media = await listOfflineMemoryMedia(userId, tripId).catch(() => []);
  if (!media.length) return data;
  const byPhoto = new Map(media.map((entry) => [entry.clientPhotoId, entry]));

  return {
    ...data,
    memories: data.memories.map((memory) => ({
      ...memory,
      photos: memory.photos.map((photo) => {
        const pending = byPhoto.get(photo.id);
        return pending ? { ...photo, url: URL.createObjectURL(pending.blob) } : photo;
      }),
    })),
  };
}

async function readStoredMemories(userId: string, tripId: string) {
  const snapshot = await readTripSnapshot(userId, tripId);
  if (!snapshot?.memories) throw new MemoriesApiError('memories_not_prepared', 503);
  return withLocalPreviews(userId, tripId, snapshot.memories);
}

/**
 * Memories are read on demand rather than pre-downloaded with a trip, so this
 * falls back to whatever is already stored: previously viewed Memories plus
 * anything captured offline and still queued.
 */
export async function fetchMemories(tripId: string) {
  const auth = await getOfflineAuthContext();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return readStoredMemories(auth.userId, tripId);
  }

  try {
    const data = await memoryRequest<MemoriesResponse>(`/trips/${tripId}/memories`);
    const snapshot = await readTripSnapshot(auth.userId, tripId);
    const merged = snapshot ? await mergeQueuedMemories(auth.userId, tripId, data, snapshot) : data;
    if (snapshot) await saveSupportingSnapshot(auth.userId, tripId, 'memories', merged);
    return withLocalPreviews(auth.userId, tripId, merged);
  } catch (error) {
    if (canUseSupportingOfflineFallback(error)) return readStoredMemories(auth.userId, tripId);
    throw error;
  }
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

type PlannedPhoto = {
  clientPhotoId: string;
  contentType: string;
  file: File;
  fileName: string;
  path: string;
  sizeBytes: number;
};

function planPhotos(userId: string, tripId: string, clientMemoryId: string, files: File[]) {
  return files.map((file) => {
    if (!isAllowedMemoryPhoto(file.type, file.size)) {
      throw new MemoriesApiError('invalid_memory_photo', 400);
    }
    const clientPhotoId = crypto.randomUUID();
    return {
      clientPhotoId,
      contentType: file.type,
      file,
      fileName: file.name,
      path: memoryPhotoPath(userId, tripId, clientMemoryId, clientPhotoId, file.name),
      sizeBytes: file.size,
    } satisfies PlannedPhoto;
  });
}

async function assertMediaCapacity(userId: string, incomingBytes: number) {
  if (!incomingBytes) return;
  const pending = await listOfflineMemoryMedia(userId).catch(() => []);
  const used = pending.reduce((total, entry) => total + entry.sizeBytes, 0);
  if (used + incomingBytes > maxPendingMemoryMediaBytes) {
    throw new MemoriesApiError('memory_storage_full', 507);
  }

  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (
    estimate?.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.usage + incomingBytes > estimate.quota * 0.9
  ) {
    throw new MemoriesApiError('memory_storage_full', 507);
  }
}

function mutationFor(
  userId: string,
  tripId: string,
  operation: OfflineMutationOperation,
  createdAt: string,
): OfflineMutation {
  return {
    attempts: 0,
    createdAt,
    errorCode: null,
    id: crypto.randomUUID(),
    operation,
    state: 'pending',
    tripId,
    updatedAt: createdAt,
    userId,
  };
}

async function queueCapture(
  userId: string,
  tripId: string,
  clientMemoryId: string,
  input: MemoryInput,
  photos: PlannedPhoto[],
  includeCreate: boolean,
) {
  await assertMediaCapacity(
    userId,
    photos.reduce((total, photo) => total + photo.sizeBytes, 0),
  );

  // The queue replays in creation order. Spacing these apart keeps a Memory ahead
  // of its own photos, so both can settle in a single pass once back online.
  const queuedAt = Date.now();
  const at = (offset: number) => new Date(queuedAt + offset).toISOString();
  const mutations = [
    ...(includeCreate
      ? [mutationFor(userId, tripId, { clientMemoryId, input, kind: 'memory_create' }, at(0))]
      : []),
    ...photos.map((photo, index) =>
      mutationFor(
        userId,
        tripId,
        {
          clientMemoryId,
          clientPhotoId: photo.clientPhotoId,
          contentType: photo.contentType,
          fileName: photo.fileName,
          kind: 'memory_photo_create',
          path: photo.path,
          sizeBytes: photo.sizeBytes,
        },
        at(index + 1),
      ),
    ),
  ];
  const media = photos.map(
    (photo) =>
      ({
        blob: photo.file,
        clientMemoryId,
        clientPhotoId: photo.clientPhotoId,
        createdAt: new Date().toISOString(),
        sizeBytes: photo.sizeBytes,
        tripId,
        userId,
      }) satisfies Omit<OfflineMemoryMedia, 'key'>,
  );

  await queueOfflineMemoryCapture(mutations, media);
}

/** Keeps an already-stored offline copy current without pulling a trip's history. */
async function rememberCapturedMemory(userId: string, tripId: string, memory: Memory) {
  const snapshot = await readTripSnapshot(userId, tripId).catch(() => null);
  if (!snapshot?.memories) return;
  await saveSupportingSnapshot(userId, tripId, 'memories', {
    ...snapshot.memories,
    memories: [
      ...snapshot.memories.memories.filter((candidate) => candidate.id !== memory.id),
      memory,
    ],
  });
}

async function uploadPlannedPhoto(tripId: string, memoryId: string, photo: PlannedPhoto) {
  const supabase = await getSupabaseContext();
  const uploaded = await uploadMemoryPhotoObject(
    supabase,
    photo.path,
    photo.file,
    photo.contentType,
  );
  if (!uploaded) throw new MemoriesApiError('memory_photo_upload_failed', 503);

  try {
    return await memoryRequest<MemoryPhoto>(`/trips/${tripId}/memories/${memoryId}/photos`, {
      body: JSON.stringify({
        contentType: photo.contentType,
        fileName: photo.fileName,
        path: photo.path,
        sizeBytes: photo.sizeBytes,
      }),
      method: 'POST',
    });
  } catch (error) {
    // Only a rejection leaves an orphan; a lost connection keeps the object for the retry.
    if (!canUseSupportingOfflineFallback(error)) {
      await removeMemoryPhotoObject(supabase, photo.path).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Captures a Memory with its photos. The capture instant is recorded here so a
 * Memory queued offline keeps when it happened rather than when it synced; the
 * trip-local date, time, and timezone stay the server's to resolve from context.
 *
 * Anything that cannot reach the server right now is queued, including the case
 * where the Memory itself saved but a photo did not.
 */
export async function captureMemory(tripId: string, input: MemoryInput, files: File[]) {
  const auth = await getOfflineAuthContext();
  const clientMemoryId = crypto.randomUUID();
  const photos = planPhotos(auth.userId, tripId, clientMemoryId, files);
  const capture = { ...input, capturedAt: input.capturedAt ?? new Date().toISOString() };
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (offline || !auth.accessToken) {
    await queueCapture(auth.userId, tripId, clientMemoryId, capture, photos, true);
    return { queued: true };
  }

  let created: Memory;
  try {
    created = await memoryRequest<Memory>(`/trips/${tripId}/memories`, {
      body: JSON.stringify({ ...capture, clientMemoryId }),
      method: 'POST',
    });
  } catch (error) {
    if (!canUseSupportingOfflineFallback(error)) throw error;
    await queueCapture(auth.userId, tripId, clientMemoryId, capture, photos, true);
    return { queued: true };
  }

  const uploaded: MemoryPhoto[] = [];
  for (const [index, photo] of photos.entries()) {
    try {
      uploaded.push(await uploadPlannedPhoto(tripId, clientMemoryId, photo));
    } catch (error) {
      if (!canUseSupportingOfflineFallback(error)) throw error;
      await rememberCapturedMemory(auth.userId, tripId, { ...created, photos: uploaded });
      await queueCapture(auth.userId, tripId, clientMemoryId, capture, photos.slice(index), false);
      return { queued: true };
    }
  }

  await rememberCapturedMemory(auth.userId, tripId, { ...created, photos: uploaded });
  return { queued: false };
}

/**
 * Groups queued work back into the Memories it belongs to. A Memory whose
 * metadata already synced but still owes photos reports as `partial`.
 */
export async function listPendingMemories(tripId: string): Promise<PendingMemory[]> {
  const auth = await getOfflineAuthContext();
  const [mutations, media, snapshot] = await Promise.all([
    listUserMutations(auth.userId, tripId),
    listOfflineMemoryMedia(auth.userId, tripId).catch(() => []),
    readTripSnapshot(auth.userId, tripId),
  ]);
  const blobs = new Map(media.map((entry) => [entry.clientPhotoId, entry]));
  const stored = new Map((snapshot?.memories?.memories ?? []).map((memory) => [memory.id, memory]));
  const grouped = new Map<string, { hasCreate: boolean; mutations: OfflineMutation[] }>();

  for (const mutation of mutations) {
    const operation = mutation.operation;
    if (operation.kind !== 'memory_create' && operation.kind !== 'memory_photo_create') continue;
    const group = grouped.get(operation.clientMemoryId) ?? { hasCreate: false, mutations: [] };
    group.hasCreate ||= operation.kind === 'memory_create';
    group.mutations.push(mutation);
    grouped.set(operation.clientMemoryId, group);
  }

  const entries = [...grouped.entries()].map(([clientMemoryId, group]) => {
    const memory = stored.get(clientMemoryId);
    const create = group.mutations.find((mutation) => mutation.operation.kind === 'memory_create');
    const createInput =
      create?.operation.kind === 'memory_create' ? create.operation.input : undefined;
    const blocked = group.mutations.find((mutation) => mutation.state !== 'pending');

    return {
      capturedAt:
        createInput?.capturedAt ?? memory?.capturedAt ?? group.mutations[0]?.createdAt ?? '',
      clientMemoryId,
      errorCode: blocked?.errorCode ?? null,
      isHighlight: createInput?.isHighlight ?? memory?.isHighlight ?? false,
      note: createInput?.note?.trim() || memory?.note || null,
      photos: group.mutations.flatMap((mutation) =>
        mutation.operation.kind === 'memory_photo_create'
          ? [
              {
                clientPhotoId: mutation.operation.clientPhotoId,
                fileName: mutation.operation.fileName,
                previewUrl: (() => {
                  const blob = blobs.get(mutation.operation.clientPhotoId);
                  return blob ? URL.createObjectURL(blob.blob) : null;
                })(),
                sizeBytes: mutation.operation.sizeBytes,
              },
            ]
          : [],
      ),
      // Metadata that already reached the server leaves only its photos outstanding.
      state: blocked?.state ?? (group.hasCreate ? 'pending' : 'partial'),
    } satisfies PendingMemory;
  });

  return entries.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

/** Removes a Memory that has not finished syncing, so nothing of it uploads later. */
export async function discardPendingMemory(tripId: string, clientMemoryId: string) {
  const auth = await getOfflineAuthContext();
  await removePendingMemoryCapture(auth.userId, tripId, clientMemoryId);
}

export async function discardPendingMemoryPhoto(tripId: string, clientPhotoId: string) {
  const auth = await getOfflineAuthContext();
  await removePendingMemoryPhoto(auth.userId, tripId, clientPhotoId);
}
