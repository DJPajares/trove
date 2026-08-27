import { expect, test } from 'vitest';

import type { Task, TasksResponse } from '@/lib/tasks/api';
import { groupTasksByContext } from '@/lib/tasks/grouping';

const contexts: TasksResponse['contexts'] = {
  days: [
    { date: '2026-09-05', id: 'day-1' },
    { date: '2026-09-06', id: 'day-2' },
    { date: '2026-09-07', id: 'day-3' },
  ],
  items: [
    { id: 'airport', itineraryDayId: 'day-1', label: 'Airport' },
    { id: 'market', itineraryDayId: 'day-1', label: 'Market' },
    { id: 'museum', itineraryDayId: 'day-2', label: 'Museum' },
    { id: 'someday', itineraryDayId: null, label: 'Maybe later' },
  ],
};

function task(id: string, context: Task['context'], overrides: Partial<Task> = {}): Task {
  return {
    completed: false,
    completedAt: null,
    context,
    createdAt: '2026-08-27T00:00:00.000Z',
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

test('grouping sorts tasks into the whole trip, each day, and each day’s stops', () => {
  const grouping = groupTasksByContext(
    [
      task('pack', { kind: 'trip' }),
      task('check-in', { itineraryDayId: 'day-1', kind: 'day' }),
      task('passport', { itineraryItemId: 'airport', kind: 'item' }),
      task('tickets', { itineraryItemId: 'museum', kind: 'item' }),
    ],
    contexts,
  );

  expect(grouping.trip.map((entry) => entry.id)).toEqual(['pack']);
  expect(grouping.days.map(({ day }) => day.id)).toEqual(['day-1', 'day-2']);
  expect(grouping.days[0]?.dayTasks.map((entry) => entry.id)).toEqual(['check-in']);
  expect(grouping.days[0]?.items).toEqual([
    expect.objectContaining({ id: 'airport', label: 'Airport' }),
  ]);
  expect(grouping.days[1]?.dayTasks).toEqual([]);
  expect(grouping.days[1]?.items[0]?.tasks.map((entry) => entry.id)).toEqual(['tickets']);
});

test('grouping leaves out days and stops that have nothing to do', () => {
  const grouping = groupTasksByContext([task('pack', { kind: 'trip' })], contexts);

  expect(grouping.days).toEqual([]);
  expect(grouping.unscheduled).toEqual([]);
  expect(grouping.trip).toHaveLength(1);
});

test('grouping keeps tasks for a stop with no day in the unscheduled bucket', () => {
  const grouping = groupTasksByContext(
    [task('book-later', { itineraryItemId: 'someday', kind: 'item' })],
    contexts,
  );

  expect(grouping.days).toEqual([]);
  expect(grouping.unscheduled).toEqual([
    expect.objectContaining({ id: 'someday', label: 'Maybe later' }),
  ]);
  expect(grouping.unscheduled[0]?.tasks.map((entry) => entry.id)).toEqual(['book-later']);
});

test('grouping orders each group by open state, then by when the task is due', () => {
  const grouping = groupTasksByContext(
    [
      task('later', { itineraryDayId: 'day-1', kind: 'day' }, { dueDate: '2026-09-08' }),
      task('done', { itineraryDayId: 'day-1', kind: 'day' }, { completed: true }),
      task('soonest', { itineraryDayId: 'day-1', kind: 'day' }, { dueDate: '2026-09-05' }),
      task('undated', { itineraryDayId: 'day-1', kind: 'day' }),
    ],
    contexts,
  );

  expect(grouping.days[0]?.dayTasks.map((entry) => entry.id)).toEqual([
    'soonest',
    'later',
    'undated',
    'done',
  ]);
});
