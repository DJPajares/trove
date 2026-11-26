import { expect, test, vi } from 'vitest';

import { saveAtlasListing } from '../src/services/atlas-listing-save.js';

const listing = {
  countryCode: 'PH',
  destinationName: 'Bohol',
  latitude: 9.83,
  longitude: 124.14,
  name: 'Chocolate Hills',
};

function dependencies(place: Record<string, unknown>) {
  return {
    createCustomPlace: vi.fn(async () => ({ id: 'custom-place' })),
    grounder: { groundCandidate: vi.fn(async () => ({ place })) } as never,
    save: vi.fn(async (_userId: string, placeId: string) => ({ id: `saved-${placeId}` }) as never),
  };
}

test('a confident match is saved as the provider Place, from one rich search', async () => {
  const deps = dependencies({ placeId: 'provider-place', resolution: 'verified' });
  const result = await saveAtlasListing('owner', listing, deps);

  expect(result).toEqual({
    resolution: 'verified',
    savedPlace: { id: 'saved-provider-place' },
    status: 'saved',
  });
  const grounder = deps.grounder as unknown as { groundCandidate: ReturnType<typeof vi.fn> };
  expect(grounder.groundCandidate).toHaveBeenCalledTimes(1);
  expect(grounder.groundCandidate.mock.calls[0]![0]).toMatchObject({
    detail: 'evidence',
    locationBias: { latitude: 9.83, longitude: 124.14 },
    searchQuery: 'Chocolate Hills, Bohol',
  });
  expect(deps.createCustomPlace).not.toHaveBeenCalled();
});

test('an unresolved listing becomes a Custom Place carrying its name and coordinates', async () => {
  const deps = dependencies({ resolution: 'custom', verification: 'unverified' });
  const result = await saveAtlasListing('owner', listing, deps);

  expect(result).toMatchObject({ resolution: 'custom', status: 'saved' });
  expect(deps.createCustomPlace).toHaveBeenCalledWith('owner', {
    location: { latitude: 9.83, longitude: 124.14 },
    name: 'Chocolate Hills',
  });
  expect(deps.save).toHaveBeenCalledWith('owner', 'custom-place');
});

test('an unreachable provider saves nothing', async () => {
  const deps = dependencies({ resolution: 'custom', verification: 'not_checked' });
  expect(await saveAtlasListing('owner', listing, deps)).toEqual({ status: 'unavailable' });
  expect(deps.save).not.toHaveBeenCalled();

  const noProvider = { ...deps, grounder: null };
  expect(await saveAtlasListing('owner', listing, noProvider)).toEqual({ status: 'unavailable' });
});
