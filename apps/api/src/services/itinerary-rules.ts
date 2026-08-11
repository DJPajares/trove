import { isValidIanaTimeZone } from './trip-rules.js';

export type ItemTimeZoneResolution = {
  source: 'DAY_DEFAULT' | 'EXPLICIT' | 'PLACE';
  timeZone: string;
};

export type DayTimeZoneResolution = {
  source: 'EXPLICIT_DAILY_BASE' | 'FIRST_LOCATED_ITEM' | 'TRIP_REFERENCE';
  sourceItemId: string | null;
  sourceTripPlaceId: string | null;
  timeZone: string;
};

export type TaskTimeZoneResolution = {
  source: 'ITINERARY_DAY' | 'ITINERARY_ITEM' | 'TRIP_REFERENCE';
  timeZone: string;
};

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function getLocalParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function getTimeZoneOffset(instant: Date, timeZone: string) {
  const local = getLocalParts(instant, timeZone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  return localAsUtc - instant.getTime();
}

export function parseLocalTime(value: string) {
  if (!LOCAL_TIME_PATTERN.test(value)) throw new Error('invalid_local_time');
  return new Date(`1970-01-01T${value}:00.000Z`);
}

export function formatLocalTime(value: Date | null) {
  return value?.toISOString().slice(11, 16) ?? null;
}

export function floatingLocalTimeToInstant(date: string, time: string, timeZone: string) {
  if (!isValidIanaTimeZone(timeZone) || !LOCAL_TIME_PATTERN.test(time)) {
    throw new Error('invalid_local_time');
  }

  const desiredAsUtc = Date.parse(`${date}T${time}:00.000Z`);
  if (Number.isNaN(desiredAsUtc)) throw new Error('invalid_local_time');

  let instant = new Date(desiredAsUtc);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    instant = new Date(desiredAsUtc - getTimeZoneOffset(instant, timeZone));
  }

  const local = getLocalParts(instant, timeZone);
  const actualTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  if (local.date !== date || actualTime !== time) throw new Error('invalid_local_time');

  return instant;
}

export function resolveItemTimeZone(input: {
  customLocationTimeZone: string | null;
  dayTimeZone: string;
  tripPlaceTimeZone: string | null;
}): ItemTimeZoneResolution {
  if (input.customLocationTimeZone && isValidIanaTimeZone(input.customLocationTimeZone)) {
    return { source: 'EXPLICIT', timeZone: input.customLocationTimeZone };
  }

  if (input.tripPlaceTimeZone && isValidIanaTimeZone(input.tripPlaceTimeZone)) {
    return { source: 'PLACE', timeZone: input.tripPlaceTimeZone };
  }

  return { source: 'DAY_DEFAULT', timeZone: input.dayTimeZone };
}

export function resolveDayTimeZone(input: {
  dailyBase: { timeZone: string | null; tripPlaceId: string } | null;
  items: Array<{
    customLocationTimeZone: string | null;
    id: string;
    tripPlaceId: string | null;
    tripPlaceTimeZone: string | null;
  }>;
  tripTimeZone: string;
}): DayTimeZoneResolution {
  if (input.dailyBase?.timeZone && isValidIanaTimeZone(input.dailyBase.timeZone)) {
    return {
      source: 'EXPLICIT_DAILY_BASE',
      sourceItemId: null,
      sourceTripPlaceId: input.dailyBase.tripPlaceId,
      timeZone: input.dailyBase.timeZone,
    };
  }

  for (const item of input.items) {
    const timeZone = item.customLocationTimeZone ?? item.tripPlaceTimeZone;
    if (timeZone && isValidIanaTimeZone(timeZone)) {
      return {
        source: 'FIRST_LOCATED_ITEM',
        sourceItemId: item.id,
        sourceTripPlaceId: item.tripPlaceId,
        timeZone,
      };
    }
  }

  return {
    source: 'TRIP_REFERENCE',
    sourceItemId: null,
    sourceTripPlaceId: null,
    timeZone: input.tripTimeZone,
  };
}

export function resolveTaskTimeZone(input: {
  itineraryDayTimeZone: string | null;
  itineraryItemTimeZone: string | null;
  tripTimeZone: string;
}): TaskTimeZoneResolution {
  if (input.itineraryItemTimeZone && isValidIanaTimeZone(input.itineraryItemTimeZone)) {
    return { source: 'ITINERARY_ITEM', timeZone: input.itineraryItemTimeZone };
  }

  if (input.itineraryDayTimeZone && isValidIanaTimeZone(input.itineraryDayTimeZone)) {
    return { source: 'ITINERARY_DAY', timeZone: input.itineraryDayTimeZone };
  }

  return { source: 'TRIP_REFERENCE', timeZone: input.tripTimeZone };
}
