import { expect, test } from 'vitest';

import {
  formatSegmentedTime,
  nearestTimeSegment,
  parseTimeInput,
  replaceTimePeriod,
} from '../lib/time/time-segments.ts';

test('maps the hour and minute ranges in 24-hour displays', () => {
  expect(formatSegmentedTime('19:05', 'en-GB', '24h')).toEqual({
    segments: [
      { end: 2, kind: 'hour', start: 0 },
      { end: 5, kind: 'minute', start: 3 },
    ],
    text: '19:05',
  });
});

test('maps every localized part in 12-hour displays', () => {
  const display = formatSegmentedTime('21:05', 'ko-KR', '12h');

  expect(display.segments.map(({ kind }) => kind).sort()).toEqual(['hour', 'minute', 'period']);
  for (const segment of display.segments) {
    expect(display.text.slice(segment.start, segment.end)).not.toBe('');
  }

  const period = display.segments.find(({ kind }) => kind === 'period');
  expect(period).toBeDefined();
  expect(display.text.slice(period?.start, period?.end)).toBe('오후');
  expect(parseTimeInput(display.text, 'ko-KR')).toBe('21:05');
});

test('selects the nearest segment when a click lands on a separator', () => {
  const { segments } = formatSegmentedTime('19:05', 'en-GB', '24h');

  expect(nearestTimeSegment(segments, 1)?.kind).toBe('hour');
  expect(nearestTimeSegment(segments, 2)?.kind).toBe('hour');
  expect(nearestTimeSegment(segments, 3)?.kind).toBe('minute');
  expect(nearestTimeSegment(segments, 5)?.kind).toBe('minute');
});

test('preserves canonical values and rejects invalid input', () => {
  expect(parseTimeInput('09:05')).toBe('09:05');
  expect(parseTimeInput('9:05 PM')).toBe('21:05');
  expect(parseTimeInput('24:00')).toBeNull();
  expect(parseTimeInput('12:60 PM')).toBeNull();
  expect(parseTimeInput('later')).toBeNull();
});

test('changes only the canonical hour when replacing a day period', () => {
  expect(replaceTimePeriod('09:05', 'pm')).toBe('21:05');
  expect(replaceTimePeriod('21:05', 'am')).toBe('09:05');
  expect(replaceTimePeriod('not-a-time', 'pm')).toBeNull();
});
