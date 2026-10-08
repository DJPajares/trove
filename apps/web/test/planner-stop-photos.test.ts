import { expect, test } from 'vitest';

import type { ItineraryItem } from '../lib/itinerary/api.ts';
import { plannerStopPhoto, plannerStopPhotoSubjects } from '../lib/itinerary/stop-photos.ts';
import {
  editorialSubjectKey,
  type EditorialImageReference,
} from '../lib/media/editorial-images.ts';

function stop(id: string, name: string, kind: 'custom' | 'provider' = 'provider') {
  return {
    id,
    customLabel: 'A caption that is not a Place name',
    tripPlace: {
      customName: "Mum's favourite",
      place: {
        id: `place-${name}`,
        kind,
        name: kind === 'custom' ? name : null,
        providerLabel: kind === 'provider' ? name : null,
        snapshot: null,
      },
    },
  } as ItineraryItem;
}

const unlinked = { id: 'unlinked', customLabel: 'Kyoto Tower', tripPlace: null } as ItineraryItem;

test('only seen rows in the viewed day resolve, deduplicated by Place identity', () => {
  const first = stop('first', 'Kyoto Tower');
  const second = stop('second', 'Kyoto Tower');
  const unseen = stop('unseen', 'Nishiki Market');
  expect(
    plannerStopPhotoSubjects(
      [first, second, unseen, unlinked],
      new Set(['first', 'second', 'unlinked', 'another-day']),
    ),
  ).toEqual([{ category: undefined, name: 'Kyoto Tower', placeId: 'place-Kyoto Tower' }]);
});

test('provider snapshots outrank labels, and captions/nicknames never become photo subjects', () => {
  const item = stop('item', 'Old provider label');
  item.tripPlace!.place.snapshot = {
    name: 'Kiyomizu-dera',
    category: 'things_to_do',
  } as NonNullable<typeof item.tripPlace>['place']['snapshot'];
  expect(plannerStopPhotoSubjects([item], new Set(['item']))[0]).toEqual({
    category: 'things_to_do',
    name: 'Kiyomizu-dera',
    placeId: 'place-Old provider label',
  });
});

test('named Custom Places qualify by their original name; free-text and unnamed items do not', () => {
  const custom = stop('custom', 'Huka Falls', 'custom');
  const unnamed = stop('unnamed', '   ', 'custom');
  expect(
    plannerStopPhotoSubjects(
      [custom, unnamed, unlinked],
      new Set(['custom', 'unnamed', 'unlinked']),
    ),
  ).toEqual([{ category: undefined, name: 'Huka Falls', placeId: 'place-Huka Falls' }]);
});

test('recognition excludes generic/contextual imagery and missing matches', () => {
  const item = stop('item', 'Huka Falls', 'custom');
  const subject = plannerStopPhotoSubjects([item], new Set(['item']))[0]!;
  const key = editorialSubjectKey(subject);
  for (const matchKind of ['generic', 'contextual'] as const) {
    expect(
      plannerStopPhoto(item, new Map([[key, [{ matchKind } as EditorialImageReference]]])),
    ).toBeNull();
  }
  const exact = { matchKind: 'exact', externalPhotoId: '1' } as EditorialImageReference;
  expect(plannerStopPhoto(item, new Map([[key, [exact]]]))).toBe(exact);
  expect(plannerStopPhoto(item, new Map())).toBeNull();
  expect(plannerStopPhoto(unlinked, new Map([[key, [exact]]]))).toBeNull();
});

test('later stops are eligible after the first request-size window', () => {
  const items = Array.from({ length: 35 }, (_, index) => stop(`item-${index}`, `Place ${index}`));
  const subjects = plannerStopPhotoSubjects(items, new Set(items.map((item) => item.id)));
  expect(subjects).toHaveLength(35);
  expect(subjects.at(-1)?.name).toBe('Place 34');
});
