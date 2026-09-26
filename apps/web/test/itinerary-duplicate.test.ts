import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  DuplicateAttemptTracker,
  refreshedItineraryContainsCopy,
} from '../lib/itinerary/duplicate-attempt.ts';

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'token', user: { id: 'user' } } },
        error: null,
      }),
    },
  }),
}));

const { duplicateItineraryItem } = await import('../lib/itinerary/api.ts');

beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
afterEach(() => vi.unstubAllGlobals());

test.each([201, 200])('duplicate parses a %i JSON response', async (status) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status,
    json: async () => ({ itemId: 'copy-id' }),
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(duplicateItineraryItem('trip', 'source', 'copy-id')).resolves.toStrictEqual({
    itemId: 'copy-id',
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3001/trips/trip/itinerary/items/source/duplicate',
    expect.objectContaining({
      body: JSON.stringify({ clientItemId: 'copy-id' }),
      method: 'POST',
    }),
  );
});

test('lost response and failed refresh retain the same ID, while rapid repeat is blocked', () => {
  let next = 0;
  const attempts = new DuplicateAttemptTracker(() => `copy-${++next}`);
  expect(attempts.begin('source')).toBe('copy-1');
  expect(attempts.begin('source')).toBeNull();

  attempts.failed('source'); // The server may have created the copy before the response failed.
  expect(attempts.begin('source')).toBe('copy-1');
  attempts.failed('source'); // A successful response followed by a failed refresh is also uncertain.
  expect(attempts.begin('source')).toBe('copy-1');
  attempts.complete('source');

  expect(attempts.begin('source')).toBe('copy-2');
});

test('a lost response retries the same API mutation ID', async () => {
  const attempts = new DuplicateAttemptTracker(() => 'copy-id');
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('response lost'))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ itemId: 'copy-id' }),
    });
  vi.stubGlobal('fetch', fetchMock);

  const firstId = attempts.begin('source')!;
  await expect(duplicateItineraryItem('trip', 'source', firstId)).rejects.toThrow('response lost');
  attempts.failed('source');
  const retryId = attempts.begin('source')!;
  await expect(duplicateItineraryItem('trip', 'source', retryId)).resolves.toStrictEqual({
    itemId: 'copy-id',
  });
  attempts.complete('source');

  expect(retryId).toBe(firstId);
  expect(fetchMock.mock.calls.map((call) => call[1].body)).toStrictEqual([
    JSON.stringify({ clientItemId: 'copy-id' }),
    JSON.stringify({ clientItemId: 'copy-id' }),
  ]);
});

test('a stale itinerary cannot confirm the copy after a failed refresh', () => {
  const stale = { days: [{ items: [{ id: 'source' }] }], unscheduledItems: [] };
  const refreshed = {
    days: [{ items: [{ id: 'source' }, { id: 'copy-id' }] }],
    unscheduledItems: [],
  };

  expect(refreshedItineraryContainsCopy(stale as never, 'copy-id')).toBe(false);
  expect(refreshedItineraryContainsCopy(refreshed as never, 'copy-id')).toBe(true);
});
