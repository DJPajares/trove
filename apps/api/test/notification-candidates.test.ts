import { expect, test, vi } from 'vitest';

const database = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@trove/db', () => ({ getPrismaClient: () => database.client }));

import {
  currentDueCandidate,
  reservationCandidate,
  taskCandidate,
} from '../src/services/notifications.js';

const trip = { id: 'trip-1', name: 'Kyoto' };
const localTime = (time: string) => new Date(`1970-01-01T${time}:00.000Z`);
const localDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

test('task lead time uses its stored time zone across a daylight-saving change', () => {
  const task = {
    id: 'task-1',
    label: 'Check tickets',
    dueDate: localDate('2026-11-01'),
    dueLocalTime: localTime('09:00'),
    dueTimeZone: 'America/New_York',
    updatedAt: new Date('2026-09-27T00:00:00.000Z'),
  };
  const candidate = taskCandidate(task, trip, new Date('2026-11-01T13:00:00.000Z'));
  expect(candidate?.eventAt.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  expect(taskCandidate(task, trip, new Date('2026-11-01T12:59:59.000Z'))).toBeNull();
  expect(
    taskCandidate(
      { ...task, dueLocalTime: localTime('02:30'), dueDate: localDate('2026-03-08') },
      trip,
      new Date('2026-03-08T06:30:00.000Z'),
    ),
  ).toBeNull();
});

test('flight departure keeps its authoritative instant over local fallback fields', () => {
  const reservation = {
    id: 'flight-1',
    title: 'Flight to Singapore',
    flightDepartureInstant: new Date('2026-09-27T09:00:00.000Z'),
    flightDepartureLocalDate: localDate('2026-09-29'),
    flightDepartureLocalTime: localTime('21:00'),
    flightDepartureTimeZone: 'Asia/Singapore',
    localDate: localDate('2026-09-30'),
    localTime: localTime('20:00'),
    timeZone: 'America/New_York',
    updatedAt: new Date(),
  };
  const candidate = reservationCandidate(reservation, trip, new Date('2026-09-27T07:00:00.000Z'));
  expect(candidate?.eventAt.toISOString()).toBe('2026-09-27T09:00:00.000Z');
  expect(candidate?.timeZone).toBe('Asia/Singapore');
});

test('pre-send review suppresses muted, completed, moved, and expired tasks', async () => {
  const task = {
    id: 'task-1',
    label: 'Check tickets',
    dueDate: localDate('2026-09-27'),
    dueLocalTime: localTime('09:00'),
    dueTimeZone: 'Asia/Singapore',
    updatedAt: new Date('2026-09-27T00:00:00.000Z'),
  };
  const now = new Date('2026-09-27T00:30:00.000Z');
  const candidate = taskCandidate(task, trip, now)!;
  const findTrip = vi.fn(async () => trip);
  const findTask = vi.fn(async () => task);
  database.client = {
    trip: { findFirst: findTrip },
    task: { findFirst: findTask },
  };

  expect(await currentDueCandidate(candidate, 'owner-1', now)).toEqual(candidate);
  expect(findTrip).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        ownerId: 'owner-1',
        owner: { notificationsEnabled: true, browserNotificationsEnabled: true },
        notificationPreferences: { none: { ownerId: 'owner-1', muted: true } },
      }),
    }),
  );

  findTrip.mockResolvedValueOnce(null as never);
  expect(await currentDueCandidate(candidate, 'owner-1', now)).toBeNull();
  findTask.mockResolvedValueOnce(null as never);
  expect(await currentDueCandidate(candidate, 'owner-1', now)).toBeNull();
  findTask.mockResolvedValueOnce({ ...task, label: 'Bring passport' });
  expect(await currentDueCandidate(candidate, 'owner-1', now)).toBeNull();
  findTask.mockResolvedValueOnce({ ...task, dueLocalTime: localTime('10:00') });
  expect(await currentDueCandidate(candidate, 'owner-1', now)).toBeNull();
  expect(await currentDueCandidate(candidate, 'owner-1', candidate.eventAt)).toBeNull();
});
