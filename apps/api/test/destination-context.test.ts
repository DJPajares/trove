import { readFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import {
  destinationContextMessages,
  destinationContextRecordSchema,
  type DestinationContextRecord,
} from '@trove/types';
import {
  DESTINATION_CONTEXT_RECORDS,
  DESTINATION_CONTEXT_VERSION,
} from '../src/data/destination-context.js';
import {
  contextPlaceFromOwnedData,
  matchContextDestination,
  resolveDestinationContext,
  destinationContextRevision,
  destinationContextForAi,
  readOwnedTripDestinationContext,
  type ContextPlace,
} from '../src/services/destination-context.js';
import { readPlanScoreInputs, type PlanScoreTripRows } from '../src/services/plan-score.js';
import { buildAiPlannerContext, buildAiPlannerPrompt } from '../src/services/ai-planner-prompt.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const singapore = { name: 'Singapore', coordinates: { latitude: 1.3, longitude: 103.85 } };
const tokyo = { name: 'Tokyo', coordinates: { latitude: 35.68, longitude: 139.76 } };
const kyoto = { name: 'Kyoto', coordinates: { latitude: 35.01, longitude: 135.77 } };
const oneNorth = { name: 'one-north Park', coordinates: { latitude: 1.3, longitude: 103.79 } };
const resolve = (
  date: string,
  place: ContextPlace,
  now = NOW,
  catalog = DESTINATION_CONTEXT_RECORDS,
) =>
  resolveDestinationContext(
    {
      startDate: date,
      endDate: date,
      destinations: [place],
      days: [{ id: 'day', date, places: [place] }],
    },
    now,
    catalog,
  );
const ids = (context: ReturnType<typeof resolve>) =>
  context.overview.flatMap((group) => group.records.map((record) => record.id));
afterEach(() => vi.unstubAllGlobals());

test('every authored record validates, has official provenance and shared localized copy', () => {
  const keys = new Set(Object.keys(destinationContextMessages.en.records));
  expect(new Set(DESTINATION_CONTEXT_RECORDS.map((record) => record.id)).size).toBe(
    DESTINATION_CONTEXT_RECORDS.length,
  );
  for (const record of DESTINATION_CONTEXT_RECORDS) {
    expect(destinationContextRecordSchema.safeParse(record).success).toBe(true);
    expect(keys.has(record.contentKey)).toBe(true);
    expect(new URL(record.sourceUrl).hostname).toMatch(
      /(?:visitsingapore\.com|weather\.gov\.sg|nparks\.gov\.sg|gotokyo\.org|fng\.or\.jp|kyoto\.travel|mom\.gov\.sg|www8\.cao\.go\.jp)$/,
    );
  }
});

test('exact aliases and coordinates match, while ambiguity and unsupported destinations stay unknown', () => {
  expect([singapore, tokyo, kyoto].map(matchContextDestination)).toEqual([
    'singapore',
    'tokyo',
    'kyoto',
  ]);
  expect(matchContextDestination({ name: '京都市' })).toBe('kyoto');
  expect(matchContextDestination({ name: 'Tokyo', coordinates: kyoto.coordinates })).toBeNull();
  expect(matchContextDestination({ name: 'Tokyo Disneyland' })).toBeNull();
  expect(matchContextDestination({ name: 'Paris' })).toBeNull();
  expect(
    matchContextDestination({ name: 'Tokyo', coordinates: { latitude: NaN, longitude: 139 } }),
  ).toBeNull();
  expect(resolve('2026-11-01', { name: 'Paris' }).overview).toEqual([]);
});

test('days use their actual stops/bases, never every destination in a multi-city trip', () => {
  const context = resolveDestinationContext(
    {
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      destinations: [tokyo, kyoto],
      days: [
        { id: 'tokyo-day', date: '2026-11-01', places: [tokyo] },
        { id: 'transfer-day', date: '2026-11-02', places: [tokyo, kyoto] },
        { id: 'unknown-day', date: '2026-11-03', places: [] },
      ],
    },
    NOW,
  );
  expect(context.overview.map((group) => group.destination)).toEqual(['tokyo', 'kyoto']);
  expect(context.days.map((day) => day.groups.map((group) => group.destination))).toEqual([
    ['tokyo'],
    ['tokyo', 'kyoto'],
    [],
  ]);
});

test('recurring seasons span New Year and use local trip dates, not evaluation month', () => {
  expect(ids(resolve('2027-01-15', singapore))).toContain('singapore.singaporeWet');
  expect(ids(resolve('2027-02-01', singapore))).not.toContain('singapore.singaporeWet');
  expect(ids(resolve('2027-06-15', kyoto))).toContain('kyoto.kyotoRain');
  expect(ids(resolve('2027-07-16', kyoto))).not.toContain('kyoto.kyotoRain');
  expect(ids(resolve('2027-11-01', tokyo))).toContain('tokyo.tokyoAutumn');
});

test('review freshness uses now, not future trip date, and expiry excludes records exactly at deadline', () => {
  expect(ids(resolve('2027-11-01', tokyo))).toContain('tokyo.tokyoAutumn');
  expect(ids(resolve('2026-11-01', tokyo, new Date('2026-12-27T00:00:00Z')))).not.toContain(
    'tokyo.tokyoAutumn',
  );
  expect(resolve('2027-11-01', tokyo, new Date('2028-01-01')).overview).toEqual([]);
  expect(resolve('2026-11-01', tokyo, new Date('2026-09-27')).overview).toEqual([]);
});

test('holiday evidence matches exact dates without inferring holiday closures or extrapolating years', () => {
  const holiday = resolve('2027-05-03', tokyo).overview[0]!.records.find(
    (record) => record.kind === 'holiday',
  );
  expect(holiday?.matchedDates).toEqual(['2027-05-03']);
  expect(ids(resolve('2027-05-02', tokyo))).not.toContain('tokyo.holidays.2027');
  expect(ids(resolve('2028-05-03', tokyo))).not.toContain('tokyo.holidays.2027');
  expect(
    resolve('2027-05-03', tokyo).overview[0]!.records.some((record) => record.kind === 'closure'),
  ).toBe(false);
});

test('partial closure requires the venue and stated dates, and expires at local midnight', () => {
  expect(
    resolve('2026-11-01', oneNorth).overview[0]!.records.find((record) => record.kind === 'closure')
      ?.accessEffect,
  ).toBe('partial_restriction');
  expect(ids(resolve('2026-11-01', singapore))).not.toContain('singapore.oneNorthClosure');
  expect(ids(resolve('2026-11-01', oneNorth))).toContain('singapore.oneNorthClosure');
  expect(ids(resolve('2027-04-01', oneNorth))).not.toContain('singapore.oneNorthClosure');
  expect(ids(resolve('2027-03-31', oneNorth, new Date('2027-03-31T15:59:59Z')))).toContain(
    'singapore.oneNorthClosure',
  );
  expect(ids(resolve('2027-03-31', oneNorth, new Date('2027-03-31T16:00:00Z')))).not.toContain(
    'singapore.oneNorthClosure',
  );
});

test('itinerary context immediately reuses the already-fetched snapshot without renewing its age', () => {
  const snapshot = {
    externalPlaceId: 'cafe',
    cachedAt: NOW,
    cachedLatitude: 35.68,
    cachedLongitude: 139.76,
    cachedName: 'Cafe',
  };
  const trip = {
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-01'),
    destinations: [],
    tripPlaces: [{ id: 'tp', place: { providerRefs: [{ externalPlaceId: 'cafe' }] } }],
    itineraryDays: [
      {
        id: 'day',
        date: new Date('2026-11-01'),
        dailyBaseTripPlaceId: 'tp',
        dailyBaseDepartureTripPlaceId: null,
        items: [],
      },
    ],
  };
  expect(readOwnedTripDestinationContext(trip, NOW).days[0]!.groups).toEqual([]);
  const context = readOwnedTripDestinationContext(trip, NOW, new Map([['cafe', snapshot]]));
  expect(context.days[0]!.groups[0]!.destination).toBe('tokyo');
  expect(context.expiresAt).toBe('2026-10-28T12:00:00.000Z');
  expect(snapshot.cachedAt).toBe(NOW);
});

test('schema prevents seasonal/demand patterns from becoming confirmed closures', () => {
  const pattern = DESTINATION_CONTEXT_RECORDS.find((record) => record.kind === 'season')!;
  expect(destinationContextRecordSchema.safeParse({ ...pattern, certainty: 'fact' }).success).toBe(
    false,
  );
  expect(destinationContextRecordSchema.safeParse({ ...pattern, kind: 'closure' }).success).toBe(
    false,
  );
  expect(
    destinationContextRecordSchema.safeParse({ ...pattern, expiresAt: '2027-01-01T00:00:00Z' })
      .success,
  ).toBe(false);
  const closure = DESTINATION_CONTEXT_RECORDS.find((record) => record.kind === 'closure')!;
  expect(
    destinationContextRecordSchema.safeParse({ ...closure, expiresAt: '2027-04-02T00:00:00Z' })
      .success,
  ).toBe(false);
});

test('interests order relevant opportunities without requiring attractions or treating mismatches as problems', () => {
  const input = {
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    destinations: [singapore],
    days: [],
  };
  const none = resolveDestinationContext(input, NOW);
  const nature = resolveDestinationContext(
    {
      ...input,
      preferences: {
        pace: null,
        interests: ['nature_scenery'],
        unmatchedInterests: ['spaceships'],
      },
    },
    NOW,
  );
  expect(nature.overview[0]!.records[0]!.id).toBe('singapore.singaporeGreen');
  expect(new Set(ids(nature))).toEqual(new Set(ids(none)));
  expect(nature.overview[0]!.records.every((record) => !('penalty' in record))).toBe(true);
});

test('missing, expired or future cached location stays unknown and no read renews its age', () => {
  const place = {
    providerRefs: [
      { cachedAt: NOW, cachedName: 'Cafe', cachedLatitude: 35.68, cachedLongitude: 139.76 },
    ],
  };
  const owned = contextPlaceFromOwnedData(place, NOW);
  expect(owned.expiresAt).toBe('2026-10-28T12:00:00.000Z');
  expect(matchContextDestination(owned)).toBe('tokyo');
  expect(contextPlaceFromOwnedData(place, new Date('2026-10-28T12:00:00Z')).coordinates).toBeNull();
  expect(contextPlaceFromOwnedData(place, new Date('2026-09-27')).coordinates).toBeNull();
  expect(matchContextDestination(contextPlaceFromOwnedData({}, NOW))).toBeNull();
});

test('revision changes on record edits/expiry but not on recomputation time', () => {
  const first = resolve('2026-11-01', tokyo);
  expect(destinationContextRevision(resolve('2026-11-01', tokyo, new Date('2026-09-29')))).toEqual(
    destinationContextRevision(first),
  );
  const changed = DESTINATION_CONTEXT_RECORDS.map((record) => ({
    ...record,
    revision: record.revision + 1,
  }));
  expect(destinationContextRevision(resolve('2026-11-01', tokyo, NOW, changed))).not.toEqual(
    destinationContextRevision(first),
  );
  expect(
    destinationContextRevision(resolve('2026-11-01', tokyo, new Date('2026-12-27'))),
  ).not.toEqual(destinationContextRevision(first));
});

test('the shared score input carries the same context and deterministic freshness digest', () => {
  const trip: PlanScoreTripRows = {
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-01'),
    destinations: [{ place: { customName: 'Tokyo' } }],
    reservations: [],
    tripPlaces: [],
    itineraryDays: [],
  };
  const input = readPlanScoreInputs(trip, NOW);
  expect(input.destinationContext.overview[0]?.destination).toBe('tokyo');
  expect(readPlanScoreInputs(trip, new Date('2026-09-29')).revision).toBe(input.revision);
  expect(readPlanScoreInputs(trip, new Date('2026-12-27')).revision).not.toBe(input.revision);
});

test('AI gets compact fresh sourced context in its existing prompt with date/scope constraints', () => {
  const ai = destinationContextForAi(NOW);
  expect(ai.catalogVersion).toBe(DESTINATION_CONTEXT_VERSION);
  expect(ai.records.some((record) => record.kind === 'closure' && record.scope.venueAliases)).toBe(
    true,
  );
  expect(destinationContextForAi(new Date('2028-01-01')).records).toEqual([]);
  expect(JSON.stringify(ai).length).toBeLessThan(18000);
  const prompt = buildAiPlannerPrompt(
    'Tokyo in November',
    buildAiPlannerContext({ generationDate: NOW, homeLocation: null }),
  );
  expect(prompt).toContain('matching destinations and applicable local trip dates');
  expect(prompt).toContain('not forecasts, closures');
});

test('context reads and unknown-data fallback perform zero provider requests', async () => {
  const fetch = vi.fn(() => {
    throw new Error('context must not acquire evidence');
  });
  vi.stubGlobal('fetch', fetch);
  resolve('2027-11-01', tokyo);
  resolve('2026-11-01', {});
  destinationContextForAi(NOW);
  expect(fetch).not.toHaveBeenCalled();
  const source = await readFile(
    new URL('../src/services/destination-context.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toMatch(
    /from ['"].*(?:places-runtime|place-data|weather-runtime|routes-runtime)/,
  );
});

test('unmatched or malformed applicability is quietly excluded', () => {
  const context = resolveDestinationContext(
    { startDate: 'bad', endDate: '2026-11-01', destinations: [tokyo], days: [] },
    NOW,
  );
  expect(context.overview).toEqual([]);
  const record = DESTINATION_CONTEXT_RECORDS[0]! as DestinationContextRecord;
  expect(resolve('2026-11-01', tokyo, NOW, [record]).overview).toEqual([]);
});
