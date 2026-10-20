import { expect, test } from 'vitest';

import type { Reservation } from '../lib/reservations/api.ts';
import {
  arrivalDayOffset,
  groupReservationsByDay,
  nextReservation,
  reservationWhen,
  stayDayIds,
  stayNights,
  stayNightsCovered,
} from '../lib/reservations/view.ts';

function reservation(overrides: Partial<Reservation> & Pick<Reservation, 'id'>): Reservation {
  return {
    accommodationAddress: null,
    applicableDays: [],
    attachments: [],
    bookingReference: null,
    checkInDate: null,
    checkOutDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    flight: null,
    itineraryItem: null,
    localDate: null,
    localTime: null,
    notes: null,
    plannedCost: null,
    provider: null,
    timeZone: null,
    timeZoneSource: null,
    title: overrides.id,
    transport: null,
    tripPlace: null,
    type: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const days = [
  { date: '2026-10-09', id: 'd1' },
  { date: '2026-10-10', id: 'd2' },
  { date: '2026-10-11', id: 'd3' },
  { date: '2026-10-12', id: 'd4' },
];

const flight = reservation({
  flight: {
    airline: 'SQ',
    arrival: {
      airport: 'NRT',
      authoritativeInstant: null,
      localDate: '2026-10-10',
      localTime: '07:25',
      timeZone: 'Asia/Tokyo',
    },
    departure: {
      airport: 'SIN',
      authoritativeInstant: null,
      localDate: '2026-10-09',
      localTime: '23:40',
      timeZone: 'Asia/Singapore',
    },
    gate: null,
    number: 'SQ 12',
    seat: null,
    terminal: null,
  },
  id: 'flight',
  type: 'flight',
});
const stay = reservation({
  checkInDate: '2026-10-10',
  checkOutDate: '2026-10-12',
  id: 'stay',
  type: 'accommodation',
});
const dinner = reservation({ id: 'dinner', localDate: '2026-10-10', localTime: '19:30' });
const museum = reservation({ id: 'museum', localDate: '2026-10-10' });
const visa = reservation({ id: 'visa', localDate: '2026-09-20' });
const someday = reservation({ id: 'someday' });

test('a flight is read from its departure and arrival, not its plain date', () => {
  const when = reservationWhen(flight);
  expect(when).toEqual({
    date: '2026-10-09',
    endDate: '2026-10-10',
    endTime: '07:25',
    time: '23:40',
  });
  expect(arrivalDayOffset(when)).toBe(1);
});

test('a stay is read from check-in to check-out', () => {
  expect(reservationWhen(stay).date).toBe('2026-10-10');
  expect(stayNights(stay)).toBe(2);
});

test('a booking saved with only a plain date keeps it', () => {
  const legacyFlight = reservation({
    flight: null,
    id: 'legacy',
    localDate: '2026-10-11',
    localTime: '08:00',
    type: 'flight',
  });
  expect(reservationWhen(legacyFlight)).toMatchObject({ date: '2026-10-11', time: '08:00' });
});

test('reservations read by trip day, timed before untimed, with the rest around them', () => {
  const groups = groupReservationsByDay([someday, museum, stay, dinner, flight, visa], days);
  expect(groups.map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
    ['before', ['visa']],
    ['d1', ['flight']],
    ['d2', ['dinner', 'museum', 'stay']],
    ['undated', ['someday']],
  ]);
  expect(groups[1]).toMatchObject({ dayNumber: 1, kind: 'day' });
});

test('the next booking is the first still ahead today, untimed ones included', () => {
  const list = [flight, stay, dinner, museum];
  expect(nextReservation(list, '2026-10-10', '20:00')?.id).toBe('museum');
  expect(nextReservation(list, '2026-10-10', '08:00')?.id).toBe('dinner');
  expect(nextReservation(list, '2026-10-13', '08:00')).toBeNull();
});

test('stays count the nights they cover', () => {
  expect(stayNightsCovered([stay], days)).toEqual({ covered: 2, total: 3 });
  expect(stayNightsCovered([stay], days.slice(0, 1))).toBeNull();
});

test('a stay applies from check-in day to check-out day', () => {
  expect(stayDayIds('2026-10-10', '2026-10-12', days)).toEqual(['d2', 'd3', 'd4']);
  expect(stayDayIds('2026-10-11', '', days)).toEqual(['d3']);
  expect(stayDayIds('', '2026-10-12', days)).toEqual([]);
});
