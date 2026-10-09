import { expect, test } from 'vitest';

import type { ItineraryDay, ItineraryItem, ItineraryTripPlace } from '../lib/itinerary/api.ts';
import type { Trip } from '../lib/trips/api.ts';
import {
  dayHeaderPhotoSources,
  dayPhotoArea,
  dayPhotoCandidates,
  dayPhotoTheme,
  tripSecondaryImages,
  settleDayHeaderPhotos,
} from '../lib/media/day-header-photos.ts';
import {
  editorialCoverImage,
  editorialSubjectKey,
  type EditorialImageReference,
} from '../lib/media/editorial-images.ts';
import type { TripMediaSource } from '../lib/media/trip-media.ts';

const trip = {
  id: 'trip',
  countries: ['JP'],
  destinations: [{ name: 'Tokyo' }, { name: 'Kyoto' }],
} as Trip;
const local: TripMediaSource = {
  kind: 'local',
  src: { src: '/fallback.webp', width: 1280, height: 720 },
};

function photo(
  id: string,
  matchKind: EditorialImageReference['matchKind'] = 'exact',
): EditorialImageReference {
  return {
    externalPhotoId: id,
    sourceUrl: `https://images.example/${id}.jpg`,
    altText: null,
    dominantColor: null,
    width: 1280,
    height: 720,
    matchKind,
    attribution: {
      photographerName: 'Ada',
      photographerUrl: 'https://example.com/ada',
      providerName: 'pexels',
      providerPageUrl: `https://example.com/${id}`,
    },
  };
}

function stop(
  name: string,
  town = 'Tokyo',
  priority: ItineraryItem['priority'] = null,
): ItineraryItem {
  const tripPlace = {
    id: name,
    customName: null,
    priority: null,
    place: {
      id: name,
      kind: 'custom',
      name,
      providerAddress: `1 Main Rd, ${town}, Japan`,
      providerLabel: null,
    },
  } as ItineraryTripPlace;
  return { id: name, customLabel: null, priority, tripPlace } as ItineraryItem;
}

function day(items: ItineraryItem[] = [], name: string | null = null): ItineraryDay {
  return { id: 'day', name, items, dailyBaseTripPlaceId: null } as ItineraryDay;
}

test('empty days have no fabricated day-area signal and go directly to trip fallback', () => {
  expect(dayPhotoCandidates(day(), [], trip)).toEqual([]);
  expect(dayPhotoArea(day(), [])).toBeNull();
  expect(
    dayHeaderPhotoSources([], new Map(), [
      { kind: 'editorial', reference: photo('secondary') },
      local,
    ]),
  ).toEqual([{ kind: 'editorial', reference: photo('secondary') }, local]);
});

test('one stop supplies the photographic area, and stops outrank the overnight base', () => {
  const base = stop('Tokyo Hotel').tripPlace!;
  const planned = { ...day([stop('Fushimi Inari', 'Kyoto')]), dailyBaseTripPlaceId: base.id };
  expect(dayPhotoArea(planned, [base])).toBe('Kyoto');
});

test('a title naming a known stop uses its canonical photo and requests it once', () => {
  const candidates = dayPhotoCandidates(
    day([stop('Tokyo Tower'), stop('Sensoji', 'Tokyo', 'must_go')], 'Tokyo Tower at night'),
    [],
    trip,
  );
  expect(candidates[0]).toMatchObject({
    origin: 'title',
    subject: { name: 'Tokyo Tower', placeId: 'Tokyo Tower' },
  });
  expect(
    candidates.filter((candidate) => candidate.subject.placeId === 'Tokyo Tower'),
  ).toHaveLength(1);
  expect(candidates.length).toBeLessThanOrEqual(4);
});

test('grounded title themes lead, prominent stops follow, and generic titles do not search', () => {
  const candidates = dayPhotoCandidates(
    day([stop('First Cafe'), stop('Sensoji', 'Tokyo', 'must_go')], 'Markets and night lights'),
    [],
    trip,
  );
  expect(candidates.map((candidate) => candidate.origin)).toEqual([
    'title',
    'stop',
    'stop',
    'area',
  ]);
  expect(candidates[0]?.subject.context).toEqual({
    area: 'Tokyo',
    countryCode: 'JP',
    theme: 'market',
  });
  expect(candidates[1]?.subject.name).toBe('Sensoji');
  expect(dayPhotoCandidates(day([stop('Sensoji')], 'Day 1'), [], trip)[0]?.origin).toBe('stop');
  expect(dayPhotoTheme('Mum’s birthday')).toBeUndefined();
  expect(dayPhotoTheme('Night lights')).toBe('nightlife');
});

test('a theme without day geography is grounded only by a single trip destination', () => {
  expect(dayPhotoCandidates(day([], 'Markets'), [], trip)).toEqual([]);
  expect(
    dayPhotoCandidates(day([], 'Markets'), [], {
      ...trip,
      destinations: [trip.destinations[0]!],
    })[0]?.subject.context?.area,
  ).toBe('Tokyo');
  expect(dayPhotoCandidates(day([], 'Kyoto gardens'), [], trip)[0]?.subject.context).toMatchObject({
    area: 'Kyoto',
    theme: 'nature',
  });
});

test('generic day results are skipped and duplicate sources cannot repeat in a failure chain', () => {
  const candidates = dayPhotoCandidates(day([stop('Sensoji')], 'Night lights'), [], trip);
  const images = new Map(
    candidates.map((candidate, index) => [
      editorialSubjectKey(candidate.subject),
      [photo(String(index), index === 0 ? 'generic' : index === 1 ? 'exact' : 'contextual')],
    ]),
  );
  const sources = dayHeaderPhotoSources(candidates, images, [
    { kind: 'editorial', reference: photo('1') },
    { kind: 'editorial', reference: photo('secondary') },
    local,
  ]);
  expect(
    sources.map((source) =>
      source.kind === 'editorial' ? source.reference.externalPhotoId : source.kind,
    ),
  ).toEqual(['1', '2', 'secondary', 'local']);
});

test('primary and secondary roles are distinct and stable for exact and generic collections', () => {
  const exact = [photo('first'), photo('second'), photo('third')];
  expect(tripSecondaryImages(exact, trip.id).map((image) => image.externalPhotoId)).toEqual([
    'second',
    'third',
  ]);
  expect(
    tripSecondaryImages([photo('first')], trip.id, [photo('first'), photo('country')]).map(
      (image) => image.externalPhotoId,
    ),
  ).toEqual(['country']);
  const generic = exact.map((image) => ({ ...image, matchKind: 'generic' as const }));
  const primary = editorialCoverImage(generic, trip.id);
  expect(tripSecondaryImages(generic, trip.id)).not.toContain(primary);
  expect(tripSecondaryImages(generic, trip.id)).toEqual(tripSecondaryImages(generic, trip.id));
});

test('context identity distinguishes namesake areas, themes, and canonical Places', () => {
  const uk = { name: 'Cambridge', context: { area: 'Cambridge', countryCode: 'GB' } };
  expect(editorialSubjectKey(uk)).not.toBe(
    editorialSubjectKey({ ...uk, context: { area: 'Cambridge', countryCode: 'US' } }),
  );
  expect(editorialSubjectKey(uk)).not.toBe(
    editorialSubjectKey({ name: 'Cambridge', placeId: 'cambridge' }),
  );
  expect(editorialSubjectKey(uk)).not.toBe(
    editorialSubjectKey({ ...uk, context: { ...uk.context, theme: 'nightlife' } }),
  );
});

test('partial day results and a cached trip fallback stay hidden until the complete ladder settles', () => {
  const candidates = dayPhotoCandidates(day([stop('Sensoji')], 'Night lights'), [], trip);
  const fallbacks: TripMediaSource[] = [
    { kind: 'editorial', reference: photo('secondary') },
    local,
  ];
  const images = new Map([[editorialSubjectKey(candidates[1]!.subject), [photo('stop')]]]);
  const pending = settleDayHeaderPhotos(null, {
    photos: dayHeaderPhotoSources(candidates, images, fallbacks),
    isResolving: true,
    resolutionKey: 'day-1',
  });
  expect(pending.photos).toEqual([]);
  expect(pending.isResolving).toBe(true);

  images.set(editorialSubjectKey(candidates[0]!.subject), [photo('title', 'contextual')]);
  const resolved = settleDayHeaderPhotos(pending, {
    photos: dayHeaderPhotoSources(candidates, images, fallbacks),
    isResolving: false,
    resolutionKey: 'day-1',
  });
  expect(resolved.photos[0]).toEqual({
    kind: 'editorial',
    reference: photo('title', 'contextual'),
  });
});

test('an empty day waits for the secondary supplement instead of briefly showing the primary cover', () => {
  const primary: TripMediaSource = { kind: 'trip-cover', url: 'https://example.com/cover.jpg' };
  const pending = settleDayHeaderPhotos(null, {
    photos: [primary, local],
    isResolving: true,
    resolutionKey: 'empty-day',
  });
  expect(pending.photos).toEqual([]);
  const complete = settleDayHeaderPhotos(pending, {
    photos: [{ kind: 'editorial', reference: photo('country') }, primary, local],
    isResolving: false,
    resolutionKey: 'empty-day',
  });
  expect(complete.photos[0]).toEqual({ kind: 'editorial', reference: photo('country') });
});

test('a settled ladder survives rerenders and later row results, but a changed photo context resets it', () => {
  const settled = settleDayHeaderPhotos(null, {
    photos: [{ kind: 'editorial', reference: photo('chosen') }, local],
    isResolving: false,
    resolutionKey: 'day-1:title-a',
  });
  for (const isResolving of [true, false]) {
    expect(
      settleDayHeaderPhotos(settled, {
        photos: [{ kind: 'editorial', reference: photo('late-row-photo') }, local],
        isResolving,
        resolutionKey: settled.resolutionKey,
      }),
    ).toBe(settled);
  }
  for (const resolutionKey of ['day-2:title-a', 'day-1:title-b', 'other-trip:day-1']) {
    expect(
      settleDayHeaderPhotos(settled, { photos: settled.photos, isResolving: true, resolutionKey }),
    ).toEqual({
      photos: [],
      isResolving: true,
      resolutionKey,
    });
  }
});

test('confirmed misses publish the existing fallback ladder only after resolution finishes', () => {
  const candidates = dayPhotoCandidates(day([stop('Sensoji')]), [], trip);
  const sources = dayHeaderPhotoSources(candidates, new Map(), [local]);
  const pending = settleDayHeaderPhotos(null, {
    photos: sources,
    isResolving: true,
    resolutionKey: 'miss',
  });
  expect(
    settleDayHeaderPhotos(pending, { photos: sources, isResolving: true, resolutionKey: 'miss' }),
  ).toBe(pending);
  expect(
    settleDayHeaderPhotos(pending, { photos: sources, isResolving: false, resolutionKey: 'miss' })
      .photos,
  ).toEqual([local]);
});
