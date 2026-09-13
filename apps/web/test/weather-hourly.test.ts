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

test('the end of a day rolls into the next morning', () => {
  // 10:00Z is 22:00 in Auckland. What is left of today is one or two cells, and
  // a row that short says less than the temperature beside it - so it carries
  // on into the hours a traveller is actually asking about by then.
  const readings = selectHourlyReadings(
    hours([...daySpan('2026-09-11', 22, 23), ...daySpan('2026-09-12', 0, 8)]),
    {
      date: '2026-09-11',
      now: new Date('2026-09-11T10:00:00.000Z'),
      timeZone: ZONE,
    },
  );

  expect(readings.map((reading) => reading.time)).toStrictEqual([
    '2026-09-11T22:00',
    '2026-09-12T00:00',
    '2026-09-12T02:00',
    '2026-09-12T04:00',
    '2026-09-12T06:00',
  ]);
});

test('a day with enough left in it stays inside its own day', () => {
  // Three cells is enough to be a shape rather than a leftover, so tomorrow is
  // not borrowed from.
  const readings = selectHourlyReadings(
    hours([...daySpan('2026-09-11', 18, 23), ...daySpan('2026-09-12', 0, 4)]),
    {
      date: '2026-09-11',
      now: new Date('2026-09-11T06:00:00.000Z'),
      timeZone: ZONE,
    },
  );

  expect(readings.every((reading) => reading.time.startsWith('2026-09-11'))).toBe(true);
  expect(readings).toHaveLength(3);
});

test('a day the traveller has not reached yet is read whole', () => {
  // Nothing about it is behind them, so it starts where the day starts rather
  // than where they are standing.
  const readings = selectHourlyReadings(hours(daySpan('2026-09-13', 0, 23)), {
    date: '2026-09-13',
    now: new Date('2026-09-11T03:30:00.000Z'),
    timeZone: ZONE,
  });

  expect(readings[0]?.time).toBe('2026-09-13T00:00');
  expect(readings.at(-1)?.time).toBe('2026-09-13T22:00');
  expect(readings).toHaveLength(12);
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
