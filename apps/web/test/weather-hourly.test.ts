import { expect, test } from 'vitest';

import { selectHourlyReadings } from '../lib/weather/hourly.ts';

import type { WeatherHourlyForecast } from '../lib/weather/api.ts';

const ZONE = 'Pacific/Auckland';

/** The provider's window runs from the current hour into the following day. */
function hours(times: string[]): WeatherHourlyForecast[] {
  return times.map((time, index) => ({
    precipitationProbability: index * 10,
    temperature: 15 + index,
    time,
    weatherCode: 61,
  }));
}

function daySpan(date: string, from = 0, to = 23) {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${date}T${String(from + index).padStart(2, '0')}:00`,
  );
}

test('drops the hours that have already been and gone', () => {
  // 21:00Z on the 10th is 09:00 on the 11th in Auckland.
  const readings = selectHourlyReadings(hours(daySpan('2026-09-11')), {
    date: '2026-09-11',
    now: new Date('2026-09-10T21:00:00.000Z'),
    timeZone: ZONE,
  });

  expect(readings[0]?.time).toBe('2026-09-11T09:00');
});

test('steps by two, because a day is not read an hour at a time', () => {
  const readings = selectHourlyReadings(hours(daySpan('2026-09-11', 9, 15)), {
    date: '2026-09-11',
    now: new Date('2026-09-10T21:00:00.000Z'),
    timeZone: ZONE,
  });

  expect(readings.map((reading) => reading.time)).toStrictEqual([
    '2026-09-11T09:00',
    '2026-09-11T11:00',
    '2026-09-11T13:00',
    '2026-09-11T15:00',
  ]);
});

test('keeps only the day it was asked about', () => {
  // The provider answers 24 hours from now, which runs past midnight into a
  // different day of the trip. Those hours are not today's shape.
  const readings = selectHourlyReadings(
    hours([...daySpan('2026-09-11', 22, 23), ...daySpan('2026-09-12', 0, 3)]),
    {
      date: '2026-09-11',
      now: new Date('2026-09-11T10:00:00.000Z'),
      timeZone: ZONE,
    },
  );

  expect(readings.every((reading) => reading.time.startsWith('2026-09-11'))).toBe(true);
});

test('a day that is over has nothing left to say', () => {
  // 11:30 UTC is 23:30 in Auckland, past the last hour the day holds.
  const readings = selectHourlyReadings(hours(daySpan('2026-09-11', 9, 23)), {
    date: '2026-09-11',
    now: new Date('2026-09-11T11:30:00.000Z'),
    timeZone: ZONE,
  });

  expect(readings).toHaveLength(1);
});

test('the hour the traveller is standing in still counts', () => {
  // Half past three is still the three o'clock hour: a forecast for the hour in
  // progress is about the rest of it, not the part already spent.
  const readings = selectHourlyReadings(hours(daySpan('2026-09-11', 14, 18)), {
    date: '2026-09-11',
    now: new Date('2026-09-11T03:30:00.000Z'),
    timeZone: ZONE,
  });

  expect(readings[0]?.time).toBe('2026-09-11T15:00');
});
