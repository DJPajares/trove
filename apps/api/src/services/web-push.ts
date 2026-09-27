import { createHash } from 'node:crypto';

import { getPrismaClient } from '@trove/db';
import webPush from 'web-push';

import englishCopy from '../i18n/push/en.json' with { type: 'json' };

import {
  currentDueCandidate,
  listDueNotificationCandidates,
  upsertCandidate,
  type NotificationCandidate,
} from './notifications.js';

const MAX_SUBSCRIPTIONS = 10;
const MAX_SENDS = 100;
const SEND_CONCURRENCY = 4;
const PUSH_TIMEOUT_MS = 5_000;

export class PushSubscriptionError extends Error {
  constructor(
    public readonly code:
      | 'push_unavailable'
      | 'invalid_push_subscription'
      | 'push_subscription_conflict'
      | 'push_subscription_limit'
      | 'push_not_enabled',
  ) {
    super(code);
  }
}

function keyBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

export function getPushEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const publicKey = environment.TROVE_VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.TROVE_VAPID_PRIVATE_KEY?.trim();
  const subject = environment.TROVE_VAPID_SUBJECT?.trim();
  if (
    !publicKey ||
    !privateKey ||
    !subject ||
    keyBytes(publicKey)?.length !== 65 ||
    keyBytes(privateKey)?.length !== 32 ||
    !/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$|^https:\/\//.test(subject)
  )
    return null;
  return { publicKey, privateKey, subject };
}

export function publicPushConfiguration() {
  const config = getPushEnvironment();
  return { available: Boolean(config), publicKey: config?.publicKey ?? null };
}

const pushHosts = [
  'fcm.googleapis.com',
  // Chromium-based test builds may use Google's staging push endpoint.
  'jmt17.google.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];

export function validatePushSubscription(input: {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}) {
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    throw new PushSubscriptionError('invalid_push_subscription');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    input.endpoint.length > 2048 ||
    (url.hostname === 'jmt17.google.com' && !url.pathname.startsWith('/fcm/send/')) ||
    !(
      pushHosts.includes(url.hostname) ||
      url.hostname.endsWith('.push.apple.com') ||
      url.hostname.endsWith('.notify.windows.com')
    )
  ) {
    throw new PushSubscriptionError('invalid_push_subscription');
  }
  const publicKey = keyBytes(input.keys.p256dh);
  const auth = keyBytes(input.keys.auth);
  if (publicKey?.length !== 65 || publicKey[0] !== 4 || auth?.length !== 16) {
    throw new PushSubscriptionError('invalid_push_subscription');
  }
  return { endpoint: url.toString(), p256dh: input.keys.p256dh, auth: input.keys.auth };
}

export async function registerPushSubscription(
  ownerId: string,
  input: {
    endpoint: string;
    keys: { auth: string; p256dh: string };
    locale: string;
  },
) {
  if (!getPushEnvironment()) throw new PushSubscriptionError('push_unavailable');
  const subscription = validatePushSubscription(input);
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      // Serializes registrations and global disable for this owner, including
      // simultaneous devices approaching the per-owner limit.
      await tx.$queryRaw`SELECT id FROM "trove"."profiles" WHERE id = ${ownerId}::uuid FOR UPDATE`;
      const profile = await tx.profile.findUnique({
        where: { id: ownerId },
        select: {
          notificationsEnabled: true,
          browserNotificationsEnabled: true,
        },
      });
      if (!profile?.notificationsEnabled || !profile.browserNotificationsEnabled) {
        throw new PushSubscriptionError('push_not_enabled');
      }
      const existing = await tx.pushSubscription.findUnique({
        where: { endpoint: subscription.endpoint },
      });
      if (existing && existing.ownerId !== ownerId)
        throw new PushSubscriptionError('push_subscription_conflict');
      if (
        !existing &&
        (await tx.pushSubscription.count({ where: { ownerId } })) >= MAX_SUBSCRIPTIONS
      ) {
        throw new PushSubscriptionError('push_subscription_limit');
      }
      if (existing) {
        await tx.pushSubscription.update({
          where: { id: existing.id },
          data: { auth: subscription.auth, p256dh: subscription.p256dh, locale: 'en' },
        });
        return { id: existing.id };
      }
      return tx.pushSubscription.create({
        data: { ...subscription, ownerId, locale: 'en' },
        select: { id: true },
      });
    });
  } catch (error) {
    // A concurrent registration by another account must not steal the endpoint.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw new PushSubscriptionError('push_subscription_conflict');
    }
    throw error;
  }
}

export async function removePushSubscription(ownerId: string, endpoint: string) {
  await getPrismaClient().pushSubscription.deleteMany({ where: { ownerId, endpoint } });
}

export async function hasPushSubscription(ownerId: string, endpoint: string) {
  return Boolean(
    await getPrismaClient().pushSubscription.findFirst({
      where: { ownerId, endpoint },
      select: { id: true },
    }),
  );
}

function pushText(candidate: NotificationCandidate, locale: string) {
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: candidate.timeZone,
  }).format(candidate.eventAt);
  const copy =
    candidate.kind === 'TASK_DUE'
      ? englishCopy.task_due
      : candidate.kind === 'RESERVATION_UPCOMING'
        ? englishCopy.reservation_upcoming
        : englishCopy.leave_by;
  return {
    title: copy.title,
    body: copy.body
      .replace('{label}', candidate.label)
      .replace('{trip}', candidate.tripName)
      .replace('{time}', time),
  };
}

export function sourceVersionHash(sourceVersion: string) {
  return createHash('sha256').update(sourceVersion).digest('hex');
}

export function classifyPushFailure(error: unknown): 'expired' | 'rate_limited' | 'uncertain' {
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : null;
  if (status === 404 || status === 410) return 'expired';
  if (status === 429) return 'rate_limited';
  return 'uncertain';
}

type PushTransport = typeof webPush.sendNotification;

/** A pre-send database claim is the at-most-once boundary. Only explicit 429
 * rejection can reopen a claim; a timeout remains attempted. */
export async function dispatchNotifications(
  options: {
    now?: Date;
    send?: PushTransport;
  } = {},
) {
  const config = getPushEnvironment();
  if (!config) throw new PushSubscriptionError('push_unavailable');
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const prisma = getPrismaClient();
  const now = options.now ?? new Date();
  const sourceCandidates = await listDueNotificationCandidates(now);
  const jobs: Array<{
    candidate: NotificationCandidate;
    ownerId: string;
    subscription: {
      id: string;
      endpoint: string;
      auth: string;
      p256dh: string;
      locale: string;
    };
    notificationId: string;
  }> = [];
  for (const { candidate, ownerId } of sourceCandidates) {
    if (jobs.length >= MAX_SENDS) break;
    const notification = await upsertCandidate(ownerId, candidate);
    if (notification.readAt) continue;
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { ownerId },
      take: MAX_SUBSCRIPTIONS,
    });
    if (!subscriptions.length) continue;
    const existing = await prisma.pushDelivery.findMany({
      where: {
        notificationId: notification.id,
        sourceVersion: sourceVersionHash(candidate.sourceVersion),
        subscriptionId: { in: subscriptions.map((subscription) => subscription.id) },
      },
      select: { nextAttemptAt: true, state: true, subscriptionId: true },
    });
    const existingBySubscription = new Map(
      existing.map((delivery) => [delivery.subscriptionId, delivery]),
    );
    for (const subscription of subscriptions) {
      if (jobs.length >= MAX_SENDS) break;
      const delivery = existingBySubscription.get(subscription.id);
      if (
        delivery &&
        (delivery.state === 'ACCEPTED' ||
          delivery.state === 'ATTEMPTED' ||
          (delivery.state === 'RETRYABLE' &&
            (!delivery.nextAttemptAt || delivery.nextAttemptAt > now)))
      )
        continue;
      jobs.push({ candidate, ownerId, subscription, notificationId: notification.id });
    }
  }

  const counts = {
    accepted: 0,
    attempted: 0,
    deadSubscriptions: 0,
    dueSources: sourceCandidates.length,
    rateLimited: 0,
    skipped: 0,
  };
  let cursor = 0;
  const send = options.send ?? webPush.sendNotification.bind(webPush);
  await Promise.all(
    Array.from({ length: SEND_CONCURRENCY }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) continue;
        const checkedAt = options.now ?? new Date();
        const current = await currentDueCandidate(job.candidate, job.ownerId, checkedAt);
        if (!current) {
          counts.skipped += 1;
          continue;
        }
        const notification = await prisma.notification.findUnique({
          where: { id: job.notificationId },
        });
        const subscription = await prisma.pushSubscription.findFirst({
          where: { id: job.subscription.id, ownerId: job.ownerId },
        });
        if (
          !notification ||
          notification.readAt ||
          notification.sourceVersion !== current.sourceVersion ||
          !subscription
        ) {
          counts.skipped += 1;
          continue;
        }
        const version = sourceVersionHash(current.sourceVersion);
        const delivery = await prisma.pushDelivery.upsert({
          where: {
            subscriptionId_notificationId_sourceVersion: {
              subscriptionId: subscription.id,
              notificationId: notification.id,
              sourceVersion: version,
            },
          },
          create: {
            ownerId: job.ownerId,
            subscriptionId: subscription.id,
            notificationId: notification.id,
            sourceVersion: version,
          },
          update: {},
        });
        const claim = await prisma.pushDelivery.updateMany({
          where: {
            id: delivery.id,
            OR: [{ state: 'PENDING' }, { state: 'RETRYABLE', nextAttemptAt: { lte: checkedAt } }],
          },
          data: {
            state: 'ATTEMPTED',
            attemptedAt: checkedAt,
            attempts: { increment: 1 },
            nextAttemptAt: null,
          },
        });
        if (!claim.count) {
          counts.skipped += 1;
          continue;
        }
        counts.attempted += 1;
        const expiresInSeconds = Math.floor(
          (current.eventAt.getTime() - checkedAt.getTime()) / 1_000,
        );
        if (expiresInSeconds <= 0) continue;
        const copy = pushText(current, subscription.locale);
        const payload = JSON.stringify({
          ...copy,
          ownerId: job.ownerId,
          expiresAt: current.eventAt.toISOString(),
          url: `/trips/${current.tripId}/${current.kind === 'TASK_DUE' ? 'tasks' : current.kind === 'RESERVATION_UPCOMING' ? 'reservations' : 'mode'}`,
          tag: `trove-${notification.id}-${version.slice(0, 16)}`,
        });
        try {
          await send(
            {
              endpoint: subscription.endpoint,
              keys: { auth: subscription.auth, p256dh: subscription.p256dh },
            },
            payload,
            { TTL: expiresInSeconds, timeout: PUSH_TIMEOUT_MS },
          );
          await prisma.pushDelivery.update({
            where: { id: delivery.id },
            data: { state: 'ACCEPTED', acceptedAt: new Date() },
          });
          counts.accepted += 1;
        } catch (error) {
          const failure = classifyPushFailure(error);
          if (failure === 'expired') {
            await prisma.pushSubscription.deleteMany({
              where: { id: subscription.id, ownerId: job.ownerId },
            });
            counts.deadSubscriptions += 1;
          } else if (failure === 'rate_limited') {
            const retryAt = new Date(
              checkedAt.getTime() + Math.min(15, 2 ** Math.min(delivery.attempts, 4)) * 60_000,
            );
            if (retryAt < current.eventAt) {
              await prisma.pushDelivery.update({
                where: { id: delivery.id },
                data: { state: 'RETRYABLE', nextAttemptAt: retryAt },
              });
              counts.rateLimited += 1;
            }
          }
          // Unknown transport outcome stays ATTEMPTED; it is never sent twice.
        }
      }
    }),
  );
  const pending = await prisma.pushDelivery.aggregate({
    where: { state: { in: ['PENDING', 'RETRYABLE'] } },
    _count: true,
    _min: { createdAt: true },
  });
  return {
    ...counts,
    pending: pending._count,
    oldestPendingAgeSeconds: pending._min.createdAt
      ? Math.floor((now.getTime() - pending._min.createdAt.getTime()) / 1_000)
      : null,
  };
}
