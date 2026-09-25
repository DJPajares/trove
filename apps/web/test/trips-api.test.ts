import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { TripApiError } from '../lib/trips/api.ts';

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({}),
  getBrowserSession: async () => ({ access_token: 'token', user: { id: 'user-1' } }),
}));

const { deleteTrip, saveTrip } = await import('../lib/trips/api.ts');

test('shrink errors retain the reviewed impact and revision', async () => {
  const impact = { revision: 'revision', removedDays: [], retainedDays: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'trip_date_shrink_confirmation_required', impact }),
    })),
  );
  await expect(saveTrip('trip', {} as Parameters<typeof saveTrip>[1])).rejects.toMatchObject({
    impact,
  });
});

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

test('date-move validation keeps the affected stop context for the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'trip_date_move_invalid_local_time',
        itemId: 'stop-1',
        itemLabel: 'Morning train',
        localTime: '02:30',
        targetDate: '2026-09-27',
      }),
    })),
  );

  await expect(saveTrip('trip-1', {} as Parameters<typeof saveTrip>[1])).rejects.toMatchObject({
    code: 'trip_date_move_invalid_local_time',
    invalidMovedTime: {
      itemId: 'stop-1',
      itemLabel: 'Morning train',
      localTime: '02:30',
      targetDate: '2026-09-27',
    },
    status: 400,
  } satisfies Partial<TripApiError>);
});
