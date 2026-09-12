import { getAllCountries } from 'countries-and-timezones';

import { timeZoneForCountry } from '@trove/types/countries';

export type TripLifecycle = 'active' | 'completed' | 'planning';

export type TimeZoneCandidate = {
  /** Null for a candidate that is not a Place, such as the profile's home country. */
  placeId: string | null;
  timeZone: string | null;
};

export type TripTimeZoneResolution = {
  source:
    | 'COUNTRY'
    | 'DESTINATION'
    | 'DEVICE_FALLBACK'
    | 'EXPLICIT'
    | 'PROFILE_HOME'
    | 'STARTING_LOCATION';
  sourcePlaceId: string | null;
  timeZone: string;
};

export type ItineraryCoverage = {
  percentage: number;
  plannedDays: number;
  totalDays: number;
};

export type TripPreparedness = {
  daysPlanned: number;
  daysWithStay: number;
  percentage: number;
  /** False for a single-day trip, where there is no night to cover. */
  stayApplicable: boolean;
  totalDays: number;
};

export type TripWeatherLocation = {
  latitude: number;
  longitude: number;
  timeZone: string;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCountryName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

const englishCountryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * `countries-and-timezones` matches a country *name*; it cannot say which of a
 * country's zones is the main one, because its per-country list is alphabetical
 * rather than ordered by primacy - its first entry for the United States is
 * America/Adak and for Australia is Antarctica/Macquarie. So the name matching
 * comes from the library and the zone comes from the curated map.
 *
 * That map is keyed for a home-country dropdown, so it omits Antarctica and
 * four uninhabited territories. Those are still destinations a traveller can
 * name, so they keep falling back to the library's list.
 *
 * The library carries one name per country and it is the formal one, which
 * leaves "United States" unmatched. Each country's English display name is
 * registered alongside it so the everyday form resolves too.
 */
const countryPrimaryTimeZones = new Map<string, string>();
/**
 * The same names, pointing at the country itself rather than its zone.
 *
 * Built in the same pass because it answers the same question from the same
 * evidence: AI-applied trips are created outside the request schema that makes
 * a country mandatory, so they name their countries from what the draft's
 * destinations say. Only codes the curated map knows are registered - a code
 * the rest of Trove will not store is no use to an apply either.
 */
const countryCodesByName = new Map<string, string>();

for (const country of Object.values(getAllCountries())) {
  const timeZone = timeZoneForCountry(country.id) ?? country.timezones.find(isValidIanaTimeZone);

  if (!timeZone) continue;

  for (const name of [country.name, englishCountryNames.of(country.id)]) {
    if (!name) continue;
    countryPrimaryTimeZones.set(normalizeCountryName(name), timeZone);
    if (timeZoneForCountry(country.id)) {
      countryCodesByName.set(normalizeCountryName(name), country.id);
    }
  }
}

/**
 * An explicitly named country supplies a deterministic timezone without a
 * provider request, whether it is the entire destination or the last component
 * of a city/region label. Bare cities stay ambiguous and continue through the
 * normal fallback order rather than being guessed.
 */
export function resolveCountryPrimaryTimeZone(destination: string) {
  const exactCountry = countryPrimaryTimeZones.get(normalizeCountryName(destination));
  if (exactCountry) return exactCountry;

  const countrySuffix = destination.split(',').at(-1);
  if (!countrySuffix || countrySuffix === destination) return null;

  return countryPrimaryTimeZones.get(normalizeCountryName(countrySuffix)) ?? null;
}

/**
 * The country a freely typed destination names, or null when it names none.
 *
 * Reads the same way `resolveCountryPrimaryTimeZone` does - the whole string
 * first, then the part after the last comma - so "Hanoi, Vietnam" resolves and
 * a bare "Hanoi" stays unresolved rather than being guessed at.
 */
export function resolveDestinationCountryCode(destination: string) {
  const exact = countryCodesByName.get(normalizeCountryName(destination));
  if (exact) return exact;

  const suffix = destination.split(',').at(-1);
  if (!suffix || suffix === destination) return null;

  return countryCodesByName.get(normalizeCountryName(suffix)) ?? null;
}

export function isValidIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value.includes('/') || value === 'UTC';
  } catch {
    return false;
  }
}

export function parseDateOnly(value: string) {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error('invalid_date');
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new Error('invalid_date');
  }

  return date;
}

export function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** The same calendar date, `days` later or - for a negative offset - earlier. */
export function shiftDateOnly(date: string, days: number) {
  const shifted = parseDateOnly(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDateOnly(shifted);
}

/** How many whole days separate two dates, signed from `from` to `to`. */
export function dayOffset(from: string, to: string) {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000);
}

export function enumerateDateRange(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (end < start) {
    throw new Error('invalid_date_range');
  }

  const dates: string[] = [];

  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(formatDateOnly(cursor));
  }

  return dates;
}

export function getDateRangeChanges(existingDates: string[], startDate: string, endDate: string) {
  const requestedDates = enumerateDateRange(startDate, endDate);
  const requested = new Set(requestedDates);
  const existing = new Set(existingDates);

  return {
    missingDates: requestedDates.filter((date) => !existing.has(date)),
    removedDates: existingDates.filter((date) => !requested.has(date)),
    retainedDates: existingDates.filter((date) => requested.has(date)),
  };
}

/**
 * Itinerary coverage is deliberately a day-presence measure, not a score.
 * Callers pass only items assigned to itinerary days, so unscheduled items,
 * daily bases, tasks, and reservations cannot affect the result.
 */
export function calculateItineraryCoverage(
  startDate: string,
  endDate: string,
  days: readonly { date: Date | string; scheduledItemCount: number }[],
): ItineraryCoverage {
  const tripDates = enumerateDateRange(startDate, endDate);
  const tripDateSet = new Set(tripDates);
  const plannedDates = new Set(
    days
      .filter((day) => day.scheduledItemCount > 0)
      .map((day) => (typeof day.date === 'string' ? day.date : formatDateOnly(day.date)))
      .filter((date) => tripDateSet.has(date)),
  );
  const totalDays = tripDates.length;
  const plannedDays = plannedDates.size;

  return {
    percentage: totalDays === 0 ? 0 : Math.round((plannedDays / totalDays) * 100),
    plannedDays,
    totalDays,
  };
}

/**
 * Preparedness answers a different question to coverage: not whether a day has
 * anything on it, but whether the traveller has done the two things a trip
 * cannot leave without - knowing what they are doing, and knowing where they
 * are sleeping (PRD section 9.2).
 *
 * The two components are weighted equally, and because both are day ratios
 * over the same trip they share one denominator: of the two marks available
 * per trip day, how many are made. A single-day trip has no night to cover, so
 * the stay component leaves the denominator rather than scoring zero - the
 * same applicability rule Plan Score uses, for the same reason.
 *
 * This is advisory only. It never sets readiness, which is the traveller's own
 * declaration, and it is not the same thing as Plan Score, which judges
 * whether a plan is any good rather than whether it is filled in.
 */
export function calculateTripPreparedness(
  startDate: string,
  endDate: string,
  days: readonly { date: Date | string; hasStay: boolean; scheduledItemCount: number }[],
): TripPreparedness {
  const tripDates = enumerateDateRange(startDate, endDate);
  const tripDateSet = new Set(tripDates);
  const withinTrip = days.filter((day) =>
    tripDateSet.has(typeof day.date === 'string' ? day.date : formatDateOnly(day.date)),
  );
  const countDates = (predicate: (day: (typeof withinTrip)[number]) => boolean) =>
    new Set(
      withinTrip
        .filter(predicate)
        .map((day) => (typeof day.date === 'string' ? day.date : formatDateOnly(day.date))),
    ).size;

  const totalDays = tripDates.length;
  const daysPlanned = countDates((day) => day.scheduledItemCount > 0);
  const daysWithStay = countDates((day) => day.hasStay);
  const stayApplicable = totalDays > 1;

  const marks = daysPlanned + (stayApplicable ? daysWithStay : 0);
  const possible = totalDays * (stayApplicable ? 2 : 1);

  return {
    daysPlanned,
    daysWithStay,
    percentage: possible === 0 ? 0 : Math.round((marks / possible) * 100),
    stayApplicable,
    totalDays,
  };
}

export function resolveTripWeatherLocation(
  destinations: readonly {
    location: { latitude: number; longitude: number; timeZone: string | null } | null;
    timeZone: string | null;
  }[],
  referenceTimeZone: string,
): TripWeatherLocation | null {
  const located = destinations.find((destination) => destination.location !== null);
  if (!located?.location) return null;

  return {
    latitude: located.location.latitude,
    longitude: located.location.longitude,
    timeZone: located.timeZone ?? located.location.timeZone ?? referenceTimeZone,
  };
}

export function getLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function deriveTripLifecycle(
  startDate: string,
  endDate: string,
  referenceTimeZone: string,
  now = new Date(),
): TripLifecycle {
  const localDate = getLocalDate(now, referenceTimeZone);

  if (localDate < startDate) return 'planning';
  if (localDate > endDate) return 'completed';
  return 'active';
}

export function resolveTripTimeZone(input: {
  /** The trip's declared countries, ISO 3166-1 alpha-2, in the traveller's order. */
  countries?: readonly string[];
  destinations: TimeZoneCandidate[];
  deviceTimeZone: string;
  explicitTimeZone?: string | null;
  profileHome: TimeZoneCandidate | null;
  startingLocation: TimeZoneCandidate | null;
}): TripTimeZoneResolution {
  if (input.explicitTimeZone && isValidIanaTimeZone(input.explicitTimeZone)) {
    return { source: 'EXPLICIT', sourcePlaceId: null, timeZone: input.explicitTimeZone };
  }

  const destination = input.destinations.find(
    (candidate) => candidate.timeZone && isValidIanaTimeZone(candidate.timeZone),
  );

  if (destination?.timeZone) {
    return {
      source: 'DESTINATION',
      sourcePlaceId: destination.placeId,
      timeZone: destination.timeZone,
    };
  }

  /**
   * A declared country, before the trip falls back to where the traveller lives.
   *
   * It sits under the destination because a city is more specific than the
   * country holding it, and above the starting location because where a trip
   * goes says more about its clock than where it set off from. The lookup is
   * the same offline table the profile's home country uses - no provider, no
   * guess, and exact where the destination rung is only ever a string match.
   *
   * The first country, for the same reason the destination rung takes the
   * first destination: a trip spanning several is read by the one it leads with.
   */
  const country = input.countries?.map((code) => timeZoneForCountry(code)).find(Boolean);

  if (country) {
    return { source: 'COUNTRY', sourcePlaceId: null, timeZone: country };
  }

  if (input.startingLocation?.timeZone && isValidIanaTimeZone(input.startingLocation.timeZone)) {
    return {
      source: 'STARTING_LOCATION',
      sourcePlaceId: input.startingLocation.placeId,
      timeZone: input.startingLocation.timeZone,
    };
  }

  if (input.profileHome?.timeZone && isValidIanaTimeZone(input.profileHome.timeZone)) {
    return {
      source: 'PROFILE_HOME',
      sourcePlaceId: input.profileHome.placeId,
      timeZone: input.profileHome.timeZone,
    };
  }

  const deviceTimeZone = isValidIanaTimeZone(input.deviceTimeZone) ? input.deviceTimeZone : 'UTC';
  return { source: 'DEVICE_FALLBACK', sourcePlaceId: null, timeZone: deviceTimeZone };
}
