import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test } from 'vitest';

import { createPlacesControllers } from '../src/controllers/places.js';
import {
  CanonicalPlaceNotFoundError,
  type CanonicalPlaceRecord,
  type CanonicalPlaceRepository,
  CanonicalPlacesService,
  type CustomPlaceCreate,
  type CustomPlaceUpdate,
  ProviderReferenceConflictError,
} from '../src/services/canonical-places.js';
import type { PlaceProviderName } from '../src/services/places.js';

const ownerId = '8926bbe8-abae-470c-ab90-f33af1a8d168';

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

  async createProviderPlace(provider: PlaceProviderName, externalPlaceId: string) {
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
      providerRefs: [{ externalPlaceId, provider: 'GOOGLE' }],
    };
    this.providerPlaces.set(key, place);
    this.providerPlaceCount += 1;
    return place;
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
  const service = new CanonicalPlacesService(repository);

  assert.equal(repository.providerPlaceCount, 0);

  const [first, second] = await Promise.all([
    service.resolveProviderPlace('google', 'ChIJcanonical'),
    service.resolveProviderPlace('google', 'ChIJcanonical'),
  ]);

  assert.equal(first.id, second.id);
  assert.equal(repository.providerPlaceCount, 1);
  assert.equal(repository.createProviderAttempts, 2);
  assert.deepEqual(first, {
    id: first.id,
    kind: 'provider',
    location: null,
    name: null,
    note: null,
    providerRefs: [{ externalPlaceId: 'ChIJcanonical', provider: 'google' }],
  });

  const repeated = await service.resolveProviderPlace('google', 'ChIJcanonical');
  assert.equal(repeated.id, first.id);
  assert.equal(repository.createProviderAttempts, 2);
});

test('custom Places support name-only creation and remain owner-scoped on edit', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository);

  const created = await service.createCustomPlace(ownerId, { name: '  Quiet lookout  ' });
  assert.deepEqual(created, {
    id: created.id,
    kind: 'custom',
    location: null,
    name: 'Quiet lookout',
    note: null,
    providerRefs: [],
  });

  const updated = await service.updateCustomPlace(ownerId, created.id, {
    location: { latitude: 1.3521, longitude: 103.8198, timeZone: 'Asia/Singapore' },
    note: '  Meet by the sheltered bench.  ',
  });
  assert.deepEqual(updated, {
    ...created,
    location: {
      latitude: 1.3521,
      longitude: 103.8198,
      timeZone: 'Asia/Singapore',
    },
    note: 'Meet by the sheltered bench.',
  });

  await assert.rejects(
    service.updateCustomPlace('11111111-1111-4111-8111-111111111111', created.id, {
      name: 'Not allowed',
    }),
    CanonicalPlaceNotFoundError,
  );
});

test('canonical Place controllers return one API shape for provider-backed and custom Places', async () => {
  const repository = new MemoryCanonicalPlaceRepository();
  const service = new CanonicalPlacesService(repository);
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
    payload: { externalPlaceId: 'ChIJmuseum', provider: 'google' },
    url: '/resolve',
  });
  const customResponse = await app.inject({
    method: 'POST',
    payload: { name: 'Private meeting point' },
    url: '/custom',
  });

  assert.equal(providerResponse.statusCode, 200);
  assert.equal(customResponse.statusCode, 201);

  const providerPlace = providerResponse.json().place as Record<string, unknown>;
  const customPlace = customResponse.json().place as Record<string, unknown>;
  assert.deepEqual(Object.keys(providerPlace).sort(), Object.keys(customPlace).sort());
  assert.equal('rating' in providerPlace, false);
  assert.equal('photos' in providerPlace, false);

  const updateResponse = await app.inject({
    method: 'PATCH',
    payload: {
      location: { latitude: 35.6762, longitude: 139.6503, timeZone: 'Asia/Tokyo' },
      note: 'Near the west entrance',
    },
    url: `/custom/${String(customPlace.id)}`,
  });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json().place.note, 'Near the west entrance');

  await app.close();
});
