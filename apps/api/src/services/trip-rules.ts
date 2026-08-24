import { getAllCountries } from 'countries-and-timezones';

export type TripLifecycle = 'active' | 'completed' | 'planning';

export type TimeZoneCandidate = {
  placeId: string;
  timeZone: string | null;
};

export type TripTimeZoneResolution = {
  source: 'DESTINATION' | 'DEVICE_FALLBACK' | 'EXPLICIT' | 'PROFILE_HOME' | 'STARTING_LOCATION';
  sourcePlaceId: string | null;
  timeZone: string;
};

export type ItineraryCoverage = {
  percentage: number;
  plannedDays: number;
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

const countryPrimaryTimeZones = new Map(
  Object.values(getAllCountries()).map((country) => [
    normalizeCountryName(country.name),
    country.timezones.find(isValidIanaTimeZone) ?? null,
  ]),
);

/**
 * Country-only destinations have no coordinate or Place result to resolve, so
 * use the maintained dataset's primary IANA zone. Free-text cities and regions
 * deliberately do not match and continue through the normal fallback order.
 */
export function resolveCountryPrimaryTimeZone(destination: string) {
  return countryPrimaryTimeZones.get(normalizeCountryName(destination)) ?? null;
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
