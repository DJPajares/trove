import type { DayExperience } from '@trove/types';

import { dayLocality, localityFromAddress } from '@/lib/itinerary/day-place';
import type { Itinerary, ItineraryDay } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import { calendarDayDistance, getLocalDate } from '@/lib/trips/lifecycle';

import type { Memory, MemoryPhoto } from './api';
import type { StoryPlace, TripStory } from './story';

/**
 * The Memories journal, laid out: which days become chapters, which quiet runs
 * of days fold into a single line between them, and what the contents strip
 * shows for each day of the trip.
 *
 * Everything here is read from what the traveller actually kept - their
 * Memories, their own reflections on a day - and from the trip's own shape.
 * A planned stop is never a visit and an empty day is never a prompt: it is
 * named, quietly, and passed over.
 */

/** The longest stretch laid out day by day when there is no itinerary to go on. */
const MAX_JOURNAL_DAYS = 366;

/** `null` reads everything; otherwise Highlights, one Trip Place, or what has no Place. */
export type JournalLens = string | null;

export const HIGHLIGHTS_LENS = 'highlights';
export const UNPLACED_LENS = 'unplaced';

export type JournalTrip = Pick<Trip, 'endDate' | 'lifecycle' | 'referenceTimeZone' | 'startDate'>;

export type JournalDay = {
  date: string;
  /** One-based within the trip's dates; null for a date outside them. */
  dayNumber: number | null;
  /** Only ever true on an active trip, read in the trip's own time zone. */
  isToday: boolean;
  /** The traveller's own title for the day, if they gave it one. */
  name: string | null;
  /** The town the day happened in, when it can be read safely; never a hotel. */
  place: string | null;
};

export type JournalChapter = {
  day: JournalDay;
  experience: DayExperience | null;
  id: string;
  kind: 'chapter';
  memories: Memory[];
};

export type JournalInterlude = {
  days: JournalDay[];
  id: string;
  kind: 'interlude';
};

export type JournalEntry = JournalChapter | JournalInterlude;

export type JournalLeadPhoto = { memoryId: string; photo: MemoryPhoto };

export type JournalContentsDay = {
  /** The element a jump to this day lands on: its chapter, or the quiet run it sits in. */
  anchorId: string;
  day: JournalDay;
  hasChapter: boolean;
  leadPhoto: JournalLeadPhoto | null;
  memoryCount: number;
};

export type Journal = {
  /** Every day of the trip, and every dated chapter outside it, whatever the lens. */
  contents: JournalContentsDay[];
  /** The reading flow under the current lens. */
  entries: JournalEntry[];
};

export type JournalLensOption =
  | { count: number; id: null; kind: 'all' }
  | { count: number; id: typeof HIGHLIGHTS_LENS; kind: 'highlights' }
  | { count: number; id: string; kind: 'place'; place: StoryPlace }
  | { count: number; id: typeof UNPLACED_LENS; kind: 'unplaced' };

export function journalChapterId(date: string) {
  return `journal-day-${date}`;
}

function journalInterludeId(firstDate: string) {
  return `journal-days-${firstDate}`;
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function matchesLens(memory: Memory, lens: JournalLens) {
  if (lens === null) return true;
  if (lens === HIGHLIGHTS_LENS) return memory.isHighlight;
  if (lens === UNPLACED_LENS) return !memory.tripPlace;
  return memory.tripPlace?.id === lens;
}

/**
 * The ways into the journal: everything, Highlights, each Place, and what was
 * kept away from any Place. They filter the one reading flow rather than
 * listing the same Memories a second time (PRD 31.2), and a way in that would
 * show nothing is not offered.
 */
export function journalLensOptions(story: TripStory): JournalLensOption[] {
  return [
    { count: story.memoryCount, id: null, kind: 'all' },
    ...(story.highlights.length
      ? [{ count: story.highlights.length, id: HIGHLIGHTS_LENS, kind: 'highlights' } as const]
      : []),
    ...story.places.map(
      (place) =>
        ({
          count: place.memories.length,
          id: place.tripPlace.id,
          kind: 'place',
          place,
        }) as const,
    ),
    ...(story.unplacedCount
      ? [{ count: story.unplacedCount, id: UNPLACED_LENS, kind: 'unplaced' } as const]
      : []),
  ];
}

/**
 * The town a day happened in. Its Stay decides first - where the traveller
 * ended the day, else where they started it, else a base set by hand - read
 * from that place's address rather than named after it, because a hotel is not
 * a town. A day with no Stay to go on is named after the town most of its stops
 * share, and a day that says nothing safely is left unnamed.
 */
export function journalDayPlace(day: ItineraryDay, tripPlaces: Itinerary['tripPlaces']) {
  const stayId =
    day.stay?.endTripPlaceId ?? day.stay?.startTripPlaceId ?? day.dailyBaseTripPlaceId ?? null;
  const stay = stayId ? tripPlaces.find((tripPlace) => tripPlace.id === stayId) : null;
  const stayLocality = stay
    ? localityFromAddress(stay.place.snapshot?.address ?? stay.place.providerAddress)
    : null;
  if (stayLocality) return stayLocality;

  return dayLocality(
    day.items.map(
      (item) => item.tripPlace?.place.snapshot?.address ?? item.tripPlace?.place.providerAddress,
    ),
  );
}

/**
 * Every day of the trip, in order. The itinerary carries each day's own name
 * and Stay; without it - still loading, or not on this device - the trip's
 * dates alone lay the days out, so the journal never waits on the planner.
 */
export function journalDays(
  trip: JournalTrip,
  itinerary: Pick<Itinerary, 'days' | 'tripPlaces'> | null,
  now: Date,
): JournalDay[] {
  const totalDays = Math.min(
    MAX_JOURNAL_DAYS,
    Math.max(0, calendarDayDistance(trip.startDate, trip.endDate) + 1),
  );
  const today = trip.lifecycle === 'active' ? getLocalDate(now, trip.referenceTimeZone) : null;
  const dayNumber = (date: string) => {
    const number = calendarDayDistance(trip.startDate, date) + 1;
    return number >= 1 && number <= totalDays ? number : null;
  };

  if (itinerary?.days.length) {
    return [...itinerary.days]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => ({
        date: day.date,
        dayNumber: dayNumber(day.date),
        isToday: day.date === today,
        name: day.name?.trim() ? day.name.trim() : null,
        place: journalDayPlace(day, itinerary.tripPlaces),
      }));
  }

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addCalendarDays(trip.startDate, index);
    return { date, dayNumber: index + 1, isToday: date === today, name: null, place: null };
  });
}

/** The photograph a day is remembered by: its first Highlight's, else its first. */
function leadPhotoOf(memories: Memory[]): JournalLeadPhoto | null {
  const lead =
    memories.find((memory) => memory.isHighlight && memory.photos.length) ??
    memories.find((memory) => memory.photos.length);
  const photo = lead?.photos[0];
  return lead && photo ? { memoryId: lead.id, photo } : null;
}

function hasReflection(experience: DayExperience | null | undefined) {
  return Boolean(experience && (experience.rating !== null || experience.note?.trim()));
}

/** A date the trip's own days do not cover still reads as a day, with no number. */
function dayFor(date: string, days: JournalDay[]): JournalDay {
  return (
    days.find((day) => day.date === date) ?? {
      date,
      dayNumber: null,
      isToday: false,
      name: null,
      place: null,
    }
  );
}

function layOut(story: TripStory, days: JournalDay[], lens: JournalLens): JournalEntry[] {
  // A trip's own days, plus any date a Memory or a reflection was kept on that
  // the trip's dates no longer cover - those keep their chapter (PRD 6.1).
  const dates = [
    ...new Set([...days.map((day) => day.date), ...story.days.map((day) => day.date)]),
  ].sort((left, right) => left.localeCompare(right));

  const entries: JournalEntry[] = [];
  let quiet: JournalDay[] = [];
  const closeQuietRun = () => {
    const first = quiet[0];
    if (first) entries.push({ days: quiet, id: journalInterludeId(first.date), kind: 'interlude' });
    quiet = [];
  };

  for (const date of dates) {
    const day = dayFor(date, days);
    const storyDay = story.days.find((candidate) => candidate.date === date);
    const memories = (storyDay?.memories ?? []).filter((memory) => matchesLens(memory, lens));
    const experience = storyDay?.experience ?? null;

    // A day with only a reflection still has something to say, but not to a
    // lens: Highlights and Places are about Memories.
    if (memories.length || (lens === null && hasReflection(experience))) {
      closeQuietRun();
      entries.push({ day, experience, id: journalChapterId(date), kind: 'chapter', memories });
      continue;
    }

    // Quiet days are part of the trip's shape only while the whole journal is
    // being read; under a lens they would be noise between the matches.
    if (lens === null && day.dayNumber !== null) quiet.push(day);
  }
  closeQuietRun();

  return entries;
}

/**
 * The journal under a lens, and its contents. Every Memory the lens admits
 * appears exactly once, in the chapter for the day it was kept on.
 */
export function buildJournal({
  days,
  lens,
  story,
}: Readonly<{
  days: JournalDay[];
  lens: JournalLens;
  story: TripStory;
}>): Journal {
  const everything = layOut(story, days, null);
  const entries = lens === null ? everything : layOut(story, days, lens);

  // The contents always show the whole trip, whatever the lens: a jump to a day
  // the lens hides clears the lens on its way there.
  const contents = everything.flatMap((entry): JournalContentsDay[] =>
    entry.kind === 'interlude'
      ? entry.days.map((day) => ({
          anchorId: entry.id,
          day,
          hasChapter: false,
          leadPhoto: null,
          memoryCount: 0,
        }))
      : [
          {
            anchorId: entry.id,
            day: entry.day,
            hasChapter: true,
            leadPhoto: leadPhotoOf(entry.memories),
            memoryCount: entry.memories.length,
          },
        ],
  );

  return { contents, entries };
}
