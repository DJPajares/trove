import {
  destinationContextRecordSchema,
  type DestinationContextId,
  type DestinationContextRecord,
} from '@trove/types';

// Reviewed official sources, 2026-09-28. Update the version on any editorial,
// scope, or applicability change. No runtime fetching; overdue records disappear.
export const DESTINATION_CONTEXT_VERSION = '2026-09-28.1';
export const DESTINATION_CONTEXT_DESTINATIONS = {
  singapore: {
    aliases: ['singapore', 'singapore, singapore', '新加坡'],
    timeZone: 'Asia/Singapore',
    bounds: [1.18, 1.45, 103.62, 104.1],
  },
  tokyo: {
    aliases: ['tokyo', 'tokyo, japan', '東京', '東京都'],
    timeZone: 'Asia/Tokyo',
    bounds: [35.5, 35.9, 139.5, 139.95],
  },
  kyoto: {
    aliases: ['kyoto', 'kyoto, japan', '京都', '京都市'],
    timeZone: 'Asia/Tokyo',
    bounds: [34.94, 35.16, 135.6, 135.85],
  },
} as const;

const reviewedAt = '2026-09-28T00:00:00.000Z';
const expiresAt = '2026-12-27T00:00:00.000Z';
const singaporeClimate = 'https://www.weather.gov.sg/climate-climate-of-singapore/';
const tokyoAutumn = 'https://www.gotokyo.org/en/story/guide/autumn/';
const kyotoSeasons = 'https://kyoto.travel/en/seasonal-info/';
type EditorialInput = Pick<
  DestinationContextRecord,
  'contentKey' | 'kind' | 'interests' | 'sourceUrl'
> &
  Partial<
    Pick<
      DestinationContextRecord,
      'applicability' | 'certainty' | 'scope' | 'expiresAt' | 'accessEffect'
    >
  >;
function record(
  destination: DestinationContextId,
  input: EditorialInput,
): DestinationContextRecord {
  return destinationContextRecordSchema.parse({
    id: `${destination}.${input.contentKey}`,
    revision: 1,
    reviewedAt,
    expiresAt,
    scope: { destination },
    applicability: { kind: 'all_year' },
    certainty: 'fact',
    ...input,
  });
}
const season = (start: string, end: string) => ({ kind: 'season' as const, start, end });

// Exact government calendars are authored once, not calculated or scraped.
// Singapore's conditional Monday rest-day substitutions are not presented as
// unconditional venue holidays. The source link explains their applicability.
const holidayCalendars = {
  singapore: {
    2026: [
      '01-01',
      '02-17',
      '02-18',
      '03-21',
      '04-03',
      '05-01',
      '05-27',
      '05-31',
      '08-09',
      '11-08',
      '12-25',
    ],
    2027: [
      '01-01',
      '02-06',
      '02-07',
      '03-10',
      '03-26',
      '05-01',
      '05-17',
      '05-20',
      '08-09',
      '10-28',
      '12-25',
    ],
  },
  japan: {
    2026: [
      '01-01',
      '01-12',
      '02-11',
      '02-23',
      '03-20',
      '04-29',
      '05-03',
      '05-04',
      '05-05',
      '05-06',
      '07-20',
      '08-11',
      '09-21',
      '09-22',
      '09-23',
      '10-12',
      '11-03',
      '11-23',
    ],
    2027: [
      '01-01',
      '01-11',
      '02-11',
      '02-23',
      '03-21',
      '03-22',
      '04-29',
      '05-03',
      '05-04',
      '05-05',
      '07-19',
      '08-11',
      '09-20',
      '09-23',
      '10-11',
      '11-03',
      '11-23',
    ],
  },
};

export const DESTINATION_CONTEXT_RECORDS: readonly DestinationContextRecord[] = [
  record('singapore', {
    contentKey: 'singaporeHeritage',
    kind: 'experience',
    interests: ['culture_history', 'architecture', 'food_drink'],
    sourceUrl: 'https://www.visitsingapore.com/neighbourhood/featured-neighbourhood/',
  }),
  record('singapore', {
    contentKey: 'singaporeGreen',
    kind: 'experience',
    interests: ['nature_scenery', 'outdoor_activities', 'wellness_relaxation'],
    sourceUrl: 'https://www.visitsingapore.com/things-to-do/urban-wellness/green-spaces/',
  }),
  record('singapore', {
    contentKey: 'singaporeClimate',
    kind: 'season',
    certainty: 'tendency',
    interests: [],
    sourceUrl: singaporeClimate,
  }),
  record('singapore', {
    contentKey: 'singaporeWet',
    kind: 'season',
    certainty: 'tendency',
    interests: [],
    sourceUrl: singaporeClimate,
    applicability: season('11-01', '01-31'),
  }),
  record('singapore', {
    contentKey: 'singaporeStorms',
    kind: 'season',
    certainty: 'tendency',
    interests: [],
    sourceUrl: singaporeClimate,
    applicability: season('10-01', '11-30'),
  }),
  record('singapore', {
    contentKey: 'oneNorthClosure',
    kind: 'closure',
    accessEffect: 'partial_restriction',
    interests: [],
    sourceUrl: 'https://www.nparks.gov.sg/noticeboard',
    scope: {
      destination: 'singapore',
      areaKey: 'oneNorth',
      venueAliases: ['one-north park', 'one north park'],
    },
    applicability: { kind: 'dates', start: '2026-06-02', end: '2027-03-31' },
    expiresAt: '2027-03-31T16:00:00.000Z',
  }),
  record('tokyo', {
    contentKey: 'tokyoEast',
    kind: 'experience',
    interests: ['culture_history', 'shopping', 'architecture'],
    sourceUrl: 'https://www.gotokyo.org/en/destinations/eastern-tokyo/asakusa/',
  }),
  record('tokyo', {
    contentKey: 'tokyoAutumn',
    kind: 'season',
    certainty: 'tendency',
    interests: ['nature_scenery', 'outdoor_activities'],
    sourceUrl: tokyoAutumn,
    applicability: season('10-01', '11-30'),
  }),
  record('tokyo', {
    contentKey: 'tokyoAutumnDemand',
    kind: 'demand',
    certainty: 'tendency',
    interests: [],
    sourceUrl: tokyoAutumn,
    applicability: season('11-01', '11-30'),
  }),
  record('tokyo', {
    contentKey: 'tokyoGardenAccess',
    kind: 'access',
    interests: [],
    sourceUrl: 'https://fng.or.jp/shinjuku/en/',
    scope: {
      destination: 'tokyo',
      areaKey: 'shinjukuGyoen',
      venueAliases: ['shinjuku gyoen', 'shinjuku gyoen national garden', '新宿御苑'],
    },
  }),
  record('kyoto', {
    contentKey: 'kyotoAreas',
    kind: 'experience',
    interests: ['culture_history', 'nature_scenery', 'food_drink'],
    sourceUrl: 'https://kyoto.travel/en/areas',
  }),
  record('kyoto', {
    contentKey: 'kyotoSpring',
    kind: 'season',
    certainty: 'tendency',
    interests: ['nature_scenery', 'outdoor_activities'],
    sourceUrl: kyotoSeasons,
    applicability: season('03-01', '05-31'),
  }),
  record('kyoto', {
    contentKey: 'kyotoRain',
    kind: 'season',
    certainty: 'tendency',
    interests: [],
    sourceUrl: kyotoSeasons,
    applicability: season('06-01', '07-15'),
  }),
  record('kyoto', {
    contentKey: 'kyotoSummer',
    kind: 'season',
    certainty: 'tendency',
    interests: [],
    sourceUrl: kyotoSeasons,
    applicability: season('06-01', '08-31'),
  }),
  record('kyoto', {
    contentKey: 'kyotoAutumn',
    kind: 'season',
    certainty: 'tendency',
    interests: ['nature_scenery', 'outdoor_activities'],
    sourceUrl: kyotoSeasons,
    applicability: season('09-01', '11-30'),
  }),
  ...[season('03-01', '05-31'), season('09-01', '11-30')].map((applicability, index) => ({
    ...record('kyoto', {
      contentKey: 'kyotoDemand',
      kind: 'demand',
      certainty: 'tendency',
      interests: [],
      sourceUrl: 'https://kyoto.travel/en/areas',
      applicability,
    }),
    id: `kyoto.demand.${index}`,
  })),
  ...(['singapore', 'tokyo', 'kyoto'] as const).flatMap((destination) =>
    Object.entries(holidayCalendars[destination === 'singapore' ? 'singapore' : 'japan']).map(
      ([year, days]) => ({
        ...record(destination, {
          contentKey: 'publicHoliday',
          kind: 'holiday',
          interests: [],
          sourceUrl:
            destination === 'singapore'
              ? 'https://www.mom.gov.sg/employment-practices/public-holidays'
              : 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html',
          applicability: { kind: 'date_set', dates: days.map((day) => `${year}-${day}`) },
          expiresAt: `${year}-${days.at(-1)}T${destination === 'singapore' ? '16' : '15'}:00:00.000Z`,
        }),
        id: `${destination}.holidays.${year}`,
      }),
    ),
  ),
];
