import { getPrismaClient } from '@trove/db';
import {
  ATLAS_REGIONS,
  rateAtlasClimate,
  type AtlasClimateNorm,
  type AtlasIndex,
  type AtlasIndexEntry,
  type AtlasRegion,
} from '@trove/types';

/**
 * Atlas's countries (PRD 40): shared reference data kept permanently in
 * Trove's database and changed only by `atlas:sync`. Every reader asks for the
 * same rows, so one answer is held in memory for a few minutes rather than
 * read again for each request.
 */
const MEMORY_MS = 10 * 60 * 1_000;

export type AtlasCountryRow = {
  climate: unknown;
  climateCity: string;
  climateYearFrom: number | null;
  climateYearTo: number | null;
  countryCode: string;
  latitude: { toNumber(): number } | number;
  longitude: { toNumber(): number } | number;
  region: string;
  wikivoyageTitle: string;
};

export type AtlasCountryStore = {
  list(): Promise<AtlasCountryRow[]>;
};

let memory: { at: number; index: AtlasIndex } | null = null;

export function resetAtlasCountryMemory() {
  memory = null;
}

function prismaStore(): AtlasCountryStore {
  return {
    list: () => getPrismaClient().atlasCountry.findMany({ orderBy: { countryCode: 'asc' } }),
  };
}

const toNumber = (value: { toNumber(): number } | number) =>
  typeof value === 'number' ? value : value.toNumber();

function isNorms(value: unknown): value is AtlasClimateNorm[] {
  return (
    Array.isArray(value) &&
    value.length === 12 &&
    value.every(
      (norm, index) =>
        norm &&
        typeof norm === 'object' &&
        (norm as AtlasClimateNorm).month === index + 1 &&
        typeof (norm as AtlasClimateNorm).temperatureMaxC === 'number' &&
        typeof (norm as AtlasClimateNorm).temperatureMinC === 'number' &&
        typeof (norm as AtlasClimateNorm).wetDayShare === 'number',
    )
  );
}

export function toAtlasIndex(rows: readonly AtlasCountryRow[]): AtlasIndex {
  let climateYears: AtlasIndex['climateYears'] = null;
  const countries = rows.flatMap((row): AtlasIndexEntry[] => {
    if (!ATLAS_REGIONS.includes(row.region as AtlasRegion)) return [];
    const months = isNorms(row.climate) ? rateAtlasClimate(row.climate) : null;
    if (months && row.climateYearFrom && row.climateYearTo && !climateYears) {
      climateYears = { from: row.climateYearFrom, to: row.climateYearTo };
    }
    return [
      {
        climateCity: row.climateCity,
        countryCode: row.countryCode,
        latitude: toNumber(row.latitude),
        longitude: toNumber(row.longitude),
        months,
        region: row.region as AtlasRegion,
        wikivoyageTitle: row.wikivoyageTitle,
      },
    ];
  });
  return { climateYears, countries };
}

export async function getAtlasIndex(
  options: { now?: () => Date; store?: AtlasCountryStore } = {},
): Promise<AtlasIndex> {
  const now = (options.now?.() ?? new Date()).getTime();
  if (!options.store && memory && now - memory.at < MEMORY_MS) return memory.index;
  const index = toAtlasIndex(await (options.store ?? prismaStore()).list());
  if (!options.store) memory = { at: now, index };
  return index;
}

export async function getAtlasCountry(
  countryCode: string,
  options: { now?: () => Date; store?: AtlasCountryStore } = {},
) {
  const index = await getAtlasIndex(options);
  return index.countries.find((country) => country.countryCode === countryCode) ?? null;
}
