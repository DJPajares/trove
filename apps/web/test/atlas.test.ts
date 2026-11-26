import { atlasMonthRating, type AtlasMonthClimate } from '@trove/types';
import { describe, expect, it } from 'vitest';

import {
  atlasCountries,
  bestForMonth,
  greatMonthRuns,
  matchesAtlasQuery,
  nextMonth,
  type AtlasCountry,
} from '@/lib/atlas';
import { formatMonthRuns, wetDaysInTen } from '@/lib/atlas/format';

function country(code: string, ratings: AtlasMonthClimate['rating'][]): AtlasCountry {
  return {
    climateCity: 'City',
    countryCode: code,
    latitude: 0,
    longitude: 0,
    months: ratings.map((rating, index) => ({
      month: index + 1,
      rating,
      temperatureMaxC: 20,
      temperatureMinC: 10,
      wetDayShare: 0.2,
    })),
    name: code,
    region: 'europe',
    wikivoyageTitle: code,
  };
}

describe('atlasMonthRating', () => {
  it('rates mild months in the place’s dry season great', () => {
    expect(atlasMonthRating({ temperatureMaxC: 22, wetDayShare: 0.25 }, 0.2)).toBe('great');
  });

  it('judges rain against the place’s own driest month, so a tropical dry season still shines', () => {
    expect(atlasMonthRating({ temperatureMaxC: 30, wetDayShare: 0.65 }, 0.65)).toBe('great');
    expect(atlasMonthRating({ temperatureMaxC: 30, wetDayShare: 0.9 }, 0.1)).toBe('mixed');
  });

  it('marks heat and the wet season down, never up', () => {
    expect(atlasMonthRating({ temperatureMaxC: 37, wetDayShare: 0.1 }, 0.1)).toBe('mixed');
    expect(atlasMonthRating({ temperatureMaxC: 34, wetDayShare: 0.8 }, 0.05)).toBe('off');
  });

  it('treats a freezing month as off-season', () => {
    expect(atlasMonthRating({ temperatureMaxC: -6, wetDayShare: 0.3 }, 0.3)).toBe('off');
  });
});

describe('greatMonthRuns', () => {
  it('keeps a run across the new year whole', () => {
    const ratings = Array<AtlasMonthClimate['rating']>(12).fill('mixed');
    ratings[0] = 'great';
    ratings[11] = 'great';
    ratings[4] = 'great';
    expect(greatMonthRuns(country('XX', ratings))).toEqual([[5], [12, 1]]);
  });

  it('formats runs as short month ranges', () => {
    expect(formatMonthRuns([[4, 5], [10]], 'en')).toBe('Apr–May, Oct');
  });
});

describe('bestForMonth', () => {
  it('splits great from good and leaves the rest out', () => {
    const great = country('AA', Array(12).fill('great'));
    const good = country('BB', Array(12).fill('good'));
    const off = country('CC', Array(12).fill('off'));
    const result = bestForMonth([great, good, off], 3, 2027);
    expect(result.great.map((c) => c.countryCode)).toEqual(['AA']);
    expect(result.good.map((c) => c.countryCode)).toEqual(['BB']);
  });

  it('keeps one order for a month, so the page does not reshuffle on every visit', () => {
    const list = ['AA', 'BB', 'CC', 'DD'].map((code) => country(code, Array(12).fill('great')));
    expect(bestForMonth(list, 6, 2027).great).toEqual(
      bestForMonth([...list].reverse(), 6, 2027).great,
    );
  });
});

describe('atlasCountries', () => {
  it('names every country in the reader’s locale and finds it ignoring accents', () => {
    const countries = atlasCountries([country('JP', []), country('CI', [])], 'en');
    expect(countries.find((c) => c.countryCode === 'JP')?.name).toBe('Japan');
    const ivory = countries.find((c) => c.countryCode === 'CI');
    expect(ivory && matchesAtlasQuery(ivory, 'cote')).toBe(true);
  });
});

it('describes rain without claiming more precision than a pattern has', () => {
  expect(wetDaysInTen(0.34)).toBe(3);
  expect(nextMonth(new Date(2026, 11, 5))).toBe(1);
});
