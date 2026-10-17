import Fastify from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';
import { createItineraryTimeSuggestionControllers } from '../src/controllers/itinerary-time-suggestions.js';
import {
  getItineraryTimingReview,
  applyItineraryTimingReview,
} from '../src/services/itinerary-time-suggestions.js';

vi.mock('../src/services/itinerary-time-suggestions.js', () => ({
  getItineraryTimingReview: vi.fn(async () => ({ changes: [], issues: [] })),
  applyItineraryTimingReview: vi.fn(async () => ({
    applied: [],
    scheduling: { changes: [], issues: [] },
  })),
}));
afterEach(() => vi.clearAllMocks());
const tripId = '11111111-1111-4111-8111-111111111111';
const dayId = '22222222-2222-4222-8222-222222222222';
const targetItemId = '33333333-3333-4333-8333-333333333333';
const path = `/trips/${tripId}/itinerary/days/${dayId}/timing-review`;
async function server() {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.authUserId = 'owner';
  });
  const controllers = createItineraryTimeSuggestionControllers();
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/timing-review',
    controllers.getTimingReview,
  );
  app.post(
    '/trips/:tripId/itinerary/days/:itineraryDayId/timing-review',
    controllers.applyTimingReview,
  );
  return app;
}
test('review and acceptance preserve the same requested timing options', async () => {
  const app = await server();
  try {
    const repair = { schedule: 'exact', durationMinutes: 240, localTime: '12:00' };
    const query = new URLSearchParams({ targetItemId, repair: JSON.stringify(repair) });
    const preview = await app.inject({ method: 'GET', url: `${path}?${query}` });
    expect(preview.statusCode).toBe(200);
    expect(getItineraryTimingReview).toHaveBeenCalledWith(
      'owner',
      tripId,
      dayId,
      targetItemId,
      repair,
    );
    const body = {
      targetItemId,
      repair,
      itemIds: [targetItemId],
      scheduleRevision: 'a'.repeat(64),
    };
    const apply = await app.inject({ method: 'POST', url: path, payload: body });
    expect(apply.statusCode).toBe(200);
    expect(applyItineraryTimingReview).toHaveBeenCalledWith('owner', tripId, dayId, body);
  } finally {
    await app.close();
  }
});
test('malformed or targetless repairs never reach a writer', async () => {
  const app = await server();
  try {
    for (const repair of [
      '{',
      '{"durationMinutes":-1}',
      '{"localTime":"25:00"}',
      '{"unreviewed":true}',
    ]) {
      const query = new URLSearchParams({ targetItemId, repair });
      expect((await app.inject({ method: 'GET', url: `${path}?${query}` })).statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          payload: { repair: {}, itemIds: [targetItemId], scheduleRevision: 'a'.repeat(64) },
        })
      ).statusCode,
    ).toBe(400);
    expect(getItineraryTimingReview).not.toHaveBeenCalled();
    expect(applyItineraryTimingReview).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
