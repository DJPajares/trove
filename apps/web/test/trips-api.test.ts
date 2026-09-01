import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({}),
  getBrowserSession: async () => ({ access_token: 'token', user: { id: 'user-1' } }),
}));

const { deleteTrip } = await import('../lib/trips/api.ts');

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('deleting a trip does not label an empty request body as JSON', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
  vi.stubGlobal('fetch', fetchMock);

  await deleteTrip('trip-1');

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3001/trips/trip-1',
    expect.objectContaining({
      headers: { Authorization: 'Bearer token' },
      method: 'DELETE',
    }),
  );
});
