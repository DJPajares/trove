import { expect, test } from 'vitest';

import {
  copiedPlace,
  copyCredit,
  planTripCopy,
  type SharedTripSource,
} from '../src/services/trip-copies.js';
import { tripCopyCredit } from '../src/services/trip-rules.js';

/**
 * Saving a copy of a shared trip (PRD 8.1). What these guard is the boundary:
 * the copy gets the plan the link shows and nothing the owner kept private, and
 * it always credits whoever first made the trip.
 */

const NOW = new Date('2026-11-12T00:00:00.000Z');
const OWNER = 'owner-1';

const googlePlace = {
  customName: null,
  customTimeZone: null,
  id: 'google-museum',
  kind: 'PROVIDER' as const,
  ownerId: null,
};
const ownersPlace = {
  customName: "Aunt Mei's flat",
  customTimeZone: 'Asia/Tokyo',
  id: 'owners-private-place',
  kind: 'CUSTOM' as const,
  ownerId: OWNER,
};

function item(overrides: Partial<SharedTripSource['itineraryDays'][number]['items'][number]> = {}) {
  return {
    blockType: null,
    customLabel: null,
    customLocation: null,
    customLocationTimeZone: null,
    dayPart: null,
    durationMinutes: 90,
    durationProvenance: 'USER_OWNED' as const,
    id: 'item-1',
    localEndTime: null,
    localStartTime: null,
    notes: null,
    startInstant: null,
    timeProvenance: null,
    timeZone: null,
    timeZoneSource: null,
    timingFlexibility: null,
    travelModeToNext: 'WALK' as const,
    tripPlace: null,
    ...overrides,
  };
}

function source(overrides: Partial<SharedTripSource> = {}): SharedTripSource {
  return {
    countries: ['JP'],
    creator: { displayName: 'Ana' },
    creatorId: OWNER,
    description: 'Cherry blossom season.',
    destinations: [
      { place: { ...ownersPlace, customName: 'Kyoto', id: 'kyoto' }, timeZone: 'Asia/Tokyo' },
    ],
    endDate: new Date('2026-04-02T00:00:00.000Z'),
    id: 'original-trip',
    itineraryDays: [
      {
        date: new Date('2026-04-01T00:00:00.000Z'),
        defaultTimeZone: 'Asia/Tokyo',
        defaultTimeZoneSource: 'FIRST_LOCATED_ITEM',
        defaultTimeZoneSourceItemId: 'museum',
        items: [
          item({
            id: 'museum',
            localStartTime: new Date(Date.UTC(1970, 0, 1, 10, 30)),
            notes: 'Book ahead.',
            startInstant: new Date('2026-04-01T01:30:00.000Z'),
            timeProvenance: 'USER_OWNED',
            timeZone: 'Asia/Tokyo',
            timeZoneSource: 'PLACE',
            tripPlace: { customName: null, place: googlePlace },
          }),
          item({
            dayPart: 'EVENING',
            id: 'dinner',
            timeZone: 'Asia/Tokyo',
            timeZoneSource: 'PLACE',
            tripPlace: { customName: 'Dinner at Mei’s', place: ownersPlace },
          }),
        ],
        name: 'Arrival',
        notes: 'Drop bags first.',
        routeStartTravelMode: 'TRANSIT',
      },
      {
        date: new Date('2026-04-02T00:00:00.000Z'),
        defaultTimeZone: 'Asia/Tokyo',
        defaultTimeZoneSource: 'EXPLICIT_DAILY_BASE',
        defaultTimeZoneSourceItemId: null,
        items: [],
        name: null,
        notes: null,
        routeStartTravelMode: 'DRIVE',
      },
    ],
    name: 'Kyoto in spring',
    ownerId: OWNER,
    referenceTimeZone: 'Asia/Tokyo',
    referenceTimeZoneSource: 'DESTINATION',
    referenceTimeZoneSourcePlaceId: 'kyoto',
    sourceAttribution: null,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('days keep their order and length, shifted to the new start', () => {
  const plan = planTripCopy(source(), { name: 'My Kyoto', startDate: '2027-03-30' }, NOW);

  expect(plan.trip.name).toBe('My Kyoto');
  expect(plan.trip.startDate.toISOString().slice(0, 10)).toBe('2027-03-30');
  expect(plan.trip.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
  expect(plan.days.map((day) => day.date.toISOString().slice(0, 10))).toEqual([
    '2027-03-30',
    '2027-03-31',
  ]);
  expect(plan.days[0]).toMatchObject({ name: 'Arrival', notes: 'Drop bags first.' });
});

test('a timed stop keeps its clock time, with the instant worked out for the new date', () => {
  const plan = planTripCopy(source(), { name: 'Kyoto', startDate: '2027-03-30' }, NOW);
  const museum = plan.days[0]!.items[0]!.data;

  expect(museum.localStartTime).toEqual(new Date(Date.UTC(1970, 0, 1, 10, 30)));
  expect(museum.timeSemantics).toBe('FLOATING_LOCAL');
  // 10:30 in Tokyo on the new date, not the original's instant.
  expect(museum.startInstant).toEqual(new Date('2027-03-30T01:30:00.000Z'));
  expect(museum.notes).toBe('Book ahead.');
});

test('a Google Place is reused; the owner’s own Place never is', () => {
  const plan = planTripCopy(source(), { name: 'Kyoto', startDate: '2026-04-01' }, NOW);
  const [museum, dinner] = plan.days[0]!.items;

  expect(museum!.place).toEqual({ kind: 'shared', placeId: 'google-museum' });
  // The copier gets a Place of their own, named as the link names it, keeping
  // only its time zone - never the owner's row, coordinates or note.
  expect(dinner!.place).toEqual({
    kind: 'custom',
    name: 'Dinner at Mei’s',
    timeZone: 'Asia/Tokyo',
  });
  expect(JSON.stringify(plan)).not.toContain('owners-private-place');
});

test('nothing private crosses over', () => {
  const plan = planTripCopy(source(), { name: 'Kyoto', startDate: '2026-04-01' }, NOW);
  const serialized = JSON.stringify(plan);

  for (const field of [
    'priority',
    'plannedCost',
    'travelStatus',
    'dailyBaseTripPlaceId',
    'coverPhotoPath',
    'planningPreferences',
    'visibility',
    'customNote',
    'customLatitude',
  ]) {
    expect(serialized, `a copy must not carry ${field}`).not.toContain(field);
  }
});

test('a day zone owed to a base becomes a plain value; one owed to a stop follows the copy', () => {
  const plan = planTripCopy(source(), { name: 'Kyoto', startDate: '2026-04-01' }, NOW);

  expect(plan.days[0]!.firstLocatedIndex).toBe(0);
  expect(plan.days[1]).toMatchObject({ defaultTimeZone: 'Asia/Tokyo', firstLocatedIndex: null });
});

test('the trip keeps its time zone rather than taking the copier’s', () => {
  const plan = planTripCopy(
    source({ referenceTimeZoneSource: 'PROFILE_HOME', referenceTimeZoneSourcePlaceId: null }),
    { name: 'Kyoto', startDate: '2026-04-01' },
    NOW,
  );

  expect(plan.trip).toMatchObject({
    referenceTimeZone: 'Asia/Tokyo',
    referenceTimeZoneSource: 'EXPLICIT',
    referenceTimeZoneSourceDestination: null,
  });
});

test('a copy credits the creator, by the name they have when it is saved', () => {
  expect(copyCredit(source())).toEqual({ creatorId: OWNER, name: 'Ana' });
  expect(copyCredit(source({ creator: { displayName: null } }))).toEqual({
    creatorId: OWNER,
    name: null,
  });
});

test('a copy of a copy still credits the first creator', () => {
  const copy = source({
    creator: { displayName: 'Ana' },
    creatorId: 'ana',
    ownerId: 'ben',
    sourceAttribution: 'Ana',
  });
  expect(copyCredit(copy)).toEqual({ creatorId: 'ana', name: 'Ana' });

  // Ana has since left Trove: her name as recorded still stands, and the
  // credit never passes to Ben for sharing it on.
  expect(copyCredit({ ...copy, creator: null, creatorId: null })).toEqual({
    creatorId: null,
    name: 'Ana',
  });
});

test('a trip is known as a copy by any trace of where it came from', () => {
  const original = { creatorId: 'a', ownerId: 'a', sourceAttribution: null, sourceTripId: null };
  expect(tripCopyCredit(original)).toBeNull();
  expect(tripCopyCredit({ ...original, sourceTripId: 'x' })).toEqual({ creatorName: null });
  // The original is gone, but the recorded name keeps the credit.
  expect(tripCopyCredit({ ...original, creatorId: null, sourceAttribution: 'Ana' })).toEqual({
    creatorName: 'Ana',
  });
  expect(tripCopyCredit({ ...original, ownerId: 'b' })).toEqual({ creatorName: null });
});

test('a Place with nothing to call it is left behind rather than linked', () => {
  expect(copiedPlace({ ...ownersPlace, customName: '  ' }, null)).toBeNull();
});
