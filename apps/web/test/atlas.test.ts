import {
  atlasMonthRating,
  type AtlasListingKind,
  type AtlasMonthClimate,
  type AtlasSection,
} from '@trove/types';
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
import { atlasGuidePlaces, atlasTripPlaces } from '@/lib/atlas/picks';
import { townAtlasGuide } from '@/lib/atlas/trip-guides';
import { extractListCards, parseNamedListItem } from '@/lib/atlas/cards';
import {
  ATLAS_MAX_TRIP_PICKS,
  addAtlasTripPick,
  atlasPickCategory,
  atlasTripAttribution,
  buildAtlasAiPrompt,
  groupAtlasTripPicks,
  suggestAtlasTripDates,
} from '@/lib/atlas/picks';
import { ATLAS_THEMES, countriesForTheme, pickSurpriseCountry } from '@/lib/atlas/themes';

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

describe('extractListCards', () => {
  it('turns Wikivoyage "Name — description" lists into structured field-guide cards', () => {
    expect(
      extractListCards([
        'Bangkok — Thailand’s bustling capital on the Chao Phraya.',
        'Chiang Mai — Mountain cultural hub in the north.',
      ]),
    ).toEqual([
      { detail: 'Thailand’s bustling capital on the Chao Phraya.', title: 'Bangkok' },
      { detail: 'Mountain cultural hub in the north.', title: 'Chiang Mai' },
    ]);
  });

  it('supports colon-separated dish lists without splitting sentences', () => {
    expect(parseNamedListItem('Pad Thai: stir-fried rice noodles with tamarind')).toEqual({
      detail: 'stir-fried rice noodles with tamarind',
      title: 'Pad Thai',
    });
    expect(parseNamedListItem('Keep valuables close. Never leave bags unattended.')).toBeNull();
  });

  it('leaves ordinary prose bullet lists as plain bullets', () => {
    expect(
      extractListCards([
        'Pack light breathable clothes for the lowlands.',
        'Carry small bills for street markets and local buses.',
      ]),
    ).toBeNull();
  });
});

describe('Atlas trip picks (PRD 40.4)', () => {
  const samplePick = (index: number) => ({
    address: null,
    countryCode: 'PH',
    countryName: 'Philippines',
    destinationName: 'Bohol',
    destinationSlug: 'bohol',
    guideTitle: 'Bohol',
    kind: 'see' as const,
    latitude: 9.85,
    longitude: 124.14,
    name: `Spot ${index}`,
  });

  it('deduplicates picks and enforces the 24-pick tray limit', () => {
    let picks = addAtlasTripPick([], samplePick(1)).picks;
    const dup = addAtlasTripPick(picks, samplePick(1));
    expect(dup.added).toBe(false);
    expect(dup.reason).toBe('duplicate');

    for (let i = 2; i <= ATLAS_MAX_TRIP_PICKS; i += 1) {
      picks = addAtlasTripPick(picks, samplePick(i)).picks;
    }
    expect(picks).toHaveLength(ATLAS_MAX_TRIP_PICKS);

    const overflow = addAtlasTripPick(picks, samplePick(25));
    expect(overflow.added).toBe(false);
    expect(overflow.reason).toBe('limit');
  });

  it('suggests the first Friday at least 14 days ahead in the next Great month', () => {
    const months = Array.from({ length: 12 }, (_, idx) => ({
      month: idx + 1,
      rating: idx + 1 === 2 ? ('great' as const) : ('off' as const),
      temperatureMaxC: 28,
      temperatureMinC: 22,
      wetDayShare: 0.1,
    }));
    const suggested = suggestAtlasTripDates(months, 6, new Date('2026-11-26T00:00:00Z'));
    // First Friday in February 2027 is 2027-02-05.
    expect(suggested.startDate).toBe('2027-02-05');
    expect(suggested.days).toBe(3);
    expect(suggested.endDate).toBe('2027-02-07');
  });

  it('maps listing kinds to Trove categories, groups picks, and formats attribution and AI prompt', () => {
    expect(atlasPickCategory('eat')).toBe('food_and_drink');
    expect(atlasPickCategory('sleep')).toBe('stay');
    expect(atlasPickCategory('see')).toBe('things_to_do');

    const picks = addAtlasTripPick([], samplePick(1)).picks;
    expect(groupAtlasTripPicks(picks)).toHaveLength(1);
    expect(atlasTripAttribution(picks)).toContain("Based on Wikivoyage's Bohol guide");
    expect(
      buildAtlasAiPrompt(picks, { days: 4, endDate: '2027-02-08', startDate: '2027-02-05' }),
    ).toContain('Must-go places: Spot 1');
  });
});

describe('Atlas themes and Surprise me (PRD 40.2)', () => {
  it('resolves curated theme countries against the loaded index in curated order', () => {
    const sample = [country('PH', []), country('JP', []), country('IT', []), country('ZZ', [])];
    const food = countriesForTheme(sample, 'food');
    expect(food.map((entry) => entry.countryCode)).toEqual(['JP', 'IT', 'PH']);
    expect(ATLAS_THEMES).toEqual(['food', 'nature', 'cities', 'coast', 'festivals']);
  });

  it('picks a valid country for Surprise me and returns null when empty', () => {
    expect(pickSurpriseCountry([])).toBeNull();
    const sample = [country('JP', []), country('PH', []), country('IS', [])];
    expect(pickSurpriseCountry(sample, () => 0)?.countryCode).toBe('JP');
    expect(pickSurpriseCountry(sample, () => 0.5)?.countryCode).toBe('PH');
    expect(pickSurpriseCountry(sample, () => 1)?.countryCode).toBe('IS');
  });
});

describe('townAtlasGuide', () => {
  const guides = [
    {
      countryCode: 'PH',
      destinations: [
        {
          kind: 'destination' as const,
          name: 'Bohol',
          slug: 'bohol',
          summary: null,
          wikivoyageTitle: 'Bohol',
        },
        {
          kind: 'city' as const,
          name: 'Cebu City',
          slug: 'cebu-city',
          summary: null,
          wikivoyageTitle: 'Cebu City',
        },
        {
          kind: 'region' as const,
          name: 'Visayas',
          slug: 'visayas',
          summary: null,
          wikivoyageTitle: 'Visayas',
        },
      ],
    },
  ];

  it('links a town to the destination guide of the same name', () => {
    expect(townAtlasGuide('Bohol, Philippines', guides)).toEqual({
      countryCode: 'PH',
      href: '/atlas/PH/bohol',
      kind: 'destination',
      name: 'Bohol',
    });
    expect(townAtlasGuide('cebu city', guides)?.href).toBe('/atlas/PH/cebu-city');
  });

  it('never links a near miss', () => {
    expect(townAtlasGuide('Cebu', guides)).toBeNull();
    expect(townAtlasGuide('Bohol Sea', guides)).toBeNull();
  });
});

describe('atlasGuidePlaces', () => {
  const context = {
    countryCode: 'PH',
    countryName: 'Philippines',
    destinationName: 'El Nido',
    destinationSlug: 'el-nido',
    guideTitle: 'El Nido',
  };
  const listing = (kind: AtlasListingKind, name: string) => ({
    type: 'listing' as const,
    listing: {
      address: null,
      alt: null,
      content: null,
      kind,
      latitude: null,
      longitude: null,
      name,
    },
  });
  const sections: AtlasSection[] = [
    {
      blocks: [listing('sleep', 'Hostel'), listing('eat', 'Trattoria')],
      id: 'sleep',
      title: 'Sleep',
    },
    {
      blocks: [listing('see', 'Big Lagoon'), listing('do', 'Island hopping')],
      id: 'see',
      title: 'See',
    },
    {
      blocks: [listing('drink', 'Bar'), listing('see', 'Big Lagoon')],
      id: 'drink',
      title: 'Drink',
    },
  ];

  it('orders See, Do, Eat, Drink, skips Sleep and duplicates', () => {
    expect(atlasGuidePlaces(sections, context).map((place) => place.name)).toEqual([
      'Big Lagoon',
      'Island hopping',
      'Trattoria',
      'Bar',
    ]);
  });

  it('skips what the picks already carry and keeps the trip within 24 places', () => {
    const [lagoon] = atlasGuidePlaces(sections, context);
    expect(atlasGuidePlaces(sections, context, [lagoon!]).map((place) => place.name)).not.toContain(
      'Big Lagoon',
    );
    const many = Array.from({ length: 23 }, (_, index) => ({ ...lagoon!, id: `pick-${index}` }));
    expect(atlasGuidePlaces(sections, context, many)).toHaveLength(1);
  });
});

describe('atlasTripPlaces', () => {
  const pick = (name: string, kind: AtlasListingKind = 'do') => ({
    addedAt: 0,
    address: null,
    countryCode: 'PH',
    countryName: 'Philippines',
    destinationName: 'El Nido',
    destinationSlug: 'el-nido',
    guideTitle: 'El Nido',
    id: name,
    kind,
    latitude: null,
    longitude: null,
    name,
  });

  it('puts picks first as Must Go and the guide’s places after as Interested', () => {
    expect(atlasTripPlaces([pick('Pick')], [pick('Cafe', 'eat')])).toEqual([
      {
        category: 'things_to_do',
        latitude: null,
        longitude: null,
        name: 'Pick',
        priority: 'must_go',
      },
      {
        category: 'food_and_drink',
        latitude: null,
        longitude: null,
        name: 'Cafe',
        priority: 'interested',
      },
    ]);
  });

  it('never sends more than 24 places', () => {
    const many = Array.from({ length: 30 }, (_, index) => pick(`P${index}`));
    expect(atlasTripPlaces(many.slice(0, 10), many.slice(10))).toHaveLength(24);
  });
});
