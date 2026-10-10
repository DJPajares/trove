import { expect, test } from 'vitest';

import {
  acceptSuggestedSlot,
  manualTimingPatch,
  buildStopInput,
  durationMinutesFromParts,
  durationParts,
  filterItineraryTripPlaces,
  itineraryIdentityChoice,
  itineraryIdentityLegacyPatch,
  itineraryProviderSuggestions,
  stopEditorCustomDuration,
  stopEditorForm,
  stopTimingInput,
} from '../lib/itinerary/item-editor.ts';
import { formatItineraryTimeRange, itineraryLocalEndTime } from '../lib/itinerary/item-timing.ts';
import type { ProviderSuggestion } from '../lib/saved/api.ts';

test('local Trip Place filtering has no arbitrary result cap', () => {
  const places = Array.from({ length: 12 }, (_, index) => ({
    address: index % 2 ? 'Rotorua' : 'Auckland',
    name: `Place ${index + 1}`,
  }));

  expect(filterItineraryTripPlaces(places, '', (place) => [place.name, place.address]).length).toBe(
    12,
  );
  expect(
    filterItineraryTripPlaces(places, 'rotorua', (place) => [place.name, place.address]).length,
  ).toBe(6);
});

test('provider suggestions exclude existing Trip Places and stop at three', () => {
  const suggestions = Array.from({ length: 6 }, (_, index) => ({
    category: 'other' as const,
    description: null,
    externalPlaceId: `google-${index + 1}`,
    name: `Google Place ${index + 1}`,
    provider: 'google' as const,
  })) satisfies ProviderSuggestion[];

  expect(
    itineraryProviderSuggestions(suggestions, new Set(['google-1'])).map(
      (suggestion) => suggestion.externalPlaceId,
    ),
  ).toStrictEqual(['google-2', 'google-3', 'google-4']);
});

test('a new identity is mutually exclusive while a legacy identity is preserved until changed', () => {
  const legacy = { customLabel: 'Lunch with Maya', tripPlaceId: 'trip-place-1' };

  expect(itineraryIdentityChoice(legacy, { kind: 'preserve' })).toBe(legacy);
  expect(
    itineraryIdentityChoice(legacy, { kind: 'trip_place', tripPlaceId: 'trip-place-2' }),
  ).toStrictEqual({ customLabel: '', tripPlaceId: 'trip-place-2' });
  expect(
    itineraryIdentityChoice(legacy, { kind: 'custom_label', label: '  Sunset walk  ' }),
  ).toStrictEqual({ customLabel: 'Sunset walk', tripPlaceId: '' });
});

test('ordinary edits preserve hidden legacy fields while identity changes clear only overrides', () => {
  expect(itineraryIdentityLegacyPatch(false)).toStrictEqual({});
  expect(itineraryIdentityLegacyPatch(true)).toStrictEqual({
    customLocation: null,
    priority: null,
  });
  expect('plannedCost' in itineraryIdentityLegacyPatch(true)).toBe(false);
});

test('duration conversion supports presets and custom hours and minutes', () => {
  expect(durationParts('90')).toStrictEqual({ hours: '1', minutes: '30' });
  expect(durationParts('')).toStrictEqual({ hours: '', minutes: '' });
  expect(durationMinutesFromParts({ hours: '2', minutes: '15' })).toBe('135');
  expect(durationMinutesFromParts({ hours: '', minutes: '45' })).toBe('45');
  expect(durationMinutesFromParts({ hours: '1', minutes: '60' })).toBe('');
  expect(durationMinutesFromParts({ hours: '0', minutes: '0' })).toBe('');
});

test('formats an explicit itinerary end ahead of its derived duration', () => {
  const item = { durationMinutes: 90, localEndTime: '10:20', localStartTime: '09:00' };

  expect(itineraryLocalEndTime(item)).toBe('10:20');
  expect(formatItineraryTimeRange(item, 'en-US', '12h')).toBe('9:00 AM - 10:20 AM');
});

test('derives and formats the end of a duration while preserving start-only items', () => {
  expect(
    formatItineraryTimeRange(
      { durationMinutes: 90, localEndTime: null, localStartTime: '09:00' },
      'en-GB',
      '24h',
    ),
  ).toBe('9:00 - 10:30');
  expect(
    itineraryLocalEndTime({ durationMinutes: 90, localEndTime: null, localStartTime: '23:30' }),
  ).toBe('01:00');
  expect(
    formatItineraryTimeRange(
      { durationMinutes: null, localEndTime: null, localStartTime: '09:00' },
      'en-GB',
      '24h',
    ),
  ).toBe('9:00');
});

const blankCustom = { hours: '', minutes: '', open: false };

test('a stop opens in the editor with its own timing, or empty at the Place it was asked for', () => {
  expect(stopEditorForm(null, 'temple')).toMatchObject({
    schedule: 'none',
    timingMode: 'duration',
    tripPlaceId: 'temple',
  });
  const timed = stopEditorForm({
    customLabel: null,
    dayPart: null,
    durationMinutes: 150,
    localEndTime: '11:30',
    localStartTime: '09:00',
    notes: 'Tickets at the gate',
    tripPlace: { id: 'museum' },
  });
  expect(timed).toMatchObject({
    durationMinutes: '',
    exactTime: '09:00',
    localEndTime: '11:30',
    schedule: 'exact',
    timingMode: 'end_time',
    tripPlaceId: 'museum',
  });
  expect(
    stopEditorCustomDuration({ ...timed, durationMinutes: '75', timingMode: 'duration' }),
  ).toStrictEqual({ hours: '1', minutes: '15', open: true });
  expect(
    stopEditorCustomDuration({ ...timed, durationMinutes: '60', timingMode: 'duration' }).open,
  ).toBe(false);
});

test('a stop is saved only once it says what and when well enough', () => {
  const form = stopEditorForm(null);

  expect(buildStopInput(form, blankCustom)).toStrictEqual({ error: 'minimumContentError' });
  expect(
    buildStopInput({ ...form, customLabel: 'Lunch', schedule: 'exact' }, blankCustom),
  ).toStrictEqual({ error: 'exactTimeError' });
  expect(
    buildStopInput({ ...form, customLabel: 'Lunch' }, { hours: '0', minutes: '0', open: true }),
  ).toStrictEqual({ error: 'durationError' });
  expect(
    buildStopInput(
      { ...form, customLabel: 'Lunch', localEndTime: '13:00', timingMode: 'end_time' },
      blankCustom,
    ),
  ).toStrictEqual({ error: 'endTimeStartRequired' });
  expect(
    buildStopInput(
      {
        ...form,
        customLabel: 'Lunch',
        exactTime: '13:00',
        localEndTime: '12:00',
        schedule: 'exact',
        timingMode: 'end_time',
      },
      blankCustom,
    ),
  ).toStrictEqual({ error: 'endTimeError' });

  expect(
    buildStopInput(
      { ...form, durationMinutes: '90', schedule: 'afternoon', tripPlaceId: 'museum' },
      blankCustom,
    ),
  ).toStrictEqual({
    input: {
      customLabel: null,
      durationMinutes: 90,
      localEndTime: null,
      notes: null,
      schedule: { dayPart: 'afternoon', kind: 'day_part' },
      tripPlaceId: 'museum',
    },
  });
});

test('an edit to a different stop drops what the old editor wrote; an ordinary edit keeps it', () => {
  const form = { ...stopEditorForm(null), customLabel: 'Lunch' };
  const changed = buildStopInput(form, blankCustom, { identityChanged: true });
  const same = buildStopInput(form, blankCustom, { identityChanged: false });

  expect('input' in changed && changed.input).toMatchObject({
    customLocation: null,
    priority: null,
  });
  expect('input' in same && 'priority' in same.input).toBe(false);
});

test('the timing sheet saves only timing', () => {
  expect(
    stopTimingInput({
      customLabel: 'Lunch',
      durationMinutes: 45,
      notes: 'kept as is',
      schedule: { kind: 'exact', localTime: '12:00' },
      tripPlaceId: 'cafe',
    }),
  ).toStrictEqual({
    durationMinutes: 45,
    localEndTime: null,
    schedule: { kind: 'exact', localTime: '12:00' },
  });
});

test('accepting a slot retains estimated evidence and manual changes invalidate its revision', () => {
  const initial = { ...stopEditorForm(null), schedule: 'morning' as const };
  const accepted = acceptSuggestedSlot(
    initial,
    {
      itemId: 'candidate',
      status: 'ok',
      localTime: '10:30',
      localEndTime: '12:00',
      durationMinutes: 90,
      durationProvenance: 'app_estimated',
      timeZone: 'Asia/Singapore',
      reasons: [],
      caveats: [],
    },
    'revision',
  );
  expect(accepted).toMatchObject({
    exactTime: '10:30',
    durationMinutes: '90',
    timingFlexibility: 'flexible',
    timeProvenance: 'app_estimated',
    durationProvenance: 'app_estimated',
    dayPartIntent: 'morning',
    scheduleRevision: 'revision',
  });
  const edited = manualTimingPatch(accepted, { exactTime: '10:45' });
  expect(edited).toMatchObject({
    timingFlexibility: 'fixed',
    timeProvenance: 'user_owned',
    durationProvenance: 'app_estimated',
    scheduleRevision: undefined,
  });
  expect(manualTimingPatch(accepted, { durationMinutes: '120' })).toMatchObject({
    durationProvenance: 'user_owned',
    scheduleRevision: undefined,
  });
});

test('duration ends render across a daylight-saving jump using the stored instant', () => {
  expect(
    itineraryLocalEndTime({
      localStartTime: '01:30',
      durationMinutes: 60,
      startInstant: '2026-03-08T06:30:00Z',
      timeZone: 'America/New_York',
    }),
  ).toBe('03:30');
});
