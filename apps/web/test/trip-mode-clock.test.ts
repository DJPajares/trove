import { expect, test } from 'vitest';

import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';
import {
  MAX_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  nextTripModeBoundary,
  refreshDelayMs,
} from '@/lib/itinerary/trip-mode-clock';

const timeZone = 'Asia/Singapore';

function item(overrides: Partial<ItineraryItem>): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: 'Item',
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id: 'item',
    itineraryDayId: 'day',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone,
    timeZoneSource: 'day_default',
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function context(overrides: Partial<TripModeContext> = {}): TripModeContext {
  return {
    contextAt: '2026-09-05T02:00:00.000Z',
    contextSource: 'live',
    currentOrRelevant: null,
    day: {
      date: '2026-09-05',
      defaultTimeZone: timeZone,
      id: 'day',
      items: [],
      name: null,
      number: 1,
    },
    leaveBy: null,
    nextItemId: null,
    selectedDate: '2026-09-05',
    state: 'free_time',
    trip: {
      endDate: '2026-09-06',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: timeZone,
      startDate: '2026-09-05',
    },
    ...overrides,
  };
}

// 2026-09-05T02:00Z is 10:00 in Singapore, so noon local is two hours away.
const now = new Date('2026-09-05T02:00:00.000Z');

test('an item start time is a boundary', () => {
  const at = new Date('2026-09-05T02:30:00.000Z');
  const found = nextTripModeBoundary(
    context({
      day: {
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        id: 'day',
        items: [item({ startInstant: at.toISOString() })],
        name: null,
        number: 1,
      },
    }),
    now,
  );

  expect(found).toStrictEqual(at);
});

test('an item end time is a boundary', () => {
  // Started already, so only the moment its duration runs out lies ahead.
  const found = nextTripModeBoundary(
    context({
      day: {
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        id: 'day',
        items: [item({ durationMinutes: 30, startInstant: '2026-09-05T01:50:00.000Z' })],
        name: null,
        number: 1,
      },
    }),
    now,
  );

  expect(found).toStrictEqual(new Date('2026-09-05T02:20:00.000Z'));
});

test('a leave-by alarm is a boundary', () => {
  const found = nextTripModeBoundary(
    context({
      leaveBy: {
        at: '2026-09-05T02:10:00.000Z',
        bufferSeconds: null,
        destinationItemId: 'b',
        distanceMeters: 100,
        mode: 'drive',
        originItemId: 'a',
        provider: 'google',
        routeDurationSeconds: 600,
        targetStartAt: '2026-09-05T02:20:00.000Z',
      },
    }),
    now,
  );

  expect(found).toStrictEqual(new Date('2026-09-05T02:10:00.000Z'));
});

test('the local daypart boundary is used when nothing else is sooner', () => {
  // Noon in Singapore is 04:00Z.
  expect(nextTripModeBoundary(context(), now)).toStrictEqual(new Date('2026-09-05T04:00:00.000Z'));
});

test('past items do not produce boundaries', () => {
  const found = nextTripModeBoundary(
    context({
      day: {
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        id: 'day',
        items: [item({ startInstant: '2026-09-05T00:00:00.000Z' })],
        name: null,
        number: 1,
      },
    }),
    now,
  );

  // Falls through to the noon daypart boundary rather than the stale start.
  expect(found).toStrictEqual(new Date('2026-09-05T04:00:00.000Z'));
});

test('completed and skipped items are ignored', () => {
  const found = nextTripModeBoundary(
    context({
      day: {
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        id: 'day',
        items: [
          item({ id: 'done', startInstant: '2026-09-05T02:30:00.000Z', travelStatus: 'completed' }),
          item({ id: 'skip', startInstant: '2026-09-05T02:40:00.000Z', travelStatus: 'skipped' }),
        ],
        name: null,
        number: 1,
      },
    }),
    now,
  );

  expect(found).toStrictEqual(new Date('2026-09-05T04:00:00.000Z'));
});

test('midnight rolls the day when it is the soonest boundary', () => {
  // 22:00 Singapore: both dayparts have passed, so the next change is midnight.
  const late = new Date('2026-09-05T14:00:00.000Z');
  expect(nextTripModeBoundary(context(), late)).toStrictEqual(new Date('2026-09-05T16:00:00.000Z'));
});

test('a day with no items still has a boundary', () => {
  expect(nextTripModeBoundary(context({ day: null }), now)).not.toBeNull();
});

test('the delay is clamped so a skewed clock cannot spin', () => {
  expect(refreshDelayMs(new Date(now.getTime() - 60_000), now)).toBe(MIN_REFRESH_DELAY_MS);
  expect(refreshDelayMs(new Date(now.getTime() + 1_000), now)).toBe(MIN_REFRESH_DELAY_MS);
});

test('a distant boundary still self-heals within the ceiling', () => {
  expect(refreshDelayMs(new Date(now.getTime() + 60 * 60_000), now)).toBe(MAX_REFRESH_DELAY_MS);
  expect(refreshDelayMs(null, now)).toBe(MAX_REFRESH_DELAY_MS);
});

test('a boundary inside the window is waited for exactly', () => {
  expect(refreshDelayMs(new Date(now.getTime() + 5 * 60_000), now)).toBe(5 * 60_000);
});

test('a daypart boundary is correct across a spring-forward transition', () => {
  // US DST begins 2026-03-08. Standing at 23:00 local on the 7th, the next
  // boundary is midnight, which is a real instant even though 02:00 is not.
  const newYork = context({
    day: {
      date: '2026-03-07',
      defaultTimeZone: 'America/New_York',
      id: 'day',
      items: [],
      name: null,
      number: 1,
    },
    selectedDate: '2026-03-07',
    trip: {
      endDate: '2026-03-09',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'America/New_York',
      startDate: '2026-03-07',
    },
  });
  const found = nextTripModeBoundary(newYork, new Date('2026-03-08T04:00:00.000Z'));

  // 2026-03-08T05:00Z is midnight EST on the 8th.
  expect(found).toStrictEqual(new Date('2026-03-08T05:00:00.000Z'));
});

test('a boundary in a half-hour offset zone lands on the local clock', () => {
  const kolkata = context({
    day: {
      date: '2026-09-05',
      defaultTimeZone: 'Asia/Kolkata',
      id: 'day',
      items: [],
      name: null,
      number: 1,
    },
    trip: {
      endDate: '2026-09-06',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Asia/Kolkata',
      startDate: '2026-09-05',
    },
  });
  // 05:00Z is 10:30 IST; noon IST is 06:30Z.
  expect(nextTripModeBoundary(kolkata, new Date('2026-09-05T05:00:00.000Z'))).toStrictEqual(
    new Date('2026-09-05T06:30:00.000Z'),
  );
});

test('the day zone and the trip zone are read independently', () => {
  // The traveller has flown east: the day runs on Tokyo time while the trip's
  // reference zone — which is what rolls the date — is still Singapore.
  const split = context({
    day: {
      date: '2026-09-05',
      defaultTimeZone: 'Asia/Tokyo',
      id: 'day',
      items: [],
      name: null,
      number: 1,
    },
  });
  // 14:30Z is 23:30 JST and 22:30 SGT. The day runs on Tokyo time, so Tokyo
  // midnight (15:00Z) flips its items to overdue before Singapore's midnight
  // (16:00Z) rolls the selected date.
  expect(nextTripModeBoundary(split, new Date('2026-09-05T14:30:00.000Z'))).toStrictEqual(
    new Date('2026-09-05T15:00:00.000Z'),
  );
});

test("an item's own zone contributes a boundary the day's zone would miss", () => {
  // The day runs on Singapore time, but this item sits in Tokyo — an hour
  // ahead — so it turns overdue at Tokyo midnight, 15:00Z, not 16:00Z.
  const found = nextTripModeBoundary(
    context({
      day: {
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        id: 'day',
        items: [item({ dayPart: 'evening', timeZone: 'Asia/Tokyo' })],
        name: null,
        number: 1,
      },
    }),
    new Date('2026-09-05T14:30:00.000Z'),
  );

  expect(found).toStrictEqual(new Date('2026-09-05T15:00:00.000Z'));
});
