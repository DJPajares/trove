import type { AtlasListingKind, AtlasMonthClimate } from '@trove/types';

import type { TrovePlaceCategory } from '@/lib/place-categories';

/** Matches PRD 40.4 and the AI planner's 24-place real-place cap. */
export const ATLAS_MAX_TRIP_PICKS = 24;
export const ATLAS_TRIP_PICKS_KEY = 'trove:atlas-trip-picks:v1';

export type AtlasTripPick = {
  id: string;
  countryCode: string;
  countryName: string;
  /** Empty string for a pick taken from a country guide; slug for a destination sub-guide. */
  destinationSlug: string;
  destinationName: string;
  /** Wikivoyage article title, kept for attribution on the resulting trip. */
  guideTitle: string;
  kind: AtlasListingKind;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  addedAt: number;
};

export type AtlasTripPickInput = Omit<AtlasTripPick, 'addedAt' | 'id'>;

type PickStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function browserStorage(): PickStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function atlasPickId(
  input: Pick<AtlasTripPick, 'countryCode' | 'destinationSlug' | 'kind' | 'name'>,
) {
  return [
    input.countryCode.toUpperCase(),
    input.destinationSlug || 'country',
    input.kind,
    input.name.trim().toLowerCase(),
  ].join(':');
}

export function readAtlasTripPicks(store: PickStorage | null = browserStorage()): AtlasTripPick[] {
  try {
    const raw = store?.getItem(ATLAS_TRIP_PICKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AtlasTripPick =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as AtlasTripPick).id === 'string' &&
          typeof (item as AtlasTripPick).countryCode === 'string' &&
          typeof (item as AtlasTripPick).name === 'string',
      )
      .slice(0, ATLAS_MAX_TRIP_PICKS);
  } catch {
    return [];
  }
}

export function writeAtlasTripPicks(
  picks: readonly AtlasTripPick[],
  store: PickStorage | null = browserStorage(),
) {
  try {
    if (picks.length === 0) {
      store?.removeItem(ATLAS_TRIP_PICKS_KEY);
    } else {
      store?.setItem(ATLAS_TRIP_PICKS_KEY, JSON.stringify(picks.slice(0, ATLAS_MAX_TRIP_PICKS)));
    }
  } catch {
    // Blocked or full local storage leaves picks in memory for the current session.
  }
}

export function addAtlasTripPick(
  current: readonly AtlasTripPick[],
  input: AtlasTripPickInput,
  now = Date.now(),
): { added: boolean; picks: AtlasTripPick[]; reason?: 'duplicate' | 'limit' } {
  const id = atlasPickId(input);
  if (current.some((pick) => pick.id === id)) {
    return { added: false, picks: [...current], reason: 'duplicate' };
  }
  if (current.length >= ATLAS_MAX_TRIP_PICKS) {
    return { added: false, picks: [...current], reason: 'limit' };
  }
  return {
    added: true,
    picks: [...current, { ...input, addedAt: now, id }],
  };
}

export function removeAtlasTripPick(
  current: readonly AtlasTripPick[],
  id: string,
): AtlasTripPick[] {
  return current.filter((pick) => pick.id !== id);
}

export type AtlasPickGroup = {
  countryCode: string;
  countryName: string;
  destinationName: string;
  destinationSlug: string;
  key: string;
  picks: AtlasTripPick[];
};

export function groupAtlasTripPicks(picks: readonly AtlasTripPick[]): AtlasPickGroup[] {
  const groups = new Map<string, AtlasPickGroup>();
  for (const pick of picks) {
    const key = `${pick.countryCode}:${pick.destinationSlug || 'country'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.picks.push(pick);
    } else {
      groups.set(key, {
        countryCode: pick.countryCode,
        countryName: pick.countryName,
        destinationName: pick.destinationName,
        destinationSlug: pick.destinationSlug,
        key,
        picks: [pick],
      });
    }
  }
  return [...groups.values()];
}

export function atlasPickCategory(kind: AtlasListingKind): TrovePlaceCategory {
  switch (kind) {
    case 'eat':
    case 'drink':
      return 'food_and_drink';
    case 'sleep':
      return 'stay';
    case 'buy':
      return 'shopping';
    case 'go':
      return 'transport';
    case 'see':
    case 'do':
      return 'things_to_do';
    default:
      return 'other';
  }
}

function formatIsoDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addIsoDays(isoDate: string, days: number) {
  const [y = 2026, m = 1, d = 1] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return formatIsoDate(next);
}

/**
 * PRD 40.4 setup defaults: start on the first Friday at least 14 days ahead in
 * the main destination's next Great month (falling back to Good, then any Friday
 * ≥ 14 days ahead); length from picks at a balanced pace (3–14 days).
 */
export function suggestAtlasTripDates(
  months: readonly AtlasMonthClimate[] | null | undefined,
  pickCount: number,
  today: Date = new Date(),
): { days: number; endDate: string; startDate: string } {
  const earliest = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 14),
  );
  const days = Math.min(14, Math.max(3, Math.ceil(Math.max(1, pickCount) / 3) + 1));

  const findFirstFridayInTarget = (targetRating: 'great' | 'good'): Date | null => {
    if (!months?.length) return null;
    const qualifying = new Set(months.filter((m) => m.rating === targetRating).map((m) => m.month));
    if (qualifying.size === 0) return null;

    for (let offset = 0; offset < 14; offset += 1) {
      const monthStart = new Date(
        Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth() + offset, 1),
      );
      const calendarMonth = monthStart.getUTCMonth() + 1;
      if (!qualifying.has(calendarMonth)) continue;

      const candidate = offset === 0 && earliest > monthStart ? new Date(earliest) : monthStart;
      // Advance to Friday (5) while staying in the same calendar month.
      const daysUntilFriday = (5 - candidate.getUTCDay() + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() + daysUntilFriday);
      if (candidate.getUTCMonth() === monthStart.getUTCMonth()) return candidate;
    }
    return null;
  };

  let start = findFirstFridayInTarget('great') ?? findFirstFridayInTarget('good');
  if (!start) {
    start = new Date(earliest);
    const daysUntilFriday = (5 - start.getUTCDay() + 7) % 7;
    start.setUTCDate(start.getUTCDate() + daysUntilFriday);
  }

  const startDate = formatIsoDate(start);
  const endDate = addIsoDays(startDate, days - 1);
  return { days, endDate, startDate };
}

/** Formats Wikivoyage attribution for an applied trip (PRD 40.4). */
export function atlasTripAttribution(picks: readonly AtlasTripPick[]) {
  const guides = [...new Set(picks.map((pick) => pick.guideTitle).filter(Boolean))];
  if (guides.length === 0) return 'Based on Wikivoyage Atlas guides (CC BY-SA 4.0).';
  return `Based on Wikivoyage's ${guides.join(', ')} guide (CC BY-SA 4.0).`;
}

/** Composes a natural Plan with AI brief carrying all picks as Must Go places. */
export function buildAtlasAiPrompt(
  picks: readonly AtlasTripPick[],
  dates: { days: number; endDate: string; startDate: string },
) {
  const groups = groupAtlasTripPicks(picks);
  const destinations = groups
    .map((group) =>
      group.destinationSlug ? `${group.destinationName}, ${group.countryName}` : group.countryName,
    )
    .join(' and ');
  const mustGo = picks.map((pick) => pick.name).join(', ');
  return `Plan a ${dates.days}-day trip to ${destinations} from ${dates.startDate} to ${dates.endDate}. Must-go places: ${mustGo}.`;
}
