import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  getTripNotificationPreference,
  listNotifications,
  markAllNotificationsRead,
  NotificationNotFoundError,
  updateNotification,
  updateNotificationSettings,
  updateTripNotificationPreference,
} from '../services/notifications.js';
import {
  hasPushSubscription,
  publicPushConfiguration,
  PushSubscriptionError,
  registerPushSubscription,
  removePushSubscription,
} from '../services/web-push.js';

const notificationParamsSchema = z.object({ notificationId: z.uuid() }).strict();
const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const notificationUpdateSchema = z
  .object({
    browserDelivered: z.literal(true).optional(),
    read: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => value.browserDelivered || value.read);
const settingsSchema = z
  .object({
    browserEnabled: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.browserEnabled !== undefined || value.enabled !== undefined);
const tripPreferenceSchema = z.object({ muted: z.boolean() }).strict();
const pushSubscriptionSchema = z
  .object({
    endpoint: z.url().max(2048),
    keys: z
      .object({ auth: z.string().min(1).max(128), p256dh: z.string().min(1).max(256) })
      .strict(),
    locale: z.literal('en'),
  })
  .strict();
const pushRemovalSchema = z.object({ endpoint: z.url().max(2048) }).strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof NotificationNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof PushSubscriptionError) {
    const status =
      error.code === 'push_unavailable'
        ? 503
        : error.code === 'push_subscription_conflict' ||
            error.code === 'push_subscription_limit' ||
            error.code === 'push_not_enabled'
          ? 409
          : 400;
    return reply.code(status).send({ code: error.code });
  }
  throw error;
}

export function createNotificationControllers() {
  return {
    async getPushConfig(request: FastifyRequest, reply: FastifyReply) {
      if (!getUserId(request, reply)) return;
      return reply.send(publicPushConfiguration());
    },

    async registerPush(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = pushSubscriptionSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_push_subscription' });
      try {
        return reply.code(201).send(await registerPushSubscription(userId, body.data));
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async removePush(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = pushRemovalSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_push_subscription' });
      await removePushSubscription(userId, body.data.endpoint);
      return reply.code(204).send();
    },

    async pushStatus(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = pushRemovalSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_push_subscription' });
      return reply.send({ registered: await hasPushSubscription(userId, body.data.endpoint) });
    },
    async getNotifications(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      if (!userId) return;
      try {
        return reply.send(await listNotifications(userId));
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateSettings(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = settingsSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_notification_settings' });
      try {
        return reply.send({ settings: await updateNotificationSettings(userId, body.data) });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateNotification(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = notificationParamsSchema.safeParse(request.params);
      const body = notificationUpdateSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_notification' });
      }
      try {
        await updateNotification(userId, params.data.notificationId, body.data);
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async markAllRead(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      if (!userId) return;
      await markAllNotificationsRead(userId);
      return reply.code(204).send();
    },

    async getTripPreference(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
      try {
        return reply.send({
          preference: await getTripNotificationPreference(userId, params.data.tripId),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateTripPreference(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = tripPreferenceSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_trip_notification_preference' });
      }
      try {
        return reply.send({
          preference: await updateTripNotificationPreference(
            userId,
            params.data.tripId,
            body.data.muted,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
