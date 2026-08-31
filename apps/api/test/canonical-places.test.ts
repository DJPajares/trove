import Fastify from 'fastify';
import { expect, test } from 'vitest';

import { createPlacesControllers } from '../src/controllers/places.js';
import {
  CanonicalPlaceNotFoundError,
  type CanonicalPlaceRecord,
  type CanonicalPlaceRepository,
  CanonicalPlacesService,
  type CustomPlaceCreate,
  type CustomPlaceUpdate,
  type ProviderPlaceLabel,
  ProviderReferenceConflictError,
} from '../src/services/canonical-places.js';
import type { PlaceProviderName, ProviderPlaceIdentity } from '../src/services/places.js';

const ownerId = '8926bbe8-abae-470c-ab90-f33af1a8d168';

/**
 * A reference Trove has created but never resolved: the shape a Place is in
 * between being picked out of search and its one provider request landing.
 */
function unresolvedProviderRef(externalPlaceId: string) {
  return {
    cachedAt: null,
    cachedFormattedAddress: null,
    cachedGoogleMapsUri: null,
    cachedLanguageCode: null,
    cachedLatitude: null,
    cachedLongitude: null,
    cachedName: null,
    cachedPrimaryType: null,
    cachedTypes: [],
    cachedUtcOffsetMinutes: null,
    externalPlaceId,
    provider: 'GOOGLE' as const,
  };
}

/** Counts what resolving a Place costs, so a test can assert it is paid once. */
function countingHydrator() {
  const calls: Array<{
    externalPlaceId: string;
    options?: { languageCode?: string; sessionToken?: string; source?: 'place-resolution' };
  }> = [];
  const hydrate = async (
    externalPlaceId: string,
    options?: { languageCode?: string; sessionToken?: string; source?: 'place-resolution' },
  ) => {
    calls.push({ externalPlaceId, options });
    return null;
  };
  return { calls, hydrate };
}

class MemoryCanonicalPlaceRepository implements CanonicalPlaceRepository {
  private customPlaces = new Map<string, CanonicalPlaceRecord>();
  private providerPlaces = new Map<string, CanonicalPlaceRecord>();
  createProviderAttempts = 0;
  providerPlaceCount = 0;
  private nextId = 1;

  private createId() {
    const suffix = String(this.nextId++).padStart(12, '0');
    return `00000000-0000-7000-8000-${suffix}`;
  }

  async findByProviderRef(provider: PlaceProviderName, externalPlaceId: string) {
    await Promise.resolve();
    return this.providerPlaces.get(`${provider}:${externalPlaceId}`) ?? null;
  }

  async createProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
  ) {
    this.createProviderAttempts += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));

    const key = `${provider}:${externalPlaceId}`;
    if (this.providerPlaces.has(key)) {
      throw new ProviderReferenceConflictError();
    }

    const place: CanonicalPlaceRecord = {
      customLatitude: null,
      customLongitude: null,
      customName: null,
      customNote: null,
      customTimeZone: null,
      id: this.createId(),
      kind: 'PROVIDER',
      ownerId: null,
      providerAddress: label?.address?.trim() || null,
      providerLabel: label?.name?.trim() || null,
      providerRefs: [unresolvedProviderRef(externalPlaceId)],
    };
    this.providerPlaces.set(key, place);
    this.providerPlaceCount += 1;
    return place;
  }

  async writeProviderSnapshot(
    placeId: string,
    identity: ProviderPlaceIdentity,
    languageCode: string | undefined,
    fetchedAt: Date,
  ) {
    for (const place of this.providerPlaces.values()) {
      if (place.id !== placeId) continue;
      const reference = place.providerRefs.find(
        (entry) => entry.externalPlaceId === identity.externalPlaceId,
      );
      if (!reference) throw new Error('provider_reference_not_found');
      Object.assign(reference, {
        cachedAt: fetchedAt,
        cachedFormattedAddress: identity.formattedAddress,
        cachedGoogleMapsUri: identity.googleMapsUri,
        cachedLanguageCode: languageCode ?? 'en',
        cachedLatitude: identity.location.latitude,
        cachedLongitude: identity.location.longitude,
        cachedName: identity.name,
        cachedPrimaryType: identity.primaryType,
        cachedTypes: identity.rawTypes,
        cachedUtcOffsetMinutes: identity.utcOffsetMinutes,
      });
      return place;
    }
    throw new Error('place_not_found');
  }

  /** Stands in for the snapshot write a real hydration would have made. */
  resolveSnapshot(externalPlaceId: string, cachedAt = new Date()) {
    for (const place of this.providerPlaces.values()) {
      for (const reference of place.providerRefs) {
        if (reference.externalPlaceId !== externalPlaceId) continue;
        Object.assign(reference, {
          cachedAt,
          cachedLanguageCode: 'en',
          cachedLatitude: 1.2966,
          cachedLongitude: 103.8485,
          cachedName: 'National Museum',
        });
      }
    }
  }

  backfillAttempts = 0;

  async backfillProviderLabel(placeId: string, label: ProviderPlaceLabel) {
    this.backfillAttempts += 1;
    await Promise.resolve();

    for (const [key, place] of this.providerPlaces) {
      if (place.id !== placeId) continue;
      const updated: CanonicalPlaceRecord = {
        ...place,
        ...(label.address?.trim() ? { providerAddress: label.address.trim() } : {}),
        ...(label.name?.trim() ? { providerLabel: label.name.trim() } : {}),
      };
      this.providerPlaces.set(key, updated);
      return updated;
    }
    throw new Error('place_not_found');
  }

  async createCustomPlace(userId: string, input: CustomPlaceCreate) {
    const place: CanonicalPlaceRecord = {
      customLatitude: input.location?.latitude ?? null,
      customLongitude: input.location?.longitude ?? null,
      customName: input.name,
      customNote: input.note ?? null,
      customTimeZone: input.location?.timeZone ?? null,
      id: this.createId(),
      kind: 'CUSTOM',
      ownerId: userId,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
    };
    this.customPlaces.set(place.id, place);
    return place;
  }

  async updateOwnedCustomPlace(userId: string, placeId: string, input: CustomPlaceUpdate) {
    const place = this.customPlaces.get(placeId);
    if (!place || place.ownerId !== userId) return null;

    const updated: CanonicalPlaceRecord = {
      ...place,
      ...(input.location !== undefined
        ? {
            customLatitude: input.location?.latitude ?? null,
            customLongitude: input.location?.longitude ?? null,
            customTimeZone: input.location?.timeZone ?? null,
          }
        : {}),
      ...(input.name !== undefined ? { customName: input.name } : {}),
      ...(input.note !== undefined ? { customNote: input.note } : {}),
    };
    this.customPlaces.set(placeId, updated);
    return updated;
  }
}

test('provider resolution creates identity only on use and reuses it across concurrent requests', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository, countingHydrator().hydrate);

  expect(repository.providerPlaceCount).toBe(0);

  const [first, second] = await Promise.all([
    service.resolveProviderPlace('google', 'ChIJcanonical'),
    service.resolveProviderPlace('google', 'ChIJcanonical'),
  ]);

  expect(first.id).toBe(second.id);
  expect(repository.providerPlaceCount).toBe(1);
  expect(repository.createProviderAttempts).toBe(2);
  expect(first).toStrictEqual({
    id: first.id,
    kind: 'provider',
    location: null,
    name: null,
    note: null,
    providerAddress: null,
    providerLabel: null,
    providerRefs: [{ externalPlaceId: 'ChIJcanonical', provider: 'google' }],
    // Nothing was fetched: the stub hydrator stands in for a provider request
    // that has not landed, so the Place is identity-only until it does.
    snapshot: null,
  });

  const repeated = await service.resolveProviderPlace('google', 'ChIJcanonical');
  expect(repeated.id).toBe(first.id);
  expect(repository.createProviderAttempts).toBe(2);
});

test('Text Search identity seeds the canonical snapshot without a second details hydration', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const hydrator = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrator.hydrate);
  const providerIdentity: ProviderPlaceIdentity = {
    attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
    category: 'things_to_do',
    externalPlaceId: 'ChIJmuseum',
    formattedAddress: '93 Stamford Road, Singapore',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    location: { latitude: 1.2966, longitude: 103.8485 },
    name: 'National Museum',
    primaryType: 'museum',
    provider: 'google',
    rawTypes: ['museum'],
    utcOffsetMinutes: 480,
  };

  const first = await service.resolveProviderPlaceFromIdentity(providerIdentity, {
    fetchedAt: new Date('2026-08-31T04:00:00.000Z'),
    languageCode: 'en',
  });
  const second = await service.resolveProviderPlaceFromIdentity(providerIdentity, {
    fetchedAt: new Date('2026-08-31T04:01:00.000Z'),
    languageCode: 'en',
  });

  expect(second.id).toBe(first.id);
  expect(repository.providerPlaceCount).toBe(1);
  expect(hydrator.calls).toStrictEqual([]);
  expect(second.snapshot).toMatchObject({
    address: '93 Stamford Road, Singapore',
    name: 'National Museum',
    rawTypes: ['museum'],
    utcOffsetMinutes: 480,
  });
  expect(JSON.stringify(second.snapshot)).not.toContain('Example Data');
});

test('custom Places support name-only creation and remain owner-scoped on edit', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository, countingHydrator().hydrate);

  const created = await service.createCustomPlace(ownerId, { name: '  Quiet lookout  ' });
  expect(created).toStrictEqual({
    id: created.id,
    kind: 'custom',
    location: null,
    name: 'Quiet lookout',
    note: null,
    providerAddress: null,
    providerLabel: null,
    providerRefs: [],
    // A Custom Place is Trove's own, so there is no provider answer to snapshot.
    snapshot: null,
  });

  const updated = await service.updateCustomPlace(ownerId, created.id, {
    location: { latitude: 1.3521, longitude: 103.8198, timeZone: 'Asia/Singapore' },
    note: '  Meet by the sheltered bench.  ',
  });
  expect(updated).toStrictEqual({
    ...created,
    location: {
      latitude: 1.3521,
      longitude: 103.8198,
      timeZone: 'Asia/Singapore',
    },
    note: 'Meet by the sheltered bench.',
  });

  await expect(
    service.updateCustomPlace('11111111-1111-4111-8111-111111111111', created.id, {
      name: 'Not allowed',
    }),
  ).rejects.toThrow(CanonicalPlaceNotFoundError);
});

test('canonical Place controllers return one API shape for provider-backed and custom Places', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const { calls, hydrate } = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrate);
  const controllers = createPlacesControllers(null, service);
  const app = Fastify();

  app.addHook('preHandler', async (request) => {
    request.authUserId = ownerId;
  });
  app.post('/resolve', controllers.resolveProviderPlace);
  app.post('/custom', controllers.createCustomPlace);
  app.patch('/custom/:placeId', controllers.updateCustomPlace);

  const providerResponse = await app.inject({
    method: 'POST',
    payload: {
      externalPlaceId: 'ChIJmuseum',
      provider: 'google',
      sessionToken: 'b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0',
    },
    url: '/resolve',
  });
  const customResponse = await app.inject({
    method: 'POST',
    payload: { name: 'Private meeting point' },
    url: '/custom',
  });

  expect(providerResponse.statusCode).toBe(200);
  expect(customResponse.statusCode).toBe(201);

  const providerPlace = providerResponse.json().place as Record<string, unknown>;
  const customPlace = customResponse.json().place as Record<string, unknown>;
  expect(Object.keys(providerPlace).sort()).toStrictEqual(Object.keys(customPlace).sort());
  expect('rating' in providerPlace).toBe(false);
  expect('photos' in providerPlace).toBe(false);
  expect(calls[0]?.options?.sessionToken).toBe('b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0');

  const updateResponse = await app.inject({
    method: 'PATCH',
    payload: {
      location: { latitude: 35.6762, longitude: 139.6503, timeZone: 'Asia/Tokyo' },
      note: 'Near the west entrance',
    },
    url: `/custom/${String(customPlace.id)}`,
  });
  expect(updateResponse.statusCode).toBe(200);
  expect(updateResponse.json().place.note).toBe('Near the west entrance');

  await app.close();
});

test('the label a Place was first seen by is kept, backfilled once, and never rewritten', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository, countingHydrator().hydrate);

  // Captured on the way in, so the Place has a name of its own from the start.
  const created = await service.resolveProviderPlace('google', 'Ej-clonbern', {
    address: '  Remuera, Auckland 1050, New Zealand  ',
    name: '  2/42 Clonbern Road  ',
  });
  expect(created.providerLabel).toBe('2/42 Clonbern Road');
  expect(created.providerAddress).toBe('Remuera, Auckland 1050, New Zealand');
  expect(repository.backfillAttempts).toBe(0);

  // A second traveller wording it differently does not get to rename it.
  const reresolved = await service.resolveProviderPlace('google', 'Ej-clonbern', {
    address: 'Somewhere else entirely',
    name: 'A different wording',
  });
  expect(reresolved.providerLabel).toBe('2/42 Clonbern Road');
  expect(reresolved.providerAddress).toBe('Remuera, Auckland 1050, New Zealand');
  expect(repository.backfillAttempts, 'an existing label must not be written again').toBe(0);

  // A Place resolved before labels existed borrows the next one offered.
  const unlabelled = await service.resolveProviderPlace('google', 'ChIJlegacy');
  expect(unlabelled.providerLabel).toBe(null);

  const backfilled = await service.resolveProviderPlace('google', 'ChIJlegacy', {
    address: 'Matamata 3472, New Zealand',
    name: 'Hobbiton Movie Set Tours',
  });
  expect(backfilled.providerLabel).toBe('Hobbiton Movie Set Tours');
  expect(backfilled.providerAddress).toBe('Matamata 3472, New Zealand');
  expect(repository.backfillAttempts).toBe(1);
});

test('resolving without a label still succeeds and writes nothing', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository, countingHydrator().hydrate);

  const place = await service.resolveProviderPlace('google', 'ChIJnolabel');

  expect(place.providerLabel).toBe(null);
  expect(place.providerAddress).toBe(null);
  expect(repository.backfillAttempts).toBe(0);
  expect(repository.providerPlaceCount).toBe(1);
});

test('a Place costs exactly one provider request, the first time anyone adds it', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const { calls, hydrate } = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrate);

  await service.resolveProviderPlace('google', 'ChIJmuseum', undefined, { languageCode: 'en' });

  // Paid once, at the only moment a user asked for it: picking it out of search.
  expect(calls).toStrictEqual([
    {
      externalPlaceId: 'ChIJmuseum',
      options: { languageCode: 'en', sessionToken: undefined, source: 'place-resolution' },
    },
  ]);
});

test('provider resolution carries the autocomplete session into Place Details hydration', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const { calls, hydrate } = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrate);

  await service.resolveProviderPlace('google', 'ChIJmuseum', undefined, {
    languageCode: 'en',
    sessionToken: 'b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0',
  });

  expect(calls).toStrictEqual([
    {
      externalPlaceId: 'ChIJmuseum',
      options: {
        languageCode: 'en',
        sessionToken: 'b6ffb9ec-3f34-4a2e-a37a-a416c54e99d0',
        source: 'place-resolution',
      },
    },
  ]);
});

test('adding a Place the database already knows costs nothing', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const { calls, hydrate } = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrate);

  const first = await service.resolveProviderPlace('google', 'ChIJmuseum');
  repository.resolveSnapshot('ChIJmuseum');

  // The same traveller adding it to a second trip, or a different traveller
  // reaching it entirely — neither is a reason to ask Google again.
  const second = await service.resolveProviderPlace('google', 'ChIJmuseum');
  const third = await service.resolveProviderPlace('google', 'ChIJmuseum', {
    name: 'National Museum',
  });

  expect(second.id).toBe(first.id);
  expect(third.id).toBe(first.id);
  expect(calls.length, 'only the very first resolution should reach a provider').toBe(1);
});

test('a snapshot that has aged out is refreshed the next time the Place is added', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const { calls, hydrate } = countingHydrator();
  const service = new CanonicalPlacesService(repository, hydrate);

  await service.resolveProviderPlace('google', 'ChIJmuseum');
  repository.resolveSnapshot('ChIJmuseum', new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000));

  await service.resolveProviderPlace('google', 'ChIJmuseum');

  expect(calls.map((call) => call.externalPlaceId)).toStrictEqual(['ChIJmuseum', 'ChIJmuseum']);
});
