import { expect, test } from 'vitest';

import { shouldShowPush } from '../lib/notifications/push-payload';

const now = Date.parse('2026-09-27T10:00:00.000Z');
const payload = {
  body: 'Check in for Kyoto is due at 6:30 PM.',
  expiresAt: '2026-09-27T10:30:00.000Z',
  ownerId: 'owner-1',
  tag: 'trove-reminder-1',
  title: 'Task due soon',
  url: '/trips/trip-1/tasks',
};

test('worker shows detail only for the active account before event expiry', () => {
  expect(shouldShowPush(payload, 'owner-1', now)).toBe(true);
  expect(shouldShowPush(payload, null, now)).toBe(false);
  expect(shouldShowPush(payload, 'owner-2', now)).toBe(false);
  expect(shouldShowPush(payload, 'owner-1', Date.parse(payload.expiresAt))).toBe(false);
  expect(shouldShowPush({ ...payload, expiresAt: 'invalid' }, 'owner-1', now)).toBe(false);
  expect(shouldShowPush({ ...payload, url: 'https://attacker.example/trip' }, 'owner-1', now)).toBe(
    false,
  );
});
