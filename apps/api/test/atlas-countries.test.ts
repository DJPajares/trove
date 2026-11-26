import { describe, expect, it } from 'vitest';

import {
  getAtlasIndex,
  toAtlasIndex,
  type AtlasCountryRow,
} from '../src/services/atlas-countries.js';

const norms = Array.from({ length: 12 }, (_, index) => ({
  month: index + 1,
  temperatureMaxC: index < 6 ? 22 : 35,
  temperatureMinC: 12,
  wetDayShare: index < 6 ? 0.1 : 0.8,
}));

function row(overrides: Partial<AtlasCountryRow> = {}): AtlasCountryRow {
  return {
    climate: norms,
    climateCity: 'Somewhere',
    climateYearFrom: 2021,
    climateYearTo: 2025,
    countryCode: 'JP',
    latitude: { toNumber: () => 35.68 },
    longitude: { toNumber: () => 139.69 },
    region: 'asia',
    wikivoyageTitle: 'Japan',
    ...overrides,
  };
}

describe('toAtlasIndex', () => {
  it('derives month ratings from the stored conditions when serving them', () => {
    const index = toAtlasIndex([row()]);
    expect(index.climateYears).toEqual({ from: 2021, to: 2025 });
    expect(index.countries[0]).toMatchObject({ countryCode: 'JP', latitude: 35.68 });
    expect(index.countries[0]?.months?.[0]?.rating).toBe('great');
    expect(index.countries[0]?.months?.[6]?.rating).toBe('off');
  });

  it('serves a country without a usable pattern, but never an invented one', () => {
    const index = toAtlasIndex([
      row({ climate: [{ month: 1 }] }),
      row({ climate: null, countryCode: 'FR' }),
    ]);
    expect(index.countries.map((country) => country.months)).toEqual([null, null]);
    expect(index.climateYears).toBeNull();
  });

  it('leaves out a row with a region Atlas does not browse by', () => {
    expect(toAtlasIndex([row({ region: 'antarctica' })]).countries).toEqual([]);
  });
});

it('reads the shared rows from the given store', async () => {
  let reads = 0;
  const store = {
    list: async () => {
      reads += 1;
      return [row()];
    },
  };
  const index = await getAtlasIndex({ store });
  expect(index.countries).toHaveLength(1);
  expect(reads).toBe(1);
});
