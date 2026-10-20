import { afterEach, expect, test, vi } from 'vitest';
import { FakeIndexedDbFactory } from './fake-indexed-db.ts';
import type { Trip } from '../lib/trips/api.ts';
import type { Itinerary } from '../lib/itinerary/api.ts';
import {
  clearAllOfflineTripData,
  saveTripSnapshot,
  saveItinerarySnapshot,
  readTripSnapshot,
  queueOfflineMutation,
  listUserMutations,
  pruneOrphanedTripSnapshots,
  type OfflineMutation,
} from '../lib/offline/trip-store.ts';

afterEach(() => vi.unstubAllGlobals());
test('archives preserve prepared content and pending work while rejecting new offline edits', async () => {
  vi.stubGlobal('indexedDB', new FakeIndexedDbFactory() as unknown as IDBFactory);
  vi.stubGlobal('IDBKeyRange', { only: (value: unknown) => ({ value }) });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { localStorage: { removeItem: vi.fn() } }),
  );
  const trip = { id: 'kept', name: 'Our trip', archivedAt: null } as Trip;
  const itinerary = {
    days: [{ id: 'day', notes: null, items: [] }],
    unscheduledItems: [],
    tripPlaces: [],
  } as unknown as Itinerary;
  await saveTripSnapshot('owner', trip);
  await saveItinerarySnapshot('owner', 'kept', itinerary);
  const mutation = {
    id: 'change',
    userId: 'owner',
    tripId: 'kept',
    state: 'pending',
    createdAt: '2026-10-20',
    operation: {
      kind: 'itinerary_day_note',
      itineraryDayId: 'day',
      note: 'Keep this idea',
      baseNote: null,
    },
  } as unknown as OfflineMutation;
  await queueOfflineMutation(mutation);
  await saveTripSnapshot('owner', { ...trip, archivedAt: '2026-10-20T00:00:00Z' });
  await expect(queueOfflineMutation({ ...mutation, id: 'new' })).rejects.toThrow('trip_archived');
  await pruneOrphanedTripSnapshots('owner', ['kept']);
  expect((await listUserMutations('owner', 'kept')).map((entry) => entry.id)).toEqual(['change']);
  expect((await readTripSnapshot('owner', 'kept'))?.itinerary).not.toBeNull();
  await saveTripSnapshot('owner', trip);
  await expect(queueOfflineMutation({ ...mutation, id: 'after-restore' })).resolves.toBeUndefined();
});

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'token', user: { id: 'owner' } } },
        error: null,
      }),
    },
  }),
}));

test.each(['archived', 'deleted'])(
  'a trip %s on another device keeps queued work as an explicit conflict',
  async (state) => {
    vi.stubGlobal('indexedDB', new FakeIndexedDbFactory() as unknown as IDBFactory);
    vi.stubGlobal('IDBKeyRange', { only: (value: unknown) => ({ value }) });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        localStorage: { getItem: () => 'owner', setItem: vi.fn(), removeItem: vi.fn() },
      }),
    );
    await clearAllOfflineTripData();
    const trip = { id: 'remote-archive', archivedAt: null } as Trip;
    await saveTripSnapshot('owner', trip);
    await saveItinerarySnapshot('owner', trip.id, {
      days: [],
      unscheduledItems: [],
      tripPlaces: [],
    } as unknown as Itinerary);
    await queueOfflineMutation({
      attempts: 0,
      errorCode: null,
      updatedAt: '2026-10-20',
      id: 'queued',
      userId: 'owner',
      tripId: trip.id,
      state: 'pending',
      createdAt: '2026-10-20',
      operation: {
        kind: 'itinerary_day_note',
        itineraryDayId: 'day',
        baseNote: null,
        note: 'Our idea',
      },
    } as OfflineMutation);
    const fetchMock = vi.fn(async () =>
      state === 'deleted'
        ? Response.json({ code: 'trip_not_found' }, { status: 404 })
        : Response.json({ trip: { ...trip, archivedAt: '2026-10-20T00:00:00Z' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { syncOfflineMutations } = await import('../lib/offline/trip-sync.ts');
    await syncOfflineMutations();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await listUserMutations('owner', trip.id))[0]).toMatchObject({
      id: 'queued',
      state: 'conflict',
      errorCode: state === 'archived' ? 'trip_archived' : 'trip_missing',
      operation: { note: 'Our idea' },
    });
    expect(Boolean((await readTripSnapshot('owner', trip.id))?.trip?.archivedAt)).toBe(
      state === 'archived',
    );
  },
);
