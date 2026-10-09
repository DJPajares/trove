import { DAY_PHOTO_THEME_TERMS, normalizeEditorialText, type DayPhotoTheme } from '@trove/types';

import type { ItineraryDay, ItineraryTripPlace } from '@/lib/itinerary/api';
import { localityFromAddress } from '@/lib/itinerary/day-place';
import { resolvePlacePhotoName } from '@/lib/trip-places/place-name';
import type { Trip } from '@/lib/trips/api';

import {
  editorialCoverImage,
  editorialSubjectKey,
  type EditorialImageReference,
  type EditorialSubject,
} from './editorial-images';
import { mediaSourceKey, type TripMediaSource } from './trip-media';

export type DayPhotoCandidate = {
  origin: 'title' | 'stop' | 'area';
  subject: EditorialSubject;
};

export type DayHeaderPhotoResolution = {
  photos: readonly TripMediaSource[];
  isResolving: boolean;
  resolutionKey: string;
};

const EMPTY_PHOTOS: readonly TripMediaSource[] = [];

/** Publish one complete ladder per photo context, never a partially resolved choice. */
export function settleDayHeaderPhotos(
  previous: DayHeaderPhotoResolution | null,
  next: DayHeaderPhotoResolution,
): DayHeaderPhotoResolution {
  if (previous?.resolutionKey === next.resolutionKey && (!previous.isResolving || next.isResolving))
    return previous;
  return next.isResolving ? { ...next, photos: EMPTY_PHOTOS } : next;
}

function words(value: string) {
  return normalizeEditorialText(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function mentions(title: string, name: string | null | undefined) {
  const phrase = name ? words(name) : '';
  return phrase.length >= 3 && ` ${words(title)} `.includes(` ${phrase} `);
}

/** Unsupported title language/themes safely fall through to stored Places and areas. */
export function dayPhotoTheme(title: string | null): DayPhotoTheme | undefined {
  const tokens = words(title ?? '').split(' ');
  for (const token of tokens) {
    for (const [theme, terms] of Object.entries(DAY_PHOTO_THEME_TERMS)) {
      if (terms.some((term) => token === term || token === `${term}s`))
        return theme as DayPhotoTheme;
    }
  }
  return undefined;
}

function placeArea(tripPlace: ItineraryTripPlace | undefined | null) {
  return localityFromAddress(
    tripPlace?.place.snapshot?.address ?? tripPlace?.place.providerAddress,
  );
}

/** Photography may use one located stop without changing the stricter day-heading rules. */
export function dayPhotoArea(day: ItineraryDay, tripPlaces: readonly ItineraryTripPlace[]) {
  const counts = new Map<string, { count: number; name: string }>();
  for (const item of day.items) {
    const area = placeArea(item.tripPlace);
    if (!area) continue;
    const key = words(area);
    const entry = counts.get(key) ?? { count: 0, name: area };
    entry.count += 1;
    counts.set(key, entry);
  }
  const strongest = [...counts.values()].toSorted((left, right) => right.count - left.count)[0];
  if (strongest) return strongest.name;
  const baseId = day.stay?.endTripPlaceId ?? day.stay?.startTripPlaceId ?? day.dailyBaseTripPlaceId;
  return placeArea(tripPlaces.find((place) => place.id === baseId));
}

/** At most one title query, two prominent stops and one area; never a trip-wide fan-out. */
export function dayPhotoCandidates(
  day: ItineraryDay | null,
  tripPlaces: readonly ItineraryTripPlace[],
  trip: Trip | null,
): DayPhotoCandidate[] {
  if (!day) return [];
  const title = day.name?.trim() ?? '';
  const area = dayPhotoArea(day, tripPlaces);
  const categoryRank = {
    destination: 3,
    things_to_do: 3,
    food_and_drink: 2,
    shopping: 2,
    other: 1,
    stay: 0,
    transport: 0,
  };
  const stops = day.items
    .flatMap((item) => {
      if (!item.tripPlace) return [];
      const name = resolvePlacePhotoName(item.tripPlace);
      if (!name) return [];
      const named = [name, item.customLabel, item.tripPlace.customName].some((label) =>
        mentions(title, label),
      );
      return [
        {
          named,
          rank:
            ((item.priority ?? item.tripPlace.priority) === 'must_go' ? 10 : 0) +
            categoryRank[item.tripPlace.place.snapshot?.category ?? 'other'],
          subject: {
            category: item.tripPlace.place.snapshot?.category,
            name,
            placeId: item.tripPlace.place.id,
          } satisfies EditorialSubject,
        },
      ];
    })
    .toSorted((left, right) => Number(right.named) - Number(left.named) || right.rank - left.rank);
  const candidates: DayPhotoCandidate[] = [];
  const namedStop = stops.find((stop) => stop.named);
  const namedArea = [
    ...(trip?.destinations.map((destination) => destination.name) ?? []),
    ...day.items.flatMap((item) => placeArea(item.tripPlace) ?? []),
  ]
    .filter((name) => mentions(title, name))
    .toSorted((left, right) => right.length - left.length)[0];
  const theme = dayPhotoTheme(title);
  const themeArea =
    area ?? (trip?.destinations.length === 1 ? trip.destinations[0]?.name.trim() : null);
  const countryCode = trip?.countries?.length === 1 ? trip.countries[0] : undefined;
  if (namedStop) {
    candidates.push({ origin: 'title', subject: namedStop.subject });
  } else if (namedArea || (theme && themeArea)) {
    const anchor = namedArea ?? themeArea!;
    candidates.push({
      origin: 'title',
      subject: {
        category: 'destination',
        name: anchor,
        context: { area: anchor, countryCode, theme },
      },
    });
  }
  const seen = new Set(candidates.map((candidate) => editorialSubjectKey(candidate.subject)));
  let stopCount = 0;
  for (const stop of stops) {
    const key = editorialSubjectKey(stop.subject);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ origin: 'stop', subject: stop.subject });
    if (++stopCount === 2) break;
  }
  if (area)
    candidates.push({
      origin: 'area',
      subject: { category: 'destination', name: area, context: { area, countryCode } },
    });
  return candidates.slice(0, 4);
}

/** Separate photo roles drawn from one cached collection whenever possible. */
export function tripSecondaryImages(
  images: readonly EditorialImageReference[],
  seed: string,
  supplemental: readonly EditorialImageReference[] = [],
) {
  const primary = editorialCoverImage(images, seed);
  const supplementLead = editorialCoverImage(supplemental, `${seed}:days`);
  const supplementIndex = supplementLead ? supplemental.indexOf(supplementLead) : 0;
  const ordered = [
    ...images,
    ...supplemental.slice(supplementIndex),
    ...supplemental.slice(0, supplementIndex),
  ];
  const seenIds = new Set(primary ? [primary.externalPhotoId] : []);
  const seenUrls = new Set(primary ? [primary.sourceUrl] : []);
  return ordered.filter((image) => {
    if (seenIds.has(image.externalPhotoId) || seenUrls.has(image.sourceUrl)) return false;
    seenIds.add(image.externalPhotoId);
    seenUrls.add(image.sourceUrl);
    return true;
  });
}

export function dayHeaderPhotoSources(
  candidates: readonly DayPhotoCandidate[],
  images: ReadonlyMap<string, EditorialImageReference[]>,
  fallbackSources: readonly TripMediaSource[],
) {
  const sources: TripMediaSource[] = candidates.flatMap((candidate) => {
    const image = images.get(editorialSubjectKey(candidate.subject))?.[0];
    return image && image.matchKind !== 'generic'
      ? [{ kind: 'editorial' as const, reference: image }]
      : [];
  });
  const seen = new Set<string>();
  return [...sources, ...fallbackSources].filter((source) => {
    const key = mediaSourceKey(source);
    if (source.kind === 'fallback' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
