import { expect, test } from 'vitest';

import type { Itinerary, ItineraryTripPlace } from '../lib/itinerary/api.ts';
import { stopTitleInput } from '../lib/itinerary/item-editor.ts';
import { resolveItineraryItemPlaceName } from '../lib/trip-places/place-name.ts';
import { applyOfflineMutation } from '../lib/offline/trip-store.ts';

function itinerary(): Itinerary {
  return {
    days: [
      {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
        date: '2026-09-05',
        defaultTimeZone: 'Pacific/Auckland',
        defaultTimeZoneSource: 'trip_reference',
        defaultTimeZoneSourceTripPlaceId: null,
        experienceNote: null,
        experienceRating: null,
        id: 'day',
        items: [],
        name: null,
        notes: null,
        routeStartTravelMode: 'drive',
      },
    ],
    trip: {
      endDate: '2026-09-05',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Pacific/Auckland',
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems: [],
  };
}

test('offline title edits preserve linked identity, timing and notes, and can restore the place name', () => {
  const original = itinerary();
  const linked = {
    id: 'trip-place',
    customName: null,
    note: null,
    priority: null,
    place: {
      id: 'canonical-place',
      kind: 'provider',
      name: null,
      providerLabel: 'Museum',
      providerAddress: 'Tokyo, Japan',
      providerRefs: [{ provider: 'google', externalPlaceId: 'google-museum' }],
      snapshot: null,
    },
  } as ItineraryTripPlace;
  original.tripPlaces = [linked];
  const created = applyOfflineMutation(original, {
    clientItemId: 'museum',
    kind: 'itinerary_item_create',
    input: {
      tripPlaceId: linked.id,
      itineraryDayId: 'day',
      durationMinutes: 90,
      notes: 'Meet by the door',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
  });
  const baseItem = created.days[0]!.items[0]!;
  const patch = stopTitleInput('Our museum morning', 'Museum');
  if (!patch.input) throw new Error('Expected a title patch');
  const renamed = applyOfflineMutation(created, {
    baseItem,
    input: patch.input,
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });
  const updated = renamed.days[0]!.items[0]!;
  expect(updated).toEqual({
    ...baseItem,
    customLabel: 'Our museum morning',
    updatedAt: updated.updatedAt,
  });
  expect(renamed.tripPlaces).toEqual(original.tripPlaces);
  expect(resolveItineraryItemPlaceName(updated, 'Fallback')).toBe('Our museum morning');
  const restored = applyOfflineMutation(renamed, {
    baseItem: updated,
    input: { customLabel: null },
    itemId: updated.id,
    kind: 'itinerary_item_update',
  });
  expect(resolveItineraryItemPlaceName(restored.days[0]!.items[0]!, 'Fallback')).toBe('Museum');
});

test('offline creation keeps an explicit end and derives its effective duration', () => {
  const result = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      blockType: 'activity',
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
    blockType: 'activity',
    durationMinutes: 90,
    localEndTime: '10:30',
    localStartTime: '09:00',
  });
});

test('offline retiming preserves the explicit end and recalculates its duration', () => {
  const created = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      blockType: 'work',
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });
  const baseItem = created.days[0]!.items[0]!;

  const result = applyOfflineMutation(created, {
    baseItem,
    input: { schedule: { kind: 'exact', localTime: '09:30' } },
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
    blockType: 'work',
    durationMinutes: 60,
    localEndTime: '10:30',
    localStartTime: '09:30',
  });
});

test('offline duration selection clears an existing explicit end time', () => {
  const created = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });
  const baseItem = created.days[0]!.items[0]!;

  const result = applyOfflineMutation(created, {
    baseItem,
    input: { durationMinutes: 45, localEndTime: null },
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });

  expect(result.days[0]?.items[0]).toMatchObject({ durationMinutes: 45, localEndTime: null });
});

test.each(['reconcile_flexible', 'review_flexible'] as const)(
  'queued %s inserts and moves preserve position, flexibility and daypart intent',
  (timingPolicy) => {
    const original = applyOfflineMutation(itinerary(), {
      clientItemId: 'first',
      kind: 'itinerary_item_create',
      input: {
        customLabel: 'First',
        itineraryDayId: 'day',
        durationMinutes: 60,
        schedule: { kind: 'exact', localTime: '09:00' },
      },
    });
    const inserted = applyOfflineMutation(original, {
      clientItemId: 'new',
      kind: 'itinerary_item_create',
      input: {
        customLabel: 'New',
        itineraryDayId: 'day',
        position: 0,
        durationMinutes: 90,
        schedule: { kind: 'exact', localTime: '14:00', dayPart: 'afternoon' },
        timingPolicy,
        timingFlexibility: 'flexible',
        timeProvenance: 'app_estimated',
        durationProvenance: 'app_estimated',
      },
    });
    expect(inserted.days[0]!.items.map((item) => item.id)).toEqual(['new', 'first']);
    expect(inserted.days[0]!.items[0]).toMatchObject({
      dayPart: 'afternoon',
      timingFlexibility: 'flexible',
      timeProvenance: 'app_estimated',
      durationProvenance: 'app_estimated',
    });
    const moved = applyOfflineMutation(inserted, {
      baseItem: inserted.days[0]!.items[1]!,
      kind: 'itinerary_item_organize',
      itemId: 'first',
      input: { itineraryDayId: 'day', position: 0, timingPolicy },
    });
    expect(moved.days[0]!.items.map((item) => item.id)).toEqual(['first', 'new']);
  },
);

test('offline explicit ends retain elapsed duration across daylight saving', () => {
  const snapshot = itinerary();
  snapshot.days[0]!.date = '2026-03-08';
  snapshot.days[0]!.defaultTimeZone = 'America/New_York';
  const created = applyOfflineMutation(snapshot, {
    clientItemId: 'dst',
    kind: 'itinerary_item_create',
    input: {
      customLabel: 'Early visit',
      itineraryDayId: 'day',
      localEndTime: '03:30',
      schedule: { kind: 'exact', localTime: '01:30' },
      timingPolicy: 'reconcile_flexible',
    },
  });
  expect(created.days[0]!.items[0]).toMatchObject({
    durationMinutes: 60,
    localEndTime: '03:30',
    localStartTime: '01:30',
  });
});
