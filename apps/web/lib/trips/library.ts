import type { Trip } from './api';
import { tripDayCount } from './facts';
import { calendarDayDistance, getLocalDate } from './lifecycle';

/**
 * The Trips library reads in three tenses: the trip the traveller is on or
 * leaving for next, the trips ahead of them, and the trips they have taken.
 * This module holds the arithmetic behind the last two shapes and the one
 * measure the lead trip draws while it is under way, so each can be tested
 * without rendering anything.
 */

export type AheadGroup =
  | { key: 'now'; kind: 'now'; trips: Trip[] }
  | { key: string; kind: 'month'; month: string; trips: Trip[] };

/**
 * The trips ahead, as the months they leave in.
 *
 * Trips already under way come first under their own heading - a second trip
 * the traveller is on does not belong to the month it started in, it belongs
 * to now. Everything else keeps the order it arrived in, which
 * `groupTripsForLibrary` has already made chronological, so a month is only
 * ever opened once.
 */
export function groupAheadByMonth(ahead: readonly Trip[]): AheadGroup[] {
  const groups: AheadGroup[] = [];
  const underway = ahead.filter((trip) => trip.lifecycle === 'active');
  if (underway.length) groups.push({ key: 'now', kind: 'now', trips: underway });

  for (const trip of ahead) {
    if (trip.lifecycle === 'active') continue;
    const month = trip.startDate.slice(0, 7);
    const last = groups.at(-1);
    if (last?.kind === 'month' && last.month === month) last.trips.push(trip);
    else groups.push({ key: month, kind: 'month', month, trips: [trip] });
  }

  return groups;
}

export type PastYearGroup = { trips: Trip[]; year: string };

/**
 * Finished trips by the year they ended in, most recent first.
 *
 * The year a trip ended rather than began, because that is the order the
 * archive already runs in: a New Year trip filed by its start would open its
 * old year a second time beneath the new one.
 */
export function groupPastByYear(past: readonly Trip[]): PastYearGroup[] {
  const groups: PastYearGroup[] = [];

  for (const trip of past) {
    const year = trip.endDate.slice(0, 4);
    const last = groups.at(-1);
    if (last?.year === year) last.trips.push(trip);
    else groups.push({ trips: [trip], year });
  }

  return groups;
}

/**
 * Which day of a trip under way it is, counted the way the traveller counts:
 * the first day is day one, and the trip's own reference zone decides when a
 * day turns over (PRD 6.1), so the number agrees with the lifecycle beside it.
 *
 * Clamped to the trip's own span. Between the server deciding a trip is active
 * and this render the date can have turned, and "day 6 of 5" is never true.
 */
export function tripDayProgress(trip: Trip, now = new Date()) {
  const total = tripDayCount(trip);
  const elapsed = calendarDayDistance(trip.startDate, getLocalDate(now, trip.referenceTimeZone));

  return { day: Math.min(total, Math.max(1, elapsed + 1)), total };
}

export type LibraryLedger = { ahead: number; countries: number; remembered: number };

/**
 * The library's line about itself: how many trips are ahead, how many have
 * been taken, and how many countries those taken trips reached.
 *
 * Countries are counted from the trips the traveller has actually been on -
 * finished or under way - because a country on a plan is a hope, not a place
 * they have been. Codes are de-duplicated across trips, so three trips to
 * Japan count Japan once.
 */
export function libraryLedger(trips: readonly Trip[]): LibraryLedger {
  const countries = new Set<string>();
  let ahead = 0;
  let remembered = 0;

  for (const trip of trips) {
    if (trip.lifecycle === 'completed') remembered += 1;
    else ahead += 1;
    if (trip.lifecycle !== 'planning') {
      for (const code of trip.countries ?? []) countries.add(code.toUpperCase());
    }
  }

  return { ahead, countries: countries.size, remembered };
}
