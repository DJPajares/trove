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
  throw error;
}

export function createNotificationControllers() {
  return {
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
