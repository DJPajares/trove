export type TimeSegmentKind = 'hour' | 'minute' | 'period';

export type TimeSegment = {
  end: number;
  kind: TimeSegmentKind;
  start: number;
};

export type SegmentedTimeDisplay = {
  segments: TimeSegment[];
  text: string;
};

export function parseCanonicalTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function canonicalTime(hour: number, minute: number) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function compact(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replaceAll(/[\p{P}\p{Z}\s]/gu, '');
}

function localizedDayPeriods(locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  });

  function dayPeriod(hour: number) {
    const date = new Date(Date.UTC(2000, 0, 1, hour));
    return formatter.formatToParts(date).find((part) => part.type === 'dayPeriod')?.value;
  }

  return { am: dayPeriod(9), pm: dayPeriod(21) };
}

export function parseTimeInput(value: string, locale = 'en') {
  const trimmed = value.trim();
  const canonical = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (canonical) {
    const hour = Number(canonical[1]);
    const minute = Number(canonical[2]);
    return hour <= 23 && minute <= 59 ? canonicalTime(hour, minute) : null;
  }

  const twelveHour = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(trimmed);
  if (twelveHour) {
    const displayHour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? '0');
    if (displayHour < 1 || displayHour > 12 || minute > 59) return null;
    const period = twelveHour[3]?.toLowerCase();
    return canonicalTime((displayHour % 12) + (period === 'p' ? 12 : 0), minute);
  }

  const numbers = trimmed.match(/\d{1,2}/g);
  if (!numbers || numbers.length !== 2) return null;
  const displayHour = Number(numbers[0]);
  const minute = Number(numbers[1]);
  if (displayHour < 1 || displayHour > 12 || minute > 59) return null;

  const normalized = compact(trimmed);
  const { am, pm } = localizedDayPeriods(locale);
  const period = [
    { hourOffset: 0, value: am },
    { hourOffset: 12, value: pm },
  ].find(({ value: dayPeriod }) => dayPeriod && normalized.includes(compact(dayPeriod)));

  return period ? canonicalTime((displayHour % 12) + period.hourOffset, minute) : null;
}

export function formatSegmentedTime(
  value: string,
  locale: string,
  format: '12h' | '24h',
): SegmentedTimeDisplay {
  const parsed = parseCanonicalTime(value);
  if (!parsed) return { segments: [], text: '' };

  if (format === '24h') {
    return {
      segments: [
        { end: 2, kind: 'hour', start: 0 },
        { end: 5, kind: 'minute', start: 3 },
      ],
      text: value,
    };
  }

  const date = new Date(Date.UTC(2000, 0, 1, parsed.hour, parsed.minute));
  const parts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(date);
  const segments: TimeSegment[] = [];
  let text = '';

  for (const part of parts) {
    const start = text.length;
    text += part.value;
    const kind =
      part.type === 'dayPeriod'
        ? 'period'
        : part.type === 'hour' || part.type === 'minute'
          ? part.type
          : null;
    if (kind) segments.push({ end: text.length, kind, start });
  }

  return { segments, text };
}

export function nearestTimeSegment(segments: TimeSegment[], offset: number) {
  return segments.reduce<TimeSegment | null>((nearest, segment) => {
    if (offset >= segment.start && offset <= segment.end) return segment;
    if (!nearest) return segment;
    const distance = Math.min(Math.abs(offset - segment.start), Math.abs(offset - segment.end));
    const nearestDistance = Math.min(
      Math.abs(offset - nearest.start),
      Math.abs(offset - nearest.end),
    );
    return distance < nearestDistance ? segment : nearest;
  }, null);
}

export function replaceTimePeriod(value: string, period: 'am' | 'pm') {
  const parsed = parseCanonicalTime(value);
  if (!parsed) return null;
  const hour = (parsed.hour % 12) + (period === 'pm' ? 12 : 0);
  return canonicalTime(hour, parsed.minute);
}
