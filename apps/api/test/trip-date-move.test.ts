import { expect, test } from 'vitest';

import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();

const { TripDateMoveInvalidLocalTimeError, TripDateShrinkConfirmationError, updateTrip } =
  await import('../src/services/trips.js');

const OWNER = 'owner-user-id';
const TRIP = 'trip-kansai';
const DAYS = ['day-one', 'day-two', 'day-three'] as const;

function day(id: string, date: string, name: string) {
  return {
    dailyBaseTripPlaceId: null,
    date: new Date(`${date}T00:00:00.000Z`),
    defaultTimeZone: 'Asia/Tokyo',
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceItemId: null,
    defaultTimeZoneSourceTripPlaceId: null,
    id,
    name,
    notes: `notes for ${name}`,
    tripId: TRIP,
  };
}

/** A three-day trip whose days each carry content worth not losing. */
function seed() {
  resetStore();

  store.trip.push({
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-09-03T00:00:00.000Z'),
    id: TRIP,
    name: 'Kansai',
    ownerId: OWNER,
    partySize: 2,
    planningReadiness: 'READY',
    referenceTimeZone: 'Asia/Tokyo',
    referenceTimeZoneSource: 'DESTINATION',
    referenceTimeZoneSourcePlaceId: null,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });

  store.itineraryDay.push(
    day(DAYS[0], '2026-09-01', 'Arrival'),
    day(DAYS[1], '2026-09-02', 'Temples'),
    day(DAYS[2], '2026-09-03', 'Departure'),
  );

  store.itineraryItem.push({
    customLabel: 'Breakfast',
    id: 'item-breakfast',
    itineraryDayId: DAYS[1],
    localStartTime: new Date('1970-01-01T08:30:00.000Z'),
    position: 0,
    startInstant: new Date('2026-09-01T23:30:00.000Z'),
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Tokyo',
    tripId: TRIP,
  });
}

function seedAuthoritativeItem(itineraryDayId: string = DAYS[1]) {
  const item = {
    customLabel: 'Booked departure',
    id: `item-departure-${itineraryDayId}`,
    itineraryDayId,
    localStartTime: new Date('1970-01-01T18:00:00.000Z'),
    position: 1,
    startInstant: new Date('2026-09-02T09:00:00.000Z'),
    timeSemantics: 'AUTHORITATIVE_INSTANT',
    timeZone: 'Asia/Tokyo',
    tripId: TRIP,
  };
  store.itineraryItem.push(item);
  return item;
}

function dayShape() {
  return store.itineraryDay
    .map((row) => ({
      date: (row.date as Date).toISOString().slice(0, 10),
      id: row.id,
      name: row.name,
      notes: row.notes,
    }))
    .toSorted((left, right) => left.date.localeCompare(right.date));
}

async function reviewedUpdate(input: Parameters<typeof updateTrip>[3]) {
  try {
    return await updateTrip(OWNER, '', TRIP, input);
  } catch (error) {
    if (!(error instanceof TripDateShrinkConfirmationError)) throw error;
    return updateTrip(OWNER, '', TRIP, {
      ...input,
      confirmDateShrink: true,
      shrinkRevision: error.impact.revision,
      noteResolutions: error.impact.removedDays
        .filter((day) => day.notes?.trim())
        .map((day) => ({ dayId: day.id, action: 'discard' })),
    });
  }
}

test('a trip moved a week later takes its itinerary with it', async () => {
  seed();

  await reviewedUpdate({ endDate: '2026-09-10', startDate: '2026-09-08' });

  // The same three day rows, still carrying their names and notes, still in
  // order - not three replacements with the content stripped out.
  expect(dayShape()).toStrictEqual([
    { date: '2026-09-08', id: DAYS[0], name: 'Arrival', notes: 'notes for Arrival' },
    { date: '2026-09-09', id: DAYS[1], name: 'Temples', notes: 'notes for Temples' },
    { date: '2026-09-10', id: DAYS[2], name: 'Departure', notes: 'notes for Departure' },
  ]);
  expect(store.itineraryItem[0]?.itineraryDayId).toBe(DAYS[1]);
});

test('a move never asks to put anything in Unscheduled', async () => {
  seed();

  // No `confirmDateShrink`: nothing is being dropped, so nothing should ask.
  await reviewedUpdate({ endDate: '2026-10-03', startDate: '2026-10-01' });

  expect(store.itineraryItem[0]?.itineraryDayId).toBe(DAYS[1]);
  expect(store.itineraryDay.length).toBe(3);
});

test('a one-day shift does not collide with the day already on that date', async () => {
  seed();

  // The new range overlaps the old one everywhere but its ends, so every day
  // moves onto a date another day still holds. Rewriting them in the wrong
  // order breaks `@@unique([tripId, date])` partway through.
  await reviewedUpdate({ endDate: '2026-09-04', startDate: '2026-09-02' });

  expect(dayShape().map((row) => [row.id, row.date])).toStrictEqual([
    [DAYS[0], '2026-09-02'],
    [DAYS[1], '2026-09-03'],
    [DAYS[2], '2026-09-04'],
  ]);
});

test('a trip moved earlier collides just as readily, and does not', async () => {
  seed();

  await reviewedUpdate({ endDate: '2026-09-02', startDate: '2026-08-31' });

  expect(dayShape().map((row) => [row.id, row.date])).toStrictEqual([
    [DAYS[0], '2026-08-31'],
    [DAYS[1], '2026-09-01'],
    [DAYS[2], '2026-09-02'],
  ]);
});

test('a timed item keeps its local time and gets a new instant', async () => {
  seed();

  await reviewedUpdate({ endDate: '2026-09-10', startDate: '2026-09-08' });

  const item = store.itineraryItem[0]!;
  // 08:30 in Tokyo on the ninth, not the second: the wall clock the traveller
  // wrote down is unchanged, the instant behind it is not.
  expect((item.localStartTime as Date).toISOString().slice(11, 16)).toBe('08:30');
  expect((item.startInstant as Date).toISOString()).toBe('2026-09-08T23:30:00.000Z');
});

test('a move with a new trip reference zone uses that zone for inheriting floating times', async () => {
  seed();
  store.itineraryItem[0]!.timeZone = null;
  const departure = seedAuthoritativeItem();
  const originalDepartureInstant = departure.startInstant.toISOString();

  await reviewedUpdate({
    endDate: '2026-09-10',
    referenceTimeZone: 'America/New_York',
    startDate: '2026-09-08',
  });

  expect(store.itineraryItem[0]?.startInstant).toStrictEqual(new Date('2026-09-09T12:30:00.000Z'));
  expect(departure.startInstant.toISOString()).toBe(originalDepartureInstant);
  expect(departure.timeZone).toBe('Asia/Tokyo');
});

test.each([
  { endDate: '2026-09-10', label: 'move' },
  { endDate: '2026-09-12', label: 'move and extend' },
  { endDate: '2026-09-09', label: 'move and shorten' },
])('a $label preserves authoritative and supporting-record dates', async ({ endDate }) => {
  seed();
  const departure = seedAuthoritativeItem();
  const originalInstant = departure.startInstant.toISOString();
  const reservation = {
    flightDepartureInstant: new Date('2026-09-02T09:00:00.000Z'),
    id: 'reservation-flight',
    tripId: TRIP,
  };
  const expense = {
    id: 'expense-ticket',
    localDate: new Date('2026-09-02T00:00:00.000Z'),
    tripId: TRIP,
  };
  const memory = {
    capturedInstant: new Date('2026-09-02T11:00:00.000Z'),
    capturedLocalDate: new Date('2026-09-02T00:00:00.000Z'),
    id: 'memory-departure',
    tripId: TRIP,
  };
  store.reservation.push(reservation);
  store.expense.push(expense);
  store.memory.push(memory);

  await reviewedUpdate({
    confirmDateShrink: true,
    endDate,
    startDate: '2026-09-08',
  });

  expect(departure.startInstant.toISOString()).toBe(originalInstant);
  expect(departure.localStartTime.toISOString().slice(11, 16)).toBe('18:00');
  expect(store.itineraryItem[0]?.startInstant).toStrictEqual(new Date('2026-09-08T23:30:00.000Z'));
  expect(store.itineraryItem[0]?.localStartTime).toStrictEqual(
    new Date('1970-01-01T08:30:00.000Z'),
  );
  expect(reservation.flightDepartureInstant.toISOString()).toBe(originalInstant);
  expect(expense.localDate.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  expect(memory.capturedInstant.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  expect(memory.capturedLocalDate.toISOString()).toBe('2026-09-02T00:00:00.000Z');
});

test('an authoritative item on a removed tail day keeps its instant when unscheduled', async () => {
  seed();
  const departure = seedAuthoritativeItem(DAYS[2]);
  const originalInstant = departure.startInstant.toISOString();

  await reviewedUpdate({
    confirmDateShrink: true,
    endDate: '2026-09-09',
    startDate: '2026-09-08',
  });

  expect(departure.itineraryDayId).toBeNull();
  expect(departure.startInstant.toISOString()).toBe(originalInstant);
});

test('a daylight-saving gap rejects the move before changing days or instants', async () => {
  seed();
  // Auckland jumps from 02:00 to 03:00 on 27 September 2026, so 02:30 that day
  // never happens. The edit must fail without moving the trip.
  store.trip[0]!.referenceTimeZone = 'Pacific/Auckland';
  for (const row of store.itineraryDay) row.defaultTimeZone = 'Pacific/Auckland';
  store.itineraryItem[0]!.timeZone = 'Pacific/Auckland';
  store.itineraryItem[0]!.localStartTime = new Date('1970-01-01T02:30:00.000Z');
  const originalInstant = store.itineraryItem[0]!.startInstant;

  await expect(
    updateTrip(OWNER, '', TRIP, { endDate: '2026-09-28', startDate: '2026-09-26' }),
  ).rejects.toMatchObject({
    itemId: 'item-breakfast',
    itemLabel: 'Breakfast',
    localTime: '02:30',
    targetDate: '2026-09-27',
  } satisfies Partial<InstanceType<typeof TripDateMoveInvalidLocalTimeError>>);

  const skipped = store.itineraryItem[0]!;
  expect(skipped.startInstant).toStrictEqual(originalInstant);
  expect((skipped.localStartTime as Date).toISOString().slice(11, 16)).toBe('02:30');
  expect(dayShape().map((row) => row.date)).toStrictEqual([
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
  ]);
});

test('changing only the end date still resizes rather than moving', async () => {
  seed();

  await reviewedUpdate({ confirmDateShrink: true, endDate: '2026-09-02' });

  // Day one stays where it is and the dropped day's row is gone - the existing
  // behaviour, untouched.
  expect(dayShape().map((row) => [row.id, row.date])).toStrictEqual([
    [DAYS[0], '2026-09-01'],
    [DAYS[1], '2026-09-02'],
  ]);
});

test('a trip moved and lengthened in one edit keeps its plan and gains empty days', async () => {
  seed();

  // A week later and two days longer. Neither a pure move nor a pure resize -
  // the case that used to match neither and so emptied the whole itinerary.
  await reviewedUpdate({ endDate: '2026-09-12', startDate: '2026-09-08' });

  expect(dayShape().map((row) => [row.id, row.date, row.name])).toStrictEqual([
    [DAYS[0], '2026-09-08', 'Arrival'],
    [DAYS[1], '2026-09-09', 'Temples'],
    [DAYS[2], '2026-09-10', 'Departure'],
    // The two the trip gained, at its end, with nothing on them yet.
    [
      store.itineraryDay.find((row) => (row.date as Date).toISOString().startsWith('2026-09-11'))
        ?.id,
      '2026-09-11',
      undefined,
    ],
    [
      store.itineraryDay.find((row) => (row.date as Date).toISOString().startsWith('2026-09-12'))
        ?.id,
      '2026-09-12',
      undefined,
    ],
  ]);
  // Nothing was asked about and nothing was unscheduled.
  expect(store.itineraryItem[0]?.itineraryDayId).toBe(DAYS[1]);
});

test('a trip moved and shortened drops only its tail', async () => {
  seed();

  await reviewedUpdate({
    confirmDateShrink: true,
    endDate: '2026-09-09',
    startDate: '2026-09-08',
  });

  expect(dayShape().map((row) => [row.id, row.date])).toStrictEqual([
    [DAYS[0], '2026-09-08'],
    [DAYS[1], '2026-09-09'],
  ]);
  // Day two travelled with the trip, so the item it carries is still on it.
  expect(store.itineraryItem[0]?.itineraryDayId).toBe(DAYS[1]);
});

test('lengthening a moved trip never asks to unschedule anything', async () => {
  seed();

  // No `confirmDateShrink`. Nothing is being dropped, so nothing should ask -
  // this call throwing is the regression being guarded against.
  await expect(
    updateTrip(OWNER, '', TRIP, { endDate: '2026-09-12', startDate: '2026-09-08' }),
  ).resolves.toBeDefined();
});
