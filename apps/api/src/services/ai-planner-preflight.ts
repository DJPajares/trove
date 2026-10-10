import { EntitlementError } from './plan-entitlements.js';

const SMALL: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const NUMBER = `(?:\\d{1,6}|${Object.keys(SMALL).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?`;
function quantity(raw: string) {
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(/[- ]/).reduce((sum, word) => sum + (SMALL[word] ?? 0), 0);
}

function date(value: string) {
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value
    ? instant
    : null;
}

/** Conservative English preflight, never a substitute for normalized server validation. */
export function explicitAiTripDays(prompt: string): number | null {
  const text = prompt.toLowerCase().replace(/[–—]/g, '-').replaceAll('’', "'");
  // Alternatives, exclusions and historical descriptions require contextual normalization.
  if (/\b(?:instead|previous|ago)\b|\blast (?:year|month|week|time)\b/.test(text)) return null;
  if (
    new RegExp(
      `\\b(?:not|don't|do not)\\b[^.!?;\\n]{0,40}?\\b${NUMBER}[- ]+(?:days?|weeks?)\\b`,
    ).test(text)
  )
    return null;
  const lengths: number[] = [];
  const unitDays = (value: string, unit: string) =>
    quantity(value) * (unit.startsWith('week') ? 7 : 1);
  for (const match of text.matchAll(
    new RegExp(`\\b(${NUMBER})[- ]+(days?|weeks?)[- ]+(?:trip|itinerary|vacation|holiday)\\b`, 'g'),
  ))
    lengths.push(unitDays(match[1]!, match[2]!));
  for (const match of text.matchAll(
    new RegExp(
      `\\b(?:trip|itinerary|vacation|holiday)\\b[^.!?;\\n]{0,80}?\\b(?:for|of|lasting|over|is|takes)\\s+(${NUMBER})\\s+(days?|weeks?)\\b`,
      'g',
    ),
  ))
    lengths.push(unitDays(match[1]!, match[2]!));
  // "Plan 11 days in Tokyo" and "spend two weeks in Japan" describe the whole requested stay.
  for (const match of text.matchAll(
    new RegExp(`\\b(?:plan|spend|travel for)\\s+(?:for\\s+)?(${NUMBER})\\s+(days?|weeks?)\\b`, 'g'),
  ))
    lengths.push(unitDays(match[1]!, match[2]!));
  for (const match of text.matchAll(
    /\b(?:from\s+)?(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-)\s*(\d{4}-\d{2}-\d{2})\b/g,
  )) {
    const start = date(match[1]!);
    const end = date(match[2]!);
    if (start && end && end >= start)
      lengths.push((end.getTime() - start.getTime()) / 86_400_000 + 1);
  }
  // Conflicting durations must not be guessed or silently shortened.
  const distinct = [...new Set(lengths)];
  return distinct.length === 1 ? distinct[0]! : null;
}

export function checkAiPlannerPromptDays(prompt: string, maxItineraryDays: number) {
  const days = explicitAiTripDays(prompt);
  if (days !== null && days > maxItineraryDays)
    throw new EntitlementError('itinerary_day_limit_exceeded', 400, null, maxItineraryDays);
}

export function checkAiPlannerDateDays(
  startDate: string,
  endDate: string,
  maxItineraryDays: number,
) {
  const start = date(startDate);
  const end = date(endDate);
  if (
    start &&
    end &&
    end >= start &&
    (end.getTime() - start.getTime()) / 86_400_000 + 1 > maxItineraryDays
  ) {
    throw new EntitlementError('itinerary_day_limit_exceeded', 400, null, maxItineraryDays);
  }
}
