import { expect, test } from 'vitest';

import type { ItineraryDay, ItineraryItem, ItineraryTripPlace } from '../lib/itinerary/api.ts';
import { dayTown } from '../lib/itinerary/day-place.ts';
import type { Memory, MemoryTripPlace } from '../lib/memories/api.ts';
import {
  buildJournal,
  HIGHLIGHTS_LENS,
  journalDays,
  journalLensOptions,
  type JournalTrip,
  UNPLACED_LENS,
} from '../lib/memories/journal.ts';
import { buildTripStory } from '../lib/memories/story.ts';

const TRIP: JournalTrip = {
  endDate: '2026-09-06',
  lifecycle: 'completed',
  referenceTimeZone: 'Asia/Tokyo',
  startDate: '2026-09-01',
};
const NOW = new Date('2026-10-08T03:00:00.000Z');

const SHRINE: MemoryTripPlace = {
  id: 'trip-place-shrine',
  kind: 'provider',
  name: null,
  placeId: 'place-shrine',
  providerRefs: [],
};

function memory(overrides: Partial<Memory> & Pick<Memory, 'id'>): Memory {
  return {
    capturedAt: '2026-09-02T01:30:00.000Z',
    capturedLocalDate: '2026-09-02',
    capturedLocalTime: '10:30',
    createdAt: '2026-09-02T01:30:00.000Z',
    highlightPosition: null,
    isHighlight: false,
    itineraryDay: null,
    itineraryItem: null,
    note: null,
    photos: [],
    timeZone: 'Asia/Tokyo',
    timeZoneSource: 'trip_reference',
    tripPlace: null,
    updatedAt: '2026-09-02T01:30:00.000Z',
    ...overrides,
  };
}

function photo(id: string) {
  return {
    contentType: 'image/jpeg',
    createdAt: '2026-09-02T01:30:00.000Z',
    fileName: `${id}.jpg`,
    id,
    position: 0,
    sizeBytes: 1000,
    url: `https://storage.example/${id}.jpg`,
  };
}

function tripPlace(id: string, address: string | null): ItineraryTripPlace {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'provider',
      location: null,
      name: id,
      note: null,
      providerAddress: address,
      providerLabel: null,
      providerRefs: [],
      timeZone: null,
    },
    priority: null,
  };
}

function item(id: string, place: ItineraryTripPlace | null): ItineraryItem {
  return {
    createdAt: '2026-09-01T00:00:00.000Z',
    customLabel: place ? null : id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelStatus: 'upcoming',
    tripPlace: place,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function itineraryDay(date: string, overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date,
    defaultTimeZone: 'Asia/Tokyo',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: `day-${date}`,
    items: [],
    name: null,
    notes: null,
    routeStartTravelMode: 'walk',
    ...overrides,
  };
}

test('days with memories become chapters and quiet runs fold into one line between them', () => {
  const story = buildTripStory([
    memory({ capturedLocalDate: '2026-09-02', id: 'a' }),
    memory({ capturedLocalDate: '2026-09-05', id: 'b' }),
  ]);
  const { entries } = buildJournal({ days: journalDays(TRIP, null, NOW), lens: null, story });

  expect(
    entries.map((entry) =>
      entry.kind === 'chapter'
        ? `chapter ${entry.day.dayNumber}`
        : `quiet ${entry.days.map((day) => day.dayNumber).join('-')}`,
    ),
  ).toStrictEqual(['quiet 1', 'chapter 2', 'quiet 3-4', 'chapter 5', 'quiet 6']);
});

test('every memory appears exactly once, in the chapter for the day it was kept on', () => {
  const memories = [
    memory({ capturedLocalDate: '2026-09-02', capturedLocalTime: '18:00', id: 'evening' }),
    memory({ capturedLocalDate: '2026-09-02', capturedLocalTime: '08:00', id: 'morning' }),
    memory({ capturedLocalDate: '2026-09-04', id: 'later' }),
  ];
  const { entries } = buildJournal({
    days: journalDays(TRIP, null, NOW),
    lens: null,
    story: buildTripStory(memories),
  });
  const shown = entries.flatMap((entry) =>
    entry.kind === 'chapter' ? entry.memories.map((kept) => kept.id) : [],
  );

  expect(shown).toStrictEqual(['morning', 'evening', 'later']);
});

test('a day with only a reflection is a chapter, but not to a lens; a lens folds no quiet days', () => {
  const story = buildTripStory(
    [memory({ capturedLocalDate: '2026-09-04', id: 'kept', isHighlight: true })],
    [{ date: '2026-09-02', note: 'Rain all day, and somehow perfect.', rating: null }],
  );
  const days = journalDays(TRIP, null, NOW);

  const whole = buildJournal({ days, lens: null, story }).entries;
  expect(whole.filter((entry) => entry.kind === 'chapter').map((entry) => entry.id)).toStrictEqual([
    'journal-day-2026-09-02',
    'journal-day-2026-09-04',
  ]);

  const highlights = buildJournal({ days, lens: HIGHLIGHTS_LENS, story }).entries;
  expect(highlights.map((entry) => entry.kind)).toStrictEqual(['chapter']);
  expect(highlights[0]?.id).toBe('journal-day-2026-09-04');
});

test('lenses filter by Highlight, by Place, and by having no Place', () => {
  const story = buildTripStory([
    memory({ id: 'at-shrine', tripPlace: SHRINE }),
    memory({ id: 'nowhere' }),
    memory({ id: 'starred', isHighlight: true }),
  ]);
  const days = journalDays(TRIP, null, NOW);
  const ids = (lens: string | null) =>
    buildJournal({ days, lens, story }).entries.flatMap((entry) =>
      entry.kind === 'chapter' ? entry.memories.map((kept) => kept.id) : [],
    );

  expect(ids(SHRINE.id)).toStrictEqual(['at-shrine']);
  expect(ids(UNPLACED_LENS).sort()).toStrictEqual(['nowhere', 'starred']);
  expect(ids(HIGHLIGHTS_LENS)).toStrictEqual(['starred']);
  expect(journalLensOptions(story).map((option) => option.kind)).toStrictEqual([
    'all',
    'highlights',
    'place',
    'unplaced',
  ]);
});

test('memories dated outside the trip keep a chapter of their own, with no day number', () => {
  const story = buildTripStory([memory({ capturedLocalDate: '2026-09-09', id: 'after' })]);
  const { entries } = buildJournal({ days: journalDays(TRIP, null, NOW), lens: null, story });
  const last = entries.at(-1);

  expect(last?.kind).toBe('chapter');
  expect(last?.kind === 'chapter' ? last.day : null).toStrictEqual({
    date: '2026-09-09',
    dayNumber: null,
    isToday: false,
    name: null,
    place: null,
  });
});

test('today is only ever marked on an active trip, read in its own time zone', () => {
  const active: JournalTrip = { ...TRIP, endDate: '2026-10-10', lifecycle: 'active' };
  // 23:30 UTC on the 7th is already the 8th in Tokyo.
  const lateNight = new Date('2026-10-07T23:30:00.000Z');
  const range = { ...active, startDate: '2026-10-06' };

  expect(journalDays(range, null, lateNight).find((day) => day.isToday)?.date).toBe('2026-10-08');
  expect(
    journalDays({ ...range, lifecycle: 'completed' }, null, lateNight).some((day) => day.isToday),
  ).toBe(false);
});

test('without an itinerary the trip dates lay the days out, and a runaway range is capped', () => {
  expect(journalDays(TRIP, null, NOW).map((day) => day.dayNumber)).toStrictEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(journalDays({ ...TRIP, endDate: '2030-01-01' }, null, NOW)).toHaveLength(366);
});

test('the itinerary names the day and its town, never its hotel', () => {
  const hotel = tripPlace('hotel', '1 Chome-19-1 Kabukicho, Shinjuku City, Tokyo 160-8466, Japan');
  const shrine = tripPlace(
    'shrine',
    '68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto, 612-0882, Japan',
  );
  const market = tripPlace('market', '609 Nakagyo Ward, Kyoto, 604-8054, Japan');

  const stayDay = itineraryDay('2026-09-01', {
    name: '  Arrival  ',
    stay: {
      endSource: 'explicit',
      endTripPlaceId: 'hotel',
      startSource: null,
      startTripPlaceId: null,
    },
  });
  const stopsDay = itineraryDay('2026-09-02', {
    items: [item('one', shrine), item('two', market)],
  });

  expect(dayTown(stayDay, [hotel])).toBe('Tokyo');
  expect(dayTown(stopsDay, [hotel, shrine, market])).toBe('Kyoto');
  expect(dayTown(itineraryDay('2026-09-03'), [hotel])).toBeNull();

  const days = journalDays(
    TRIP,
    { days: [stopsDay, stayDay], tripPlaces: [hotel, shrine, market] },
    NOW,
  );
  expect(days.map((day) => [day.date, day.name, day.place])).toStrictEqual([
    ['2026-09-01', 'Arrival', 'Tokyo'],
    ['2026-09-02', null, 'Kyoto'],
  ]);
});

test('the contents cover every day, and a day is remembered by its first Highlight', () => {
  const story = buildTripStory([
    memory({ capturedLocalTime: '08:00', id: 'plain', photos: [photo('first')] }),
    memory({ capturedLocalTime: '09:00', id: 'best', isHighlight: true, photos: [photo('best')] }),
  ]);
  const { contents } = buildJournal({
    days: journalDays(TRIP, null, NOW),
    lens: HIGHLIGHTS_LENS,
    story,
  });

  expect(contents).toHaveLength(6);
  const second = contents[1];
  expect(second?.hasChapter).toBe(true);
  expect(second?.memoryCount).toBe(2);
  expect(second?.leadPhoto?.photo.id).toBe('best');
  expect(contents[0]?.anchorId).toBe('journal-days-2026-09-01');
  expect(contents[3]?.anchorId).toBe('journal-days-2026-09-03');
});
