import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SchedulingOutcome } from '@trove/types';

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: () => ({}) }));
vi.mock('@/lib/auth/transport', () => ({
  getProtectedSession: mocks.session,
  authenticatedFetch: vi.fn(),
}));
vi.mock('@/lib/offline/trip-store', () => ({ rememberOfflineUser: vi.fn() }));
import { saveItineraryTimingReview } from '@/lib/itinerary/api';
import {
  publishTimingReview,
  publishPendingTimingReview,
  storedTimingPending,
  storedTimingReview,
  TIMING_REVIEW_EVENT,
} from '@/lib/itinerary/timing-review';

const old: SchedulingOutcome = {
  changes: [],
  issues: [{ itemId: 'stop', code: 'TRAVEL_UNKNOWN', references: [], severity: 'review' }],
};
const clear: SchedulingOutcome = { changes: [], issues: [] };
const session = {
  data: { session: { user: { id: 'user' }, access_token: 'test-only-token' } },
  error: null,
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
  mocks.session.mockResolvedValue(session);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('persists a fresh review and publishes the cleared state to the current planner', async () => {
  publishTimingReview('user', 'trip', old);
  const event = vi.fn();
  window.addEventListener(TIMING_REVIEW_EVENT, event);
  await saveItineraryTimingReview('trip', clear, { expected: old });
  expect(storedTimingReview('user', 'trip')).toEqual(clear);
  expect(event).toHaveBeenCalledOnce();
});

it('does not overwrite a newer dismissal while authentication is resolving', async () => {
  let resolve!: (value: typeof session) => void;
  mocks.session.mockReturnValue(
    new Promise<typeof session>((done) => {
      resolve = done;
    }),
  );
  publishTimingReview('user', 'trip', old);
  const late = saveItineraryTimingReview('trip', old, { expected: old });
  publishTimingReview('user', 'trip', clear);
  resolve(session);
  await late;
  expect(storedTimingReview('user', 'trip')).toEqual(clear);
});

it('does not replace another trip or account’s review', async () => {
  publishTimingReview('other-user', 'trip', old);
  publishTimingReview('user', 'other-trip', old);
  await saveItineraryTimingReview('trip', clear, { expected: old });
  expect(storedTimingReview('other-user', 'trip')).toEqual(old);
  expect(storedTimingReview('user', 'other-trip')).toEqual(old);
});

it('does not release a newer pending offline review', async () => {
  let resolve!: (value: typeof session) => void;
  mocks.session.mockReturnValue(
    new Promise<typeof session>((done) => {
      resolve = done;
    }),
  );
  publishTimingReview('user', 'trip', old);
  const late = saveItineraryTimingReview('trip', clear, { expected: old });
  publishPendingTimingReview('user', 'trip');
  resolve(session);
  await late;
  expect(storedTimingPending('user', 'trip')).toBe(true);
  expect(storedTimingReview('user', 'trip')).toEqual(old);
});
