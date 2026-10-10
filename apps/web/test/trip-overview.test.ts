import { expect, test } from 'vitest';
import { isTripOverviewTaskRelevant, selectTripOverviewDay } from '@trove/types';
import { createQueryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { invalidateTripQueries, ITINERARY_EDIT_QUERY_ROOTS } from '@/lib/query/trip-invalidation';
import { overviewLifecycle, overviewPlannerHref, offlineTripOverview } from '@/lib/trips/overview';
import type { OfflineTripSnapshot } from '@/lib/offline/trip-store';
import type { Itinerary, ItineraryItem } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';

const date = '2026-10-09';
const now = new Date(`${date}T02:00:00Z`);
const trip = {
  id: 'trip',
  startDate: date,
  endDate: '2026-10-10',
  referenceTimeZone: 'Asia/Singapore',
} as Trip;
const days = [
  { id: 'first', date, stopCount: 2 },
  { id: 'open', date: '2026-10-10', stopCount: 0 },
];

test('day entry selects the first gap, falls back to the first complete day, and does not guess a live day', () => {
  expect(selectTripOverviewDay(days, 'planning', date)?.id).toBe('open');
  expect(
    selectTripOverviewDay(
      days.map((day) => ({ ...day, stopCount: 1 })),
      'planning',
      date,
    )?.id,
  ).toBe('first');
  expect(selectTripOverviewDay(days, 'active', '2026-10-08')).toBeNull();
  expect(selectTripOverviewDay(days, 'completed', date)).toBeNull();
  expect(overviewPlannerHref('trip', 'open')).toBe('/trips/trip/itinerary?day=open');
});

test('lifecycle uses the trip reference zone independently of the traveller clock', () => {
  expect(overviewLifecycle(trip, now)).toBe('active');
  expect(overviewLifecycle(trip, new Date('2026-10-08T15:59:59Z'))).toBe('planning');
  expect(overviewLifecycle(trip, new Date('2026-10-10T16:00:00Z'))).toBe('completed');
});

test('live tasks include today, current/next and overdue commitments, not unrelated future preparation', () => {
  const task = { dayId: null, itemId: null, dueDate: null };
  expect(
    isTripOverviewTaskRelevant({ ...task, dayId: 'first' }, 'active', date, 'first', ['museum']),
  ).toBe(true);
  expect(
    isTripOverviewTaskRelevant({ ...task, itemId: 'museum' }, 'active', date, 'first', ['museum']),
  ).toBe(true);
  expect(
    isTripOverviewTaskRelevant({ ...task, dueDate: '2026-10-08' }, 'active', date, 'first', []),
  ).toBe(true);
  expect(
    isTripOverviewTaskRelevant({ ...task, dueDate: '2026-10-10' }, 'active', date, 'first', []),
  ).toBe(false);
  expect(isTripOverviewTaskRelevant(task, 'planning', date, null, [])).toBe(true);
  expect(isTripOverviewTaskRelevant(task, 'completed', date, null, [])).toBe(false);
});

function snapshot(): OfflineTripSnapshot {
  const stop = (id: string, time: string, travelStatus = 'upcoming'): ItineraryItem =>
    ({
      id,
      customLabel: id,
      localStartTime: time,
      startInstant: null,
      timeSemantics: 'floating_local',
      durationMinutes: 120,
      dayPart: null,
      tripPlace: null,
      travelStatus,
    }) as ItineraryItem;
  return {
    trip,
    itinerary: {
      trip,
      days: [
        {
          id: 'first',
          date,
          name: 'City walks',
          items: [
            stop('done', '08:00', 'completed'),
            stop('museum', '09:00'),
            stop('lunch', '12:00'),
          ],
        },
      ],
      tripPlaces: [],
      unscheduledItems: [],
    } as unknown as Itinerary,
    tasks: { tasks: [] },
    memories: { storyCover: null, memories: [] },
    tripInfo: { entries: [] },
  } as unknown as OfflineTripSnapshot;
}

test('offline derives current and next from the existing mutation-aware itinerary, without routes', () => {
  const result = offlineTripOverview(snapshot(), 'Asia/Singapore', now);
  expect(result.day).toMatchObject({
    id: 'first',
    name: 'City walks',
    state: 'planned',
    current: { id: 'museum', kind: 'current' },
    next: { id: 'lunch' },
  });
  expect(result.memories.photos).toEqual([]);
  expect(result.pinnedInfo).toEqual([]);
});

test('offline lists every day with the town the planner would give it', () => {
  const stored = snapshot();
  const itinerary = stored.itinerary as unknown as {
    days: Record<string, unknown>[];
    tripPlaces: unknown[];
  };
  itinerary.tripPlaces = [
    {
      id: 'hotel',
      place: { snapshot: null, providerAddress: '12 Hang Bac, Hoan Kiem, Hanoi, 100000, Vietnam' },
    },
  ];
  itinerary.days[0] = { ...itinerary.days[0], dailyBaseTripPlaceId: 'hotel' };
  const result = offlineTripOverview(stored, 'Asia/Singapore', now);
  expect(result.days).toEqual([
    { id: 'first', date, number: 1, name: 'City walks', town: 'Hanoi', stopCount: 3 },
  ]);
  expect(result.tripPlaceCount).toBe(1);
});

test('itinerary and supporting edits invalidate every clock variant of only this trip’s overview', async () => {
  const client = createQueryClient();
  for (const zone of ['UTC', 'Asia/Singapore'])
    client.setQueryData(queryKeys.tripOverview('trip', zone), {});
  client.setQueryData(queryKeys.tripOverview('other-trip', 'UTC'), {});
  await invalidateTripQueries(client, 'trip', ITINERARY_EDIT_QUERY_ROOTS);
  expect(client.getQueryState(queryKeys.tripOverview('trip', 'UTC'))?.isInvalidated).toBe(true);
  expect(
    client.getQueryState(queryKeys.tripOverview('trip', 'Asia/Singapore'))?.isInvalidated,
  ).toBe(true);
  expect(client.getQueryState(queryKeys.tripOverview('other-trip', 'UTC'))?.isInvalidated).toBe(
    false,
  );
});
