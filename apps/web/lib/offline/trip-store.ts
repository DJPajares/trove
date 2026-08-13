import type {
  Itinerary,
  ItineraryItem,
  ItineraryItemInput,
  ItineraryScheduleInput,
  ItineraryTravelStatus,
} from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';

const DATABASE_NAME = 'trove-offline';
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = 'trip-snapshots';
const MUTATION_STORE = 'mutations';
const LAST_OFFLINE_USER_KEY = 'trove.last-offline-user';

export const OFFLINE_SYNC_EVENT = 'trove:offline-sync-change';
export const OFFLINE_CONNECTIVITY_EVENT = 'trove:offline-connectivity-change';
export const OFFLINE_DATA_REFRESH_EVENT = 'trove:offline-data-refresh';

let apiReachable = true;

export function isOfflineApiReachable() {
  return apiReachable;
}

export function setOfflineApiReachable(reachable: boolean) {
  if (apiReachable === reachable) return;
  apiReachable = reachable;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OFFLINE_CONNECTIVITY_EVENT));
  }
}

export function rememberOfflineUser(userId: string) {
  try {
    window.localStorage.setItem(LAST_OFFLINE_USER_KEY, userId);
  } catch {
    // IndexedDB remains scoped by the active session when local storage is unavailable.
  }
}

export function getRememberedOfflineUser() {
  try {
    return window.localStorage.getItem(LAST_OFFLINE_USER_KEY);
  } catch {
    return null;
  }
}

export type OfflineMutationState = 'conflict' | 'failed' | 'pending';

export type OfflineMutationOperation =
  | {
      clientItemId: string;
      input: ItineraryItemInput & { itineraryDayId: string };
      kind: 'itinerary_item_create';
    }
  | {
      baseItem: ItineraryItem;
      itemId: string;
      kind: 'itinerary_item_delete';
    }
  | {
      baseItem: ItineraryItem;
      input: { itineraryDayId: string | null; position: number };
      itemId: string;
      kind: 'itinerary_item_organize';
    }
  | {
      baseItem: ItineraryItem;
      input: ItineraryItemInput;
      itemId: string;
      kind: 'itinerary_item_update';
    }
  | {
      baseItem: ItineraryItem;
      itemId: string;
      kind: 'itinerary_travel_status';
      travelStatus: ItineraryTravelStatus;
    };

export type OfflineMutation = {
  attempts: number;
  createdAt: string;
  errorCode: string | null;
  id: string;
  operation: OfflineMutationOperation;
  state: OfflineMutationState;
  tripId: string;
  updatedAt: string;
  userId: string;
};

export type OfflineTripSnapshot = {
  itinerary: Itinerary | null;
  key: string;
  savedAt: string;
  trip: Trip | null;
  tripId: string;
  userId: string;
};

export type TripSyncSummary = {
  conflict: number;
  failed: number;
  pending: number;
};

function snapshotKey(userId: string, tripId: string) {
  return `${userId}:${tripId}`;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('offline_storage_unavailable'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
          store.createIndex('by-user', 'userId');
        }
        if (!database.objectStoreNames.contains(MUTATION_STORE)) {
          const store = database.createObjectStore(MUTATION_STORE, { keyPath: 'id' });
          store.createIndex('by-user', 'userId');
          store.createIndex('by-user-trip', ['userId', 'tripId']);
        }
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => {
        databasePromise = null;
        reject(request.error);
      },
      { once: true },
    );
  });

  return databasePromise;
}

function announceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}

export async function readTripSnapshot(userId: string, tripId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readonly');
  return requestResult<OfflineTripSnapshot | undefined>(
    transaction.objectStore(SNAPSHOT_STORE).get(snapshotKey(userId, tripId)),
  );
}

async function writeSnapshot(snapshot: OfflineTripSnapshot) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
  await transactionDone(transaction);
  announceChange();
}

async function updateSnapshot(
  userId: string,
  tripId: string,
  update: (current: OfflineTripSnapshot | undefined) => OfflineTripSnapshot,
) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
  const store = transaction.objectStore(SNAPSHOT_STORE);
  const current = await requestResult<OfflineTripSnapshot | undefined>(
    store.get(snapshotKey(userId, tripId)),
  );
  store.put(update(current));
  await transactionDone(transaction);
  announceChange();
}

export async function saveItinerarySnapshot(userId: string, tripId: string, itinerary: Itinerary) {
  await updateSnapshot(userId, tripId, (current) => ({
    itinerary,
    key: snapshotKey(userId, tripId),
    savedAt: new Date().toISOString(),
    trip: current?.trip ?? null,
    tripId,
    userId,
  }));
}

export async function mergeQueuedMutations(userId: string, tripId: string, itinerary: Itinerary) {
  const mutations = await listUserMutations(userId, tripId);
  return mutations.reduce(
    (current, mutation) => applyOfflineMutation(current, mutation.operation),
    itinerary,
  );
}

export async function saveTripSnapshot(userId: string, trip: Trip) {
  await updateSnapshot(userId, trip.id, (current) => ({
    itinerary: current?.itinerary ?? null,
    key: snapshotKey(userId, trip.id),
    savedAt: new Date().toISOString(),
    trip: { ...trip, coverPhotoUrl: null },
    tripId: trip.id,
    userId,
  }));
}

export async function listUserMutations(userId: string, tripId?: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readonly');
  const store = transaction.objectStore(MUTATION_STORE);
  const request = tripId
    ? store.index('by-user-trip').getAll(IDBKeyRange.only([userId, tripId]))
    : store.index('by-user').getAll(IDBKeyRange.only(userId));
  const mutations = await requestResult<OfflineMutation[]>(request);
  return mutations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putOfflineMutation(mutation: OfflineMutation) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readwrite');
  transaction.objectStore(MUTATION_STORE).put(mutation);
  await transactionDone(transaction);
  announceChange();
}

export async function queueOfflineMutation(mutation: OfflineMutation) {
  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOT_STORE, MUTATION_STORE], 'readwrite');
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const snapshot = await requestResult<OfflineTripSnapshot | undefined>(
    snapshotStore.get(snapshotKey(mutation.userId, mutation.tripId)),
  );
  if (!snapshot?.itinerary) {
    transaction.abort();
    throw new Error('offline_trip_not_prepared');
  }
  snapshotStore.put({
    ...snapshot,
    itinerary: applyOfflineMutation(snapshot.itinerary, mutation.operation),
    savedAt: new Date().toISOString(),
  });
  mutationStore.put(mutation);
  await transactionDone(transaction);
  announceChange();
}

export async function removeOfflineMutation(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readwrite');
  transaction.objectStore(MUTATION_STORE).delete(id);
  await transactionDone(transaction);
  announceChange();
}

export async function getTripSyncSummary(userId: string, tripId: string) {
  const mutations = await listUserMutations(userId, tripId);
  return mutations.reduce<TripSyncSummary>(
    (summary, mutation) => ({ ...summary, [mutation.state]: summary[mutation.state] + 1 }),
    { conflict: 0, failed: 0, pending: 0 },
  );
}

export async function hasUnsyncedOfflineChanges(userId?: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readonly');
  const store = transaction.objectStore(MUTATION_STORE);
  const request = userId ? store.index('by-user').count(IDBKeyRange.only(userId)) : store.count();
  return (await requestResult(request)) > 0;
}

export async function clearAllOfflineTripData() {
  try {
    const database = await openDatabase();
    const transaction = database.transaction([SNAPSHOT_STORE, MUTATION_STORE], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).clear();
    transaction.objectStore(MUTATION_STORE).clear();
    await transactionDone(transaction);
  } catch {
    // Continue clearing the user marker and private route caches.
  }
  try {
    window.localStorage.removeItem(LAST_OFFLINE_USER_KEY);
  } catch {
    // The IndexedDB copy has still been removed.
  }
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.includes('trove-pwa-trip-mode'))
        .map((cacheName) => caches.delete(cacheName)),
    );
  }
  announceChange();
}

function findItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    const item = day.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return itinerary.unscheduledItems.find((candidate) => candidate.id === itemId) ?? null;
}

function removeItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    day.items = day.items.filter((item) => item.id !== itemId);
  }
  itinerary.unscheduledItems = itinerary.unscheduledItems.filter((item) => item.id !== itemId);
}

function normalizePositions(items: ItineraryItem[]) {
  items.forEach((item, position) => {
    item.position = position;
  });
}

function applySchedule(item: ItineraryItem, schedule: ItineraryScheduleInput) {
  if (schedule.kind === 'exact') {
    item.dayPart = null;
    item.localStartTime = schedule.localTime;
    item.startInstant = null;
    item.timeSemantics = 'floating_local';
    return;
  }
  item.dayPart = schedule.kind === 'day_part' ? schedule.dayPart : null;
  item.localStartTime = null;
  item.startInstant = null;
  item.timeSemantics = null;
}

function applyInput(item: ItineraryItem, input: ItineraryItemInput, itinerary?: Itinerary) {
  if (input.customLabel !== undefined) item.customLabel = input.customLabel?.trim() || null;
  if (input.customLocation !== undefined) {
    item.customLocation = input.customLocation
      ? { label: input.customLocation.label, timeZone: input.customLocation.timeZone ?? null }
      : null;
  }
  if (input.durationMinutes !== undefined) item.durationMinutes = input.durationMinutes;
  if (input.notes !== undefined) item.notes = input.notes?.trim() || null;
  if (input.plannedCost !== undefined) item.plannedCost = input.plannedCost;
  if (input.priority !== undefined) item.priority = input.priority;
  if (input.tripPlaceId !== undefined) {
    item.tripPlace = input.tripPlaceId
      ? (itinerary?.tripPlaces.find((candidate) => candidate.id === input.tripPlaceId) ?? null)
      : null;
  }
  if (input.schedule) applySchedule(item, input.schedule);
  item.updatedAt = new Date().toISOString();
}

export function applyOfflineMutation(itinerary: Itinerary, mutation: OfflineMutationOperation) {
  const next = structuredClone(itinerary);

  if (mutation.kind === 'itinerary_item_create') {
    if (findItem(next, mutation.clientItemId)) return next;
    const day = next.days.find((candidate) => candidate.id === mutation.input.itineraryDayId);
    if (!day) return next;
    const now = new Date().toISOString();
    const tripPlace = mutation.input.tripPlaceId
      ? (next.tripPlaces.find((candidate) => candidate.id === mutation.input.tripPlaceId) ?? null)
      : null;
    const item: ItineraryItem = {
      createdAt: now,
      customLabel: mutation.input.customLabel?.trim() || null,
      customLocation: mutation.input.customLocation
        ? {
            label: mutation.input.customLocation.label,
            timeZone: mutation.input.customLocation.timeZone ?? null,
          }
        : null,
      dayPart: null,
      durationMinutes: mutation.input.durationMinutes ?? null,
      id: mutation.clientItemId,
      itineraryDayId: day.id,
      localStartTime: null,
      notes: mutation.input.notes?.trim() || null,
      plannedCost: mutation.input.plannedCost ?? null,
      position: day.items.length,
      priority: mutation.input.priority ?? null,
      startInstant: null,
      timeSemantics: null,
      timeZone: tripPlace?.place.timeZone ?? day.defaultTimeZone,
      timeZoneSource: tripPlace ? 'place' : 'day_default',
      travelModeToNext: 'drive',
      travelStatus: 'upcoming',
      tripPlace,
      updatedAt: now,
    };
    applyInput(item, mutation.input, next);
    day.items.push(item);
    return next;
  }

  const item = findItem(next, mutation.itemId);
  if (!item) return next;

  if (mutation.kind === 'itinerary_item_delete') {
    removeItem(next, mutation.itemId);
    return next;
  }

  if (mutation.kind === 'itinerary_travel_status') {
    item.travelStatus = mutation.travelStatus;
    item.updatedAt = new Date().toISOString();
    return next;
  }

  if (mutation.kind === 'itinerary_item_update') {
    applyInput(item, mutation.input, next);
    return next;
  }

  removeItem(next, mutation.itemId);
  item.itineraryDayId = mutation.input.itineraryDayId;
  const targetItems = mutation.input.itineraryDayId
    ? next.days.find((day) => day.id === mutation.input.itineraryDayId)?.items
    : next.unscheduledItems;
  if (!targetItems) return next;
  targetItems.splice(Math.min(Math.max(mutation.input.position, 0), targetItems.length), 0, item);
  for (const day of next.days) normalizePositions(day.items);
  normalizePositions(next.unscheduledItems);
  item.updatedAt = new Date().toISOString();
  return next;
}

export async function applyMutationToStoredItinerary(
  userId: string,
  tripId: string,
  operation: OfflineMutationOperation,
) {
  const snapshot = await readTripSnapshot(userId, tripId);
  if (!snapshot?.itinerary) throw new Error('offline_trip_not_prepared');
  await writeSnapshot({
    ...snapshot,
    itinerary: applyOfflineMutation(snapshot.itinerary, operation),
    savedAt: new Date().toISOString(),
  });
}
