import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getBearerToken } from '../services/request-auth.js';
import { getProfile, normalizeLegacyAppearance, updateProfile } from '../services/profile.js';

const profileUpdateSchema = z
  .object({
    appearance: z
      .enum(['dark', 'light', 'system'])
      .transform(normalizeLegacyAppearance)
      .nullable()
      .optional(),
    avatarPath: z.string().trim().max(512).nullable().optional(),
    dateFormat: z.enum(['dmy', 'mdy', 'ymd']).nullable().optional(),
    displayName: z.string().trim().max(100).nullable().optional(),
    distanceUnit: z.enum(['km', 'mi']).nullable().optional(),
    homeCurrencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    homeLocation: z.string().trim().max(200).nullable().optional(),
    temperatureUnit: z.enum(['celsius', 'fahrenheit']).nullable().optional(),
    timeFormat: z.enum(['12h', '24h']).nullable().optional(),
  })
  .strict();

function getRequestContext(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.authUserId;
  const accessToken = getBearerToken(request.headers.authorization);

  if (!userId || !accessToken) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }

  return { accessToken, userId };
}

export async function getProfileController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);

  if (!context) {
    return;
  }

  return { profile: await getProfile(context.userId, context.accessToken) };
}

export async function updateProfileController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);

  if (!context) {
    return;
  }

  const parsed = profileUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ code: 'invalid_profile' });
  }

  if (
    parsed.data.avatarPath !== undefined &&
    parsed.data.avatarPath !== null &&
    !parsed.data.avatarPath.startsWith(`${context.userId}/`)
  ) {
    return reply.code(400).send({ code: 'invalid_avatar_path' });
  }

  return { profile: await updateProfile(context.userId, context.accessToken, parsed.data) };
}
