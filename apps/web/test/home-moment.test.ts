import { expect, test } from 'vitest';

import { resolveHomeMoment } from '../lib/home/moment.ts';
import { selectNextSteps } from '../lib/home/next-steps.ts';
import { summarizeToday } from '../lib/home/today.ts';
import type { ItineraryItem, TripModeContext } from '../lib/itinerary/api.ts';
import type { Task } from '../lib/tasks/api.ts';
import type { Trip } from '../lib/trips/api.ts';

const NOW = new Date('2026-10-09T04:00:00.000Z');
const TODAY = '2026-10-09';

function trip(overrides: Partial<Trip> & Pick<Trip, 'id' | 'lifecycle'>): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-11-10',
    experienceNote: null,
    experienceRating: null,
    itineraryCoverage: { percentage: 100, plannedDays: 7, totalDays: 7 },
    memoryCount: 0,
    name: 'A trip',
    partySize: 1,
    planningReadiness: 'in_progress',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate: '2026-11-04',
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    weatherLocation: null,
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    completed: false,
    completedAt: null,
    context: { kind: 'trip' } as Task['context'],
    createdAt: '2026-10-01T00:00:00.000Z',
    dueDate: null,
    dueLocalTime: null,
    dueTimeZone: null,
    label: overrides.id,
    note: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

// --- The moment Home is about ---------------------------------------------

test('Home leads with the trip under way and lists what is coming after it', () => {
  const moment = resolveHomeMoment(
    [
      trip({ id: 'later', lifecycle: 'planning', startDate: '2026-12-05' }),
      trip({ endDate: '2026-10-10', id: 'now', lifecycle: 'active', startDate: '2026-10-07' }),
      trip({ id: 'soon', lifecycle: 'planning', startDate: '2026-10-16' }),
    ],
    NOW,
    TODAY,
  );

  expect(moment.lead?.id).toBe('now');
  expect(moment.comingUp.map((entry) => entry.id)).toStrictEqual(['soon', 'later']);
});

test('a trip just finished leads when nothing is under way or planned', () => {
  const moment = resolveHomeMoment(
    [trip({ endDate: '2026-10-06', id: 'back', lifecycle: 'completed', startDate: '2026-10-02' })],
    NOW,
    TODAY,
  );

  expect(moment.lead?.id).toBe('back');
  // The trip Home leads with is never offered again as a journey to return to.
  expect(moment.journey).toBeNull();
});

test('a past trip from this week in an earlier year is offered as an anniversary', () => {
  const moment = resolveHomeMoment(
    [
      trip({ id: 'next', lifecycle: 'planning' }),
      trip({
        endDate: '2026-09-20',
        id: 'recent',
        lifecycle: 'completed',
        startDate: '2026-09-15',
      }),
      trip({
        endDate: '2024-10-12',
        id: 'two-years',
        lifecycle: 'completed',
        startDate: '2024-10-06',
      }),
    ],
    NOW,
    TODAY,
  );

  expect(moment.journey).toMatchObject({ kind: 'anniversary', years: 2 });
  expect(moment.journey?.trip.id).toBe('two-years');
});

test('an anniversary is found across the turn of the year', () => {
  const moment = resolveHomeMoment(
    [
      trip({
        endDate: '2025-01-03',
        id: 'new-year',
        lifecycle: 'completed',
        startDate: '2024-12-29',
      }),
    ],
    new Date('2026-01-02T04:00:00.000Z'),
    '2026-01-02',
  );

  expect(moment.journey).toMatchObject({ kind: 'anniversary', years: 2 });
});

test('without an anniversary the most recent finished trip is offered', () => {
  const moment = resolveHomeMoment(
    [
      trip({ id: 'next', lifecycle: 'planning' }),
      trip({ endDate: '2026-03-02', id: 'march', lifecycle: 'completed', startDate: '2026-02-27' }),
      trip({ endDate: '2026-06-02', id: 'june', lifecycle: 'completed', startDate: '2026-05-28' }),
    ],
    NOW,
    TODAY,
  );

  expect(moment.journey).toMatchObject({ kind: 'latest' });
  expect(moment.journey?.trip.id).toBe('june');
});

test('a traveller with no trips has no moment at all', () => {
  expect(resolveHomeMoment([], NOW, TODAY)).toStrictEqual({
    comingUp: [],
    journey: null,
    lead: null,
  });
});

// --- Today, for the trip under way ----------------------------------------

function item(id: string, position: number, travelStatus: ItineraryItem['travelStatus']) {
  return { id, position, travelStatus } as ItineraryItem;
}

function context(items: ItineraryItem[], current: string | null, next: string | null) {
  return {
    currentOrRelevant: current ? { itemId: current, kind: 'current', reason: 'exact_time' } : null,
    day: { date: TODAY, defaultTimeZone: 'UTC', id: 'day', items, name: null, number: 3 },
    nextItemId: next,
  } as TripModeContext;
}

test('today starts from where the traveller is, with what came before counted', () => {
  const summary = summarizeToday(
    context(
      [
        item('breakfast', 0, 'completed'),
        item('museum', 1, 'upcoming'),
        item('lunch', 2, 'upcoming'),
        item('market', 3, 'upcoming'),
      ],
      'museum',
      'lunch',
    ),
  );

  expect(summary?.earlier).toBe(1);
  expect(summary?.rows.map((row) => [row.item.id, row.state])).toStrictEqual([
    ['museum', 'current'],
    ['lunch', 'next'],
    ['market', 'upcoming'],
  ]);
});

test('a long day shows a few stops and counts the rest', () => {
  const items = Array.from({ length: 7 }, (_, index) => item(`s${index}`, index, 'upcoming'));
  const summary = summarizeToday(context(items, null, 's0'), 3);

  expect(summary?.rows).toHaveLength(3);
  expect(summary?.later).toBe(4);
});

test('a day already lived is told apart from a day with nothing planned', () => {
  expect(summarizeToday(context([item('a', 0, 'completed')], null, null))).toStrictEqual({
    earlier: 1,
    later: 0,
    rows: [],
    total: 1,
  });
  expect(summarizeToday(context([], null, null))?.total).toBe(0);
  expect(summarizeToday(null)).toBeNull();
});

// --- Before you go ---------------------------------------------------------

test('a trip with open days and tasks asks about both, open days first', () => {
  const steps = selectNextSteps({
    now: NOW,
    offlineReady: null,
    tasks: [
      task({ id: 'undated', createdAt: '2026-09-01T00:00:00.000Z' }),
      task({ dueDate: '2026-10-20', id: 'visa' }),
      task({ completed: true, id: 'done' }),
    ],
    trip: trip({
      id: 'trip',
      itineraryCoverage: { percentage: 43, plannedDays: 3, totalDays: 7 },
      lifecycle: 'planning',
    }),
    weather: null,
  });

  expect(steps).toMatchObject([
    { kind: 'openDays', open: 4, total: 7 },
    { count: 2, kind: 'tasks', next: { id: 'visa' } },
  ]);
});

test('a fully planned trip is asked whether it is ready, never told', () => {
  const steps = selectNextSteps({
    now: NOW,
    offlineReady: null,
    tasks: [],
    trip: trip({ id: 'trip', lifecycle: 'planning' }),
    weather: null,
  });

  expect(steps).toStrictEqual([{ kind: 'readiness', prompt: 'suggest' }]);
});

test('an offline copy is raised only in the last few days, ahead of planning', () => {
  const base = {
    now: NOW,
    offlineReady: false,
    tasks: [],
    weather: null,
  };
  const partlyPlanned = { percentage: 50, plannedDays: 1, totalDays: 2 };

  expect(
    selectNextSteps({
      ...base,
      trip: trip({
        endDate: '2026-10-12',
        id: 'soon',
        itineraryCoverage: partlyPlanned,
        lifecycle: 'planning',
        planningReadiness: 'ready',
        startDate: '2026-10-11',
      }),
    }).map((step) => step.kind),
  ).toStrictEqual(['offline', 'openDays']);

  expect(
    selectNextSteps({
      ...base,
      trip: trip({ id: 'far', lifecycle: 'planning', planningReadiness: 'ready' }),
    }),
  ).toStrictEqual([]);
});

test('a trip under way or finished asks nothing of this list', () => {
  for (const lifecycle of ['active', 'completed'] as const) {
    expect(
      selectNextSteps({
        now: NOW,
        offlineReady: false,
        tasks: [task({ id: 'a' })],
        trip: trip({ id: 'trip', lifecycle }),
        weather: null,
      }),
    ).toStrictEqual([]);
  }
});
