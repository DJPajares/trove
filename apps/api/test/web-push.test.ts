import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const database = vi.hoisted(() => ({ client: null as unknown }));
const candidates = vi.hoisted(() => ({
  currentDueCandidate: vi.fn(),
  listDueNotificationCandidates: vi.fn(),
  upsertCandidate: vi.fn(),
}));

vi.mock('@trove/db', () => ({ getPrismaClient: () => database.client }));
vi.mock('../src/services/notifications.js', () => candidates);

const webPush = await import('web-push');
const {
  classifyPushFailure,
  dispatchNotifications,
  getPushEnvironment,
  registerPushSubscription,
  sourceVersionHash,
  validatePushSubscription,
} = await import('../src/services/web-push.js');

const NOW = new Date('2026-09-27T10:00:00.000Z');
const EVENT = new Date('2026-09-27T10:30:00.000Z');
const OWNER = '00000000-0000-4000-8000-000000000001';
const candidate = {
  eventAt: EVENT,
  kind: 'TASK_DUE' as const,
  label: 'Check in',
  sourceId: '00000000-0000-4000-8000-000000000002',
  sourceVersion: 'material-v1',
  timeZone: 'Asia/Singapore',
  tripId: '00000000-0000-4000-8000-000000000003',
  tripName: 'Review trip',
};
const subscription = {
  id: '00000000-0000-4000-8000-000000000004',
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  auth: Buffer.alloc(16, 1).toString('base64url'),
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString('base64url'),
  locale: 'en',
};

beforeEach(() => {
  const keys = webPush.default.generateVAPIDKeys();
  process.env.TROVE_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.TROVE_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.TROVE_VAPID_SUBJECT = 'mailto:trove@example.com';
  candidates.listDueNotificationCandidates.mockResolvedValue([{ candidate, ownerId: OWNER }]);
  candidates.currentDueCandidate.mockResolvedValue(candidate);
  candidates.upsertCandidate.mockResolvedValue({
    id: 'notification-1',
    readAt: null,
    sourceVersion: candidate.sourceVersion,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TROVE_VAPID_PUBLIC_KEY;
  delete process.env.TROVE_VAPID_PRIVATE_KEY;
  delete process.env.TROVE_VAPID_SUBJECT;
});

function installDatabase() {
  let state: 'ACCEPTED' | 'ATTEMPTED' | 'PENDING' | 'RETRYABLE' = 'PENDING';
  let nextAttemptAt: Date | null = null;
  let attempts = 0;
  const client = {
    notification: {
      findUnique: vi.fn(async () => ({
        id: 'notification-1',
        readAt: null,
        sourceVersion: candidate.sourceVersion,
      })),
    },
    pushSubscription: {
      findMany: vi.fn(async () => [subscription]),
      findFirst: vi.fn(async () => subscription),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    pushDelivery: {
      findMany: vi.fn(
        async (_query?: { where: { notificationId: string } }) =>
          [] as Array<{ subscriptionId: string; state: string; nextAttemptAt: Date | null }>,
      ),
      upsert: vi.fn(async () => ({ id: 'delivery-1', attempts })),
      updateMany: vi.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ state: string; nextAttemptAt?: { lte: Date } }> };
        }) => {
          const due = where.OR.some(
            (condition) =>
              condition.state === state &&
              (!condition.nextAttemptAt ||
                (nextAttemptAt !== null && nextAttemptAt <= condition.nextAttemptAt.lte)),
          );
          if (!due) return { count: 0 };
          state = 'ATTEMPTED';
          attempts += 1;
          return { count: 1 };
        },
      ),
      update: vi.fn(async ({ data }: { data: { state: typeof state; nextAttemptAt?: Date } }) => {
        state = data.state;
        nextAttemptAt = data.nextAttemptAt ?? null;
      }),
      aggregate: vi.fn(async () => ({
        _count: state === 'RETRYABLE' ? 1 : 0,
        _min: { createdAt: state === 'RETRYABLE' ? NOW : null },
      })),
    },
  };
  database.client = client;
  return { client, state: () => state };
}

test('validates HTTPS push-service endpoints and encryption keys', () => {
  expect(
    validatePushSubscription({ endpoint: subscription.endpoint, keys: subscription }),
  ).toMatchObject({ endpoint: subscription.endpoint });
  expect(
    validatePushSubscription({
      endpoint: 'https://jmt17.google.com/fcm/send/test',
      keys: subscription,
    }),
  ).toMatchObject({ endpoint: 'https://jmt17.google.com/fcm/send/test' });
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://fcm.googleapis.com@localhost/x',
    'https://jmt17.google.com/unrelated',
  ]) {
    expect(() => validatePushSubscription({ endpoint, keys: subscription })).toThrow(
      'invalid_push_subscription',
    );
  }
  expect(() =>
    validatePushSubscription({
      endpoint: subscription.endpoint,
      keys: { ...subscription, auth: 'short' },
    }),
  ).toThrow('invalid_push_subscription');
  expect(getPushEnvironment()).not.toBeNull();
  expect(sourceVersionHash('a')).not.toBe(sourceVersionHash('b'));
});

test('registration does not take another owner’s endpoint or exceed the device limit', async () => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: OWNER }]),
    profile: {
      findUnique: vi.fn(async () => ({
        notificationsEnabled: true,
        browserNotificationsEnabled: true,
      })),
    },
    pushSubscription: {
      findUnique: vi.fn(async () => ({ id: subscription.id, ownerId: 'different-owner' })),
      count: vi.fn(async () => 10),
      create: vi.fn(),
    },
  };
  database.client = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
  const input = {
    endpoint: subscription.endpoint,
    keys: { auth: subscription.auth, p256dh: subscription.p256dh },
    locale: 'en',
  };
  await expect(registerPushSubscription(OWNER, input)).rejects.toThrow(
    'push_subscription_conflict',
  );
  tx.pushSubscription.findUnique.mockResolvedValueOnce(null as never);
  await expect(registerPushSubscription(OWNER, input)).rejects.toThrow('push_subscription_limit');
  expect(tx.pushSubscription.create).not.toHaveBeenCalled();
});

test('a durable pre-send claim prevents concurrent sweeps from sending twice', async () => {
  const { client, state } = installDatabase();
  const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  await Promise.all([
    dispatchNotifications({ now: NOW, send }),
    dispatchNotifications({ now: NOW, send }),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(state()).toBe('ACCEPTED');
  expect(client.pushDelivery.updateMany).toHaveBeenCalled();
  expect(JSON.stringify(send.mock.calls)).not.toContain('TROVE_VAPID_PRIVATE_KEY');
});

test('past deliveries cannot fill the send cap ahead of an unsent reminder', async () => {
  const { client } = installDatabase();
  const sources = Array.from({ length: 101 }, (_, index) => ({
    candidate: { ...candidate, sourceId: `source-${index}`, sourceVersion: `version-${index}` },
    ownerId: OWNER,
  }));
  candidates.listDueNotificationCandidates.mockResolvedValueOnce(sources);
  candidates.currentDueCandidate.mockImplementation(async (value) => value);
  candidates.upsertCandidate.mockImplementation(async (_ownerId, value) => ({
    id: `notification-${value.sourceId}`,
    readAt: null,
    sourceVersion: value.sourceVersion,
  }));
  client.pushDelivery.findMany.mockImplementation(
    async (query?: { where: { notificationId: string } }) =>
      query?.where.notificationId === 'notification-source-100'
        ? []
        : [{ subscriptionId: subscription.id, state: 'ACCEPTED', nextAttemptAt: null }],
  );
  client.notification.findUnique.mockResolvedValue({
    id: 'notification-source-100',
    readAt: null,
    sourceVersion: 'version-100',
  });
  const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  const report = await dispatchNotifications({ now: NOW, send });
  expect(report.attempted).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
});

test('read, cancelled, or materially changed reminders never reach the push service', async () => {
  const { client } = installDatabase();
  const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  candidates.upsertCandidate.mockResolvedValueOnce({ id: 'notification-1', readAt: NOW });
  expect((await dispatchNotifications({ now: NOW, send })).attempted).toBe(0);

  candidates.currentDueCandidate.mockResolvedValueOnce(null);
  expect((await dispatchNotifications({ now: NOW, send })).attempted).toBe(0);

  client.notification.findUnique.mockResolvedValueOnce({
    id: 'notification-1',
    readAt: null,
    sourceVersion: 'edited-v2',
  });
  expect((await dispatchNotifications({ now: NOW, send })).attempted).toBe(0);
  expect(send).not.toHaveBeenCalled();
});

test('uncertain transport stays attempted while definite rate limiting can retry before expiry', async () => {
  const { state } = installDatabase();
  const uncertain = vi.fn().mockRejectedValue(new Error('timeout'));
  await dispatchNotifications({ now: NOW, send: uncertain });
  await dispatchNotifications({ now: NOW, send: uncertain });
  expect(uncertain).toHaveBeenCalledTimes(1);
  expect(state()).toBe('ATTEMPTED');

  installDatabase();
  const rateLimited = vi
    .fn()
    .mockRejectedValueOnce({ statusCode: 429 })
    .mockResolvedValue({ statusCode: 201 });
  await dispatchNotifications({ now: NOW, send: rateLimited });
  await dispatchNotifications({ now: new Date(NOW.getTime() + 5 * 60_000), send: rateLimited });
  expect(rateLimited).toHaveBeenCalledTimes(2);
  expect(classifyPushFailure({ statusCode: 410 })).toBe('expired');
});

test('a dead endpoint is removed without retrying or logging its address', async () => {
  const { client } = installDatabase();
  const send = vi.fn().mockRejectedValue({ statusCode: 410 });
  const report = await dispatchNotifications({ now: NOW, send });
  expect(report.deadSubscriptions).toBe(1);
  expect(client.pushSubscription.deleteMany).toHaveBeenCalledWith({
    where: { id: subscription.id, ownerId: OWNER },
  });
  expect(JSON.stringify(report)).not.toContain(subscription.endpoint);
});
