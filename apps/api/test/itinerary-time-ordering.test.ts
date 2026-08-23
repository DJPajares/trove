import { beforeEach, expect, test } from 'vitest';

import {
  createItineraryItem,
  itemSortMinute,
  timedInsertIndex,
  updateItineraryItem,
} from '../src/services/itineraries.js';
import { parseLocalTime } from '../src/services/itinerary-rules.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
beforeEach(resetStore);

const at = (localTime: string) => ({ dayPart: null, localStartTime: parseLocalTime(localTime) });
const during = (dayPart: string) => ({ dayPart, localStartTime: null });
const untimed = { dayPart: null, localStartTime: null };

test('an exact time sorts at its own minute of the day', () => {
  expect(itemSortMinute(at('00:00'))).toBe(0);
  expect(itemSortMinute(at('09:30'))).toBe(570);
  expect(itemSortMinute(at('23:59'))).toBe(1439);
});

test('a daypart sorts at the start of its window', () => {
  expect(itemSortMinute(during('MORNING'))).toBe(0);
  expect(itemSortMinute(during('AFTERNOON'))).toBe(720);
  expect(itemSortMinute(during('EVENING'))).toBe(1020);
});

test('anytime and no schedule are untimed', () => {
  expect(itemSortMinute(during('ANYTIME'))).toBeNull();
  expect(itemSortMinute(untimed)).toBeNull();
});

test('an exact time outranks the daypart it falls in', () => {
  // 13:00 is inside the afternoon window, so it must sort after a bare "Afternoon".
  expect(itemSortMinute(at('13:00'))!).toBeGreaterThan(itemSortMinute(during('AFTERNOON'))!);
});

test('a timed item lands between the neighbours its clock puts it between', () => {
  const day = [at('08:00'), at('14:00')];
  expect(timedInsertIndex(day, itemSortMinute(at('09:00'))!)).toBe(1);
});

test('a timed item earlier than everything lands first', () => {
  expect(timedInsertIndex([at('08:00'), at('14:00')], itemSortMinute(at('07:00'))!)).toBe(0);
});

test('a timed item later than everything lands last', () => {
  expect(timedInsertIndex([at('08:00'), at('14:00')], itemSortMinute(at('18:00'))!)).toBe(2);
});

test('an equal time keeps the incumbent first', () => {
  // Only a sibling starting strictly later moves the boundary, so the arrival
  // sits after the item already holding that time rather than displacing it.
  expect(timedInsertIndex([at('08:00'), at('14:00')], itemSortMinute(at('08:00'))!)).toBe(1);
});

test('a morning daypart item orders ahead of an afternoon-timed item', () => {
  expect(timedInsertIndex([at('13:00')], itemSortMinute(during('MORNING'))!)).toBe(0);
});

test('an untimed item at the head keeps its place', () => {
  // The untimed anchor is transparent: 07:00 is earlier than the 08:00 item but
  // must not jump ahead of the anchor the traveller deliberately put first.
  const day = [untimed, at('08:00')];
  expect(timedInsertIndex(day, itemSortMinute(at('07:00'))!)).toBe(1);
});

test('an untimed item at the tail keeps its place', () => {
  const day = [at('08:00'), untimed];
  expect(timedInsertIndex(day, itemSortMinute(at('18:00'))!)).toBe(2);
});

test('untimed items between timed ones do not shift the boundary', () => {
  const day = [at('08:00'), untimed, untimed, at('14:00')];
  expect(timedInsertIndex(day, itemSortMinute(at('09:00'))!)).toBe(3);
});

test('a day of only untimed items appends', () => {
  expect(timedInsertIndex([untimed, untimed], itemSortMinute(at('09:00'))!)).toBe(2);
});

test('an empty day takes the first slot', () => {
  expect(timedInsertIndex([], itemSortMinute(at('09:00'))!)).toBe(0);
});

function seedDay(tripId: string, dayId: string, userId: string) {
  store.trip.push({
    endDate: new Date('2026-09-06T00:00:00.000Z'),
    id: tripId,
    name: 'Trip',
    ownerId: userId,
    referenceTimeZone: 'Asia/Singapore',
    startDate: new Date('2026-09-05T00:00:00.000Z'),
  });
  store.itineraryDay.push({
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: new Date('2026-09-05T00:00:00.000Z'),
    defaultTimeZone: 'Asia/Singapore',
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceItemId: null,
    defaultTimeZoneSourceTripPlaceId: null,
    id: dayId,
    notes: null,
    tripId,
  });
}

function seedItem(tripId: string, dayId: string, id: string, position: number, localTime: string) {
  store.itineraryItem.push({
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    customLabel: id,
    customLocation: null,
    customLocationTimeZone: null,
    durationMinutes: null,
    notes: null,
    plannedCostAmount: null,
    plannedCostCurrencyCode: null,
    priority: null,
    travelModeToNext: 'DRIVE',
    travelStatus: 'UPCOMING',
    dayPart: null,
    id,
    itineraryDayId: dayId,
    localStartTime: parseLocalTime(localTime),
    position,
    startInstant: null,
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Singapore',
    timeZoneSource: 'DAY_DEFAULT',
    tripId,
    tripPlaceId: null,
  });
}

/** The day as the traveller reads it: ids in position order. */
function dayOrder(dayId: string) {
  return store.itineraryItem
    .filter((item) => item.itineraryDayId === dayId)
    .sort((left, right) => (left.position as number) - (right.position as number))
    .map((item) => item.customLabel);
}

test('creating a timed item slots it into the day rather than appending', async () => {
  seedDay('trip', 'day', 'user');
  seedItem('trip', 'day', '08:00', 0, '08:00');
  seedItem('trip', 'day', '14:00', 1, '14:00');

  await createItineraryItem('user', 'trip', {
    customLabel: '09:00',
    itineraryDayId: 'day',
    schedule: { kind: 'exact', localTime: '09:00' },
  });

  expect(dayOrder('day')).toStrictEqual(['08:00', '09:00', '14:00']);
});

test('creating an untimed item still appends', async () => {
  seedDay('trip', 'day', 'user');
  seedItem('trip', 'day', '08:00', 0, '08:00');
  seedItem('trip', 'day', '14:00', 1, '14:00');

  await createItineraryItem('user', 'trip', {
    customLabel: 'untimed',
    itineraryDayId: 'day',
    schedule: { kind: 'none' },
  });

  expect(dayOrder('day')).toStrictEqual(['08:00', '14:00', 'untimed']);
});

test('retiming an item moves it to its new place in the day', async () => {
  seedDay('trip', 'day', 'user');
  seedItem('trip', 'day', '08:00', 0, '08:00');
  seedItem('trip', 'day', '14:00', 1, '14:00');
  seedItem('trip', 'day', 'late', 2, '18:00');

  await updateItineraryItem('user', 'trip', 'late', {
    schedule: { kind: 'exact', localTime: '07:00' },
  });

  expect(dayOrder('day')).toStrictEqual(['late', '08:00', '14:00']);
});

test('an edit that does not change the time leaves the order alone', async () => {
  seedDay('trip', 'day', 'user');
  seedItem('trip', 'day', 'a', 0, '14:00');
  seedItem('trip', 'day', 'b', 1, '08:00');

  await updateItineraryItem('user', 'trip', 'b', { notes: 'a note' });

  // 'b' is out of clock order, but the traveller put it there and this edit is
  // not about time, so nothing moves.
  expect(dayOrder('day')).toStrictEqual(['a', 'b']);
});

test('clearing an item time leaves it where it sat', async () => {
  seedDay('trip', 'day', 'user');
  seedItem('trip', 'day', 'a', 0, '08:00');
  seedItem('trip', 'day', 'b', 1, '14:00');
  seedItem('trip', 'day', 'c', 2, '18:00');

  await updateItineraryItem('user', 'trip', 'b', { schedule: { kind: 'none' } });

  expect(dayOrder('day')).toStrictEqual(['a', 'b', 'c']);
});
