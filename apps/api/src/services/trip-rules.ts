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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
