import Fastify from 'fastify';
import { beforeEach, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({ trip: { findFirst: vi.fn() } }));
vi.mock('@trove/db', () => ({ getPrismaClient: () => db }));
import { archiveWhere, requireUnarchivedTrip } from '../src/services/trip-archive.js';

const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => db.trip.findFirst.mockReset().mockResolvedValue({ archivedAt: new Date() }));

test('collection filters keep archive state separate from lifecycle', () => {
  expect(archiveWhere()).toEqual({ archivedAt: null });
  expect(archiveWhere('only')).toEqual({ archivedAt: { not: null } });
  expect(archiveWhere('include')).toEqual({});
});

test('archived trips allow browsing and management, but reject content writes and Trip Mode', async () => {
  const app = Fastify();
  app.decorateRequest('authUserId', 'owner');
  const allowed = vi.fn(async () => ({ reached: true }));
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
    app.route({
      method,
      url: '/trips/:tripId',
      preHandler: requireUnarchivedTrip,
      handler: allowed,
    });
  }
  app.patch('/trips/:tripId/archive', { preHandler: requireUnarchivedTrip }, allowed);
  app.post('/trips/:tripId/tasks', { preHandler: requireUnarchivedTrip }, allowed);
  app.get('/trips/:tripId/trip-mode/context', { preHandler: requireUnarchivedTrip }, allowed);
  app.post('/task-templates/:templateId/apply', { preHandler: requireUnarchivedTrip }, allowed);
  for (const path of [`/trips/${id}`, `/trips/${id}/archive`]) {
    expect(
      (await app.inject({ method: path.endsWith('archive') ? 'PATCH' : 'GET', url: path }))
        .statusCode,
    ).toBe(200);
  }
  expect((await app.inject({ method: 'DELETE', url: `/trips/${id}` })).statusCode).toBe(200);
  for (const [method, url, payload] of [
    ['PATCH', `/trips/${id}`, {}],
    ['POST', `/trips/${id}/tasks`, {}],
    ['GET', `/trips/${id}/trip-mode/context`, undefined],
    ['POST', '/task-templates/template/apply', { tripId: id }],
  ] as const) {
    const response = await app.inject({ method, url, payload });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: 'trip_archived' });
  }
  expect(db.trip.findFirst).toHaveBeenLastCalledWith({
    where: { id, ownerId: 'owner' },
    select: { archivedAt: true },
  });
  db.trip.findFirst.mockResolvedValue({ archivedAt: null });
  expect((await app.inject({ method: 'PATCH', url: `/trips/${id}`, payload: {} })).statusCode).toBe(
    200,
  );
  // Unknown/not-owned trips fall through to the controller's existing 404 check.
  db.trip.findFirst.mockResolvedValue(null);
  expect((await app.inject({ method: 'PATCH', url: `/trips/${id}`, payload: {} })).statusCode).toBe(
    200,
  );
  await app.close();
});
