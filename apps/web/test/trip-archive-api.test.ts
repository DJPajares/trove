import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  listUserMutations: vi.fn(),
  saveTripSnapshot: vi.fn(),
  pruneOrphanedTripSnapshots: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({}),
  getBrowserSession: async () => ({ access_token: 'token', user: { id: 'owner' } }),
}));
vi.mock('@/lib/offline/trip-store', () => ({
  ...storage,
  rememberOfflineUser: vi.fn(),
  getRememberedOfflineUser: () => null,
  setOfflineApiReachable: vi.fn(),
  readTripSnapshot: async () => undefined,
}));
import { fetchTrips, setTripArchived } from '../lib/trips/api.ts';
beforeEach(() => {
  vi.clearAllMocks();
  storage.listUserMutations.mockResolvedValue([]);
  storage.pruneOrphanedTripSnapshots.mockResolvedValue(undefined);
  storage.saveTripSnapshot.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

test('filtered trip lists prune only against the complete owned identity index', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ trips: [], ownedTripIds: ['archived-id'], archivedTripCount: 1 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await fetchTrips();
  expect(storage.pruneOrphanedTripSnapshots).toHaveBeenLastCalledWith('owner', ['archived-id']);
  await fetchTrips('only');
  expect(fetchMock).toHaveBeenLastCalledWith(
    'http://localhost:3001/trips?archived=only',
    expect.anything(),
  );
  expect(storage.pruneOrphanedTripSnapshots).toHaveBeenLastCalledWith('owner', ['archived-id']);
  storage.pruneOrphanedTripSnapshots.mockClear();
  fetchMock.mockResolvedValue(Response.json({ trips: [] }));
  await fetchTrips();
  expect(storage.pruneOrphanedTripSnapshots).not.toHaveBeenCalled();
});

test.each(['pending', 'failed', 'conflict'])(
  'archiving refuses %s local work and makes no write',
  async (state) => {
    storage.listUserMutations.mockResolvedValue([{ state }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(setTripArchived('trip', true)).rejects.toMatchObject({
      code: 'archive_pending',
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test('archive and restore require a connection; restore preserves queued work', async () => {
  const fetchMock = vi.fn(async () => Response.json({ trip: { id: 'trip', archivedAt: null } }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { onLine: false });
  for (const archived of [true, false])
    await expect(setTripArchived('trip', archived)).rejects.toMatchObject({
      code: 'archive_offline',
    });
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true });
  storage.listUserMutations.mockResolvedValue([{ state: 'conflict' }]);
  await setTripArchived('trip', false);
  expect(storage.listUserMutations).not.toHaveBeenCalled();
  expect(storage.saveTripSnapshot).toHaveBeenCalledWith('owner', { id: 'trip', archivedAt: null });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3001/trips/trip/archive',
    expect.objectContaining({ method: 'PATCH', body: '{"archived":false}' }),
  );
});
