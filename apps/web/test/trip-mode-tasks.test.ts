import { expect, test } from 'vitest';

import { taskContextForScope, taskContextDay, taskScope } from '@/lib/tasks/context';
import {
  defaultTripModeTaskContext,
  nowTaskGroups,
  replaceTripModeTask,
  sortTripModeTasks,
  todayTaskRollup,
  withTaskCompletion,
} from '@/lib/tasks/trip-mode';
import { applyOfflineTaskMutation } from '@/lib/offline/trip-store';
import type { Task, TasksResponse } from '@/lib/tasks/api';

const contexts: TasksResponse['contexts'] = {
  days: [
    { date: '2026-09-05', id: 'day-1' },
    { date: '2026-09-06', id: 'day-2' },
  ],
  items: [
    { id: 'airport', itineraryDayId: 'day-1', label: 'Airport' },
    { id: 'market', itineraryDayId: 'day-1', label: 'Market' },
    { id: 'unscheduled', itineraryDayId: null, label: 'Maybe later' },
  ],
};

function task(id: string, context: Task['context'], overrides: Partial<Task> = {}): Task {
  return {
    completed: false,
    completedAt: null,
    context,
    createdAt: `2026-08-27T00:00:0${id.length}.000Z`,
    dueDate: null,
    dueLocalTime: null,
    dueTimeZone: null,
    id,
    label: id,
    note: null,
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

test('task attachment scope converts between trip, day, and itinerary stop contexts', () => {
  expect(taskScope({ kind: 'trip' })).toBe('trip');
  expect(taskContextDay({ itineraryItemId: 'airport', kind: 'item' }, contexts)).toBe('day-1');
  expect(
    taskContextForScope({
      contexts,
      dayId: 'day-2',
      itemDayId: 'day-1',
      itemId: 'airport',
      scope: 'day',
    }),
  ).toEqual({ itineraryDayId: 'day-2', kind: 'day' });
  expect(
    taskContextForScope({
      contexts,
      dayId: 'day-1',
      itemDayId: 'day-1',
      itemId: 'airport',
      scope: 'item',
    }),
  ).toEqual({ itineraryItemId: 'airport', kind: 'item' });
});

test('Now groups every task for current then next without duplicating the same stop', () => {
  const tasks = [
    task('current-one', { itineraryItemId: 'airport', kind: 'item' }),
    task('current-two', { itineraryItemId: 'airport', kind: 'item' }),
    task('next', { itineraryItemId: 'market', kind: 'item' }),
  ];
  expect(
    nowTaskGroups(tasks, 'airport', 'market').map((group) => [group.kind, group.tasks.length]),
  ).toEqual([
    ['here', 2],
    ['next', 1],
  ]);
  expect(nowTaskGroups(tasks, 'airport', 'airport')).toHaveLength(1);
});

test('Today rollup includes day, stop, and due trip tasks exactly once', () => {
  const dueTrip = task('due-trip', { kind: 'trip' }, { dueDate: '2026-09-05' });
  const result = todayTaskRollup({
    date: '2026-09-05',
    dayId: 'day-1',
    itemIds: ['airport', 'market'],
    tasks: [
      task('day', { itineraryDayId: 'day-1', kind: 'day' }),
      task('airport', { itineraryItemId: 'airport', kind: 'item' }),
      dueTrip,
      dueTrip,
      task('other-day', { itineraryDayId: 'day-2', kind: 'day' }),
    ],
  });
  expect(result.map((candidate) => candidate.id)).toEqual(['due-trip', 'day', 'airport']);
});

test('task ordering keeps open work first, then due order, then completed work', () => {
  const result = sortTripModeTasks([
    task('complete', { kind: 'trip' }, { completed: true, dueDate: '2026-09-01' }),
    task('later', { kind: 'trip' }, { dueDate: '2026-09-06' }),
    task('early', { kind: 'trip' }, { dueDate: '2026-09-05', dueLocalTime: '08:00' }),
  ]);
  expect(result.map((candidate) => candidate.id)).toEqual(['early', 'later', 'complete']);
});

test('optimistic completion can be confirmed or rolled back without losing task data', () => {
  const original = task('airport', { itineraryItemId: 'airport', kind: 'item' });
  const optimistic = withTaskCompletion(original, true, '2026-08-27T01:00:00.000Z');
  expect(replaceTripModeTask([original], optimistic)[0]).toMatchObject({
    completed: true,
    completedAt: '2026-08-27T01:00:00.000Z',
  });
  expect(replaceTripModeTask([optimistic], original)[0]).toEqual(original);
});

test('an offline queued completion updates the prepared task snapshot', () => {
  const original = task('airport', { itineraryItemId: 'airport', kind: 'item' });
  const data: TasksResponse = {
    contexts,
    tasks: [original],
    trip: { id: 'trip', name: 'Tokyo' },
  };
  const result = applyOfflineTaskMutation(data, {
    baseTask: original,
    input: { completed: true },
    kind: 'task_update',
    taskId: original.id,
  });
  expect(result.tasks[0]).toMatchObject({ completed: true });
  expect(result.tasks[0]?.completedAt).not.toBeNull();
});

test('Trip Mode quick-add defaults to current, next, day, then trip', () => {
  expect(
    defaultTripModeTaskContext({ currentItemId: 'airport', dayId: 'day-1', nextItemId: 'market' }),
  ).toEqual({ itineraryItemId: 'airport', kind: 'item' });
  expect(defaultTripModeTaskContext({ dayId: 'day-1', nextItemId: 'market' })).toEqual({
    itineraryItemId: 'market',
    kind: 'item',
  });
  expect(defaultTripModeTaskContext({ dayId: 'day-1' })).toEqual({
    itineraryDayId: 'day-1',
    kind: 'day',
  });
  expect(defaultTripModeTaskContext({})).toEqual({ kind: 'trip' });
});
