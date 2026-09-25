import { beforeEach, expect, test } from 'vitest';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';
installFakePrismaClient();
const { updateTrip, getTrip, TripDateShrinkConfirmationError } =
  await import('../src/services/trips.js');
const { updateDatedExperienceRating } = await import('../src/services/itineraries.js');
const { listMemories } = await import('../src/services/memories.js');

beforeEach(() => {
  resetStore();
  store.trip.push({
    id: 'trip',
    ownerId: 'owner',
    name: 'Review',
    startDate: new Date('2026-09-01'),
    endDate: new Date('2026-09-03'),
    referenceTimeZone: 'Asia/Singapore',
    referenceTimeZoneSource: 'COUNTRY',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  });
  for (let index = 1; index <= 3; index++)
    store.itineraryDay.push({
      id: `day-${index}`,
      tripId: 'trip',
      date: new Date(`2026-09-0${index}`),
      name: null,
      notes: null,
      defaultTimeZone: 'Asia/Singapore',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
      dailyBaseTripPlaceId: null,
      dailyBaseDepartureTripPlaceId: null,
      updatedAt: new Date('2026-08-01'),
    });
});
const input = { endDate: '2026-09-01' };
async function review(change: Parameters<typeof updateTrip>[3] = input) {
  try {
    await updateTrip('owner', '', 'trip', change);
  } catch (error) {
    if (error instanceof TripDateShrinkConfirmationError) return error.impact;
    throw error;
  }
  throw new Error('Expected a shrink review');
}

test('note-only shrink requires an explicit resolution; cancel is mutation-free', async () => {
  store.itineraryDay[2]!.notes = 'Last day';
  const before = structuredClone(store);
  const impact = await review();
  expect(store).toStrictEqual(before);
  await expect(
    updateTrip('owner', '', 'trip', { ...input, confirmDateShrink: true }),
  ).rejects.toBeInstanceOf(TripDateShrinkConfirmationError);
  await expect(
    updateTrip('owner', '', 'trip', {
      ...input,
      confirmDateShrink: true,
      shrinkRevision: impact.revision,
    }),
  ).rejects.toMatchObject({ code: 'note_resolution_required' });
  expect(store).toStrictEqual(before);
});

test('append preserves target text and orders source notes by original date, once', async () => {
  store.itineraryDay[0]!.notes = 'Existing';
  store.itineraryDay[1]!.notes = 'Second';
  store.itineraryDay[2]!.notes = 'Third';
  const impact = await review();
  const confirmed = {
    ...input,
    confirmDateShrink: true,
    shrinkRevision: impact.revision,
    noteResolutions: [
      { dayId: 'day-3', action: 'append' as const, targetDayId: 'day-1' },
      { dayId: 'day-2', action: 'append' as const, targetDayId: 'day-1' },
    ],
  };
  await updateTrip('owner', '', 'trip', confirmed);
  await updateTrip('owner', '', 'trip', confirmed);
  expect(store.itineraryDay[0]!.notes).toBe('Existing\n\nSecond\n\nThird');
  expect(store.itineraryDay).toHaveLength(1);
});

test.each(['foreign-day', 'day-2'])(
  'rejects non-retained note destination %s atomically',
  async (targetDayId) => {
    store.itineraryDay[1]!.notes = 'Keep me';
    const impact = await review();
    const before = structuredClone(store);
    await expect(
      updateTrip('owner', '', 'trip', {
        ...input,
        confirmDateShrink: true,
        shrinkRevision: impact.revision,
        noteResolutions: [{ dayId: 'day-2', action: 'append', targetDayId }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_note_resolution' });
    expect(store).toStrictEqual(before);
  },
);

test('stale review cannot discard an edited note and a refreshed review can explicitly discard', async () => {
  store.itineraryDay[2]!.notes = 'Before';
  const impact = await review();
  store.itineraryDay[2]!.notes = 'New content';
  await expect(
    updateTrip('owner', '', 'trip', {
      ...input,
      confirmDateShrink: true,
      shrinkRevision: impact.revision,
      noteResolutions: [{ dayId: 'day-3', action: 'discard' }],
    }),
  ).rejects.toBeInstanceOf(TripDateShrinkConfirmationError);
  const fresh = await review();
  expect(fresh.removedDays.find((day) => day.id === 'day-3')?.notes).toBe('New content');
  await updateTrip('owner', '', 'trip', {
    ...input,
    confirmDateShrink: true,
    shrinkRevision: fresh.revision,
    noteResolutions: [{ dayId: 'day-3', action: 'discard' }],
  });
  expect(store.itineraryDay).toHaveLength(1);
});

test('oversized merge and duplicate resolutions never truncate or change notes', async () => {
  store.itineraryDay[0]!.notes = 'x'.repeat(5_000);
  store.itineraryDay[2]!.notes = 'Keep';
  const impact = await review();
  await expect(
    updateTrip('owner', '', 'trip', {
      ...input,
      confirmDateShrink: true,
      shrinkRevision: impact.revision,
      noteResolutions: [{ dayId: 'day-3', action: 'append', targetDayId: 'day-1' }],
    }),
  ).rejects.toMatchObject({ code: 'reassigned_notes_too_long' });
  await expect(
    updateTrip('owner', '', 'trip', {
      ...input,
      confirmDateShrink: true,
      shrinkRevision: impact.revision,
      noteResolutions: [
        { dayId: 'day-3', action: 'discard' },
        { dayId: 'day-3', action: 'discard' },
      ],
    }),
  ).rejects.toMatchObject({ code: 'invalid_note_resolution' });
  expect(store.itineraryDay[0]!.notes).toHaveLength(5_000);
  expect(store.itineraryDay[2]!.notes).toBe('Keep');
});

test('rating-only and base-only days appear in impact and remain independent of planning', async () => {
  await updateDatedExperienceRating('owner', 'trip', '2026-09-03', 4, 'A good day');
  expect(await getTrip('owner', '', 'trip')).toMatchObject({
    memoryCount: 0,
    hasStoryContent: true,
  });
  store.itineraryDay[1]!.dailyBaseTripPlaceId = 'base';
  const impact = await review();
  expect(impact.removedDays.map((day) => [day.bases, day.rating])).toStrictEqual([
    [1, null],
    [0, 4],
  ]);
  await updateTrip('owner', '', 'trip', {
    ...input,
    confirmDateShrink: true,
    shrinkRevision: impact.revision,
  });
  expect(store.dayExperience[0]!.date).toStrictEqual(new Date('2026-09-03'));
  await updateDatedExperienceRating('owner', 'trip', '2026-09-03', null, undefined);
  const history = await listMemories('owner', 'trip', null);
  expect(history.dayExperiences).toStrictEqual([
    { date: '2026-09-03', rating: null, note: 'A good day' },
  ]);
  await updateTrip('owner', '', 'trip', { startDate: '2026-09-08', endDate: '2026-09-10' });
  expect(store.dayExperience[0]!.date).toStrictEqual(new Date('2026-09-03'));
  await updateTrip('owner', '', 'trip', { startDate: '2026-09-01', endDate: '2026-09-03' });
  expect(store.dayExperience).toHaveLength(1);
});

test('mixed impact counts linked records without double-counting and preserves dates', async () => {
  store.itineraryItem.push({ id: 'item', tripId: 'trip', itineraryDayId: 'day-3', position: 0 });
  for (const name of ['task', 'expense', 'memory'] as const)
    store[name].push({
      id: name,
      tripId: 'trip',
      itineraryDayId: 'day-3',
      itineraryItemId: 'item',
      localDate: new Date('2026-09-03'),
      capturedInstant: new Date('2026-09-03T04:00Z'),
    });
  store.reservation.push({
    id: 'booking',
    tripId: 'trip',
    itineraryItemId: 'item',
    accommodationDays: [{ itineraryDayId: 'day-3' }],
  });
  const impact = await review();
  expect(impact.removedDays[1]).toMatchObject({
    items: 1,
    tasks: 1,
    expenses: 1,
    memories: 1,
    reservations: 1,
  });
  await updateTrip('owner', '', 'trip', {
    ...input,
    confirmDateShrink: true,
    shrinkRevision: impact.revision,
  });
  for (const name of ['task', 'expense', 'memory'] as const)
    expect(store[name][0]).toMatchObject({
      itineraryDayId: null,
      localDate: new Date('2026-09-03'),
      capturedInstant: new Date('2026-09-03T04:00Z'),
    });
  expect(store.itineraryItem[0]!.itineraryDayId).toBeNull();
});

test('dated ratings enforce trip ownership and do not create arbitrary historical days', async () => {
  await expect(updateDatedExperienceRating('other', 'trip', '2026-09-01', 5, null)).rejects.toThrow(
    'trip_not_found',
  );
  await expect(updateDatedExperienceRating('owner', 'trip', '2020-01-01', 5, null)).rejects.toThrow(
    'itinerary_day_not_found',
  );
  await expect(updateTrip('other', '', 'trip', input)).rejects.toThrow('trip_not_found');
  expect(store.dayExperience).toHaveLength(0);
});

test('move-and-shorten appends by original date while ratings remain dated, including a later shrink', async () => {
  store.itineraryDay[0]!.notes = 'First';
  store.itineraryDay[1]!.notes = 'Second';
  store.itineraryDay[2]!.notes = 'Third';
  await updateDatedExperienceRating('owner', 'trip', '2026-09-03', 5, 'Remember');
  const change = { startDate: '2026-09-08', endDate: '2026-09-09' };
  const impact = await review(change);
  expect(impact.retainedDays[1]!.date).toBe('2026-09-09');
  await updateTrip('owner', '', 'trip', {
    ...change,
    confirmDateShrink: true,
    shrinkRevision: impact.revision,
    noteResolutions: [{ dayId: 'day-3', action: 'append', targetDayId: 'day-2' }],
  });
  expect(store.itineraryDay.find((day) => day.id === 'day-2')!.notes).toBe('Second\n\nThird');
  const shorter = { endDate: '2026-09-08' };
  const next = await review(shorter);
  await updateTrip('owner', '', 'trip', {
    ...shorter,
    confirmDateShrink: true,
    shrinkRevision: next.revision,
    noteResolutions: [{ dayId: 'day-2', action: 'append', targetDayId: 'day-1' }],
  });
  expect(store.itineraryDay[0]!.notes).toBe('First\n\nSecond\n\nThird');
  expect(store.dayExperience[0]!.date).toStrictEqual(new Date('2026-09-03'));
});

test('a DST gap after shrink review rolls back notes, days and dated reflections', async () => {
  store.trip[0]!.referenceTimeZone = 'Pacific/Auckland';
  for (const day of store.itineraryDay) day.defaultTimeZone = 'Pacific/Auckland';
  store.itineraryDay[2]!.notes = 'Keep';
  store.itineraryItem.push({
    id: 'gap',
    tripId: 'trip',
    itineraryDayId: 'day-1',
    customLabel: 'Breakfast',
    position: 0,
    localStartTime: new Date('1970-01-01T02:30:00Z'),
    startInstant: new Date('2026-08-31T14:30:00Z'),
    timeZone: 'Pacific/Auckland',
    timeSemantics: 'FLOATING_LOCAL',
  });
  await updateDatedExperienceRating('owner', 'trip', '2026-09-03', 4, 'History');
  const change = { startDate: '2026-09-27', endDate: '2026-09-27' };
  const impact = await review(change);
  const before = structuredClone(store);
  await expect(
    updateTrip('owner', '', 'trip', {
      ...change,
      confirmDateShrink: true,
      shrinkRevision: impact.revision,
      noteResolutions: [{ dayId: 'day-3', action: 'append', targetDayId: 'day-1' }],
    }),
  ).rejects.toMatchObject({ itemId: 'gap', targetDate: '2026-09-27', localTime: '02:30' });
  expect(store).toStrictEqual(before);
});
