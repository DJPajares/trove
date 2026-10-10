import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getBearerToken } from './request-auth.js';

export type AdminScope = 'ai_planner:reset' | 'entitlements:write';
export type AdminPrincipal = { actorId: string; credentialId: string };
const credentialSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
    actorId: z.string().trim().min(1).max(120),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime({ offset: true }),
    scopes: z.array(z.enum(['ai_planner:reset', 'entitlements:write'])).min(1),
  })
  .strict();
const credentialsSchema = z
  .array(credentialSchema)
  .min(1)
  .max(100)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length);

export function authenticateAdmin(
  authorization: string | undefined,
  scope: AdminScope,
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): { principal: AdminPrincipal; status: 200 } | { code: string; status: 401 | 403 | 503 } {
  let credentials: z.infer<typeof credentialsSchema>;
  try {
    credentials = credentialsSchema.parse(JSON.parse(environment.ADMIN_CREDENTIALS ?? 'null'));
  } catch {
    return { code: 'admin_configuration_missing', status: 503 };
  }
  const token = getBearerToken(authorization);
  // Dedicated format; Supabase user JWTs and scheduler credentials never match.
  const match = token?.match(/^([a-zA-Z0-9_-]{1,120})\.([a-zA-Z0-9_-]{43})$/);
  if (!match) return { code: 'unauthorized', status: 401 };
  const credential = credentials.find(({ id }) => id === match[1]);
  if (!credential || new Date(credential.expiresAt) <= now)
    return { code: 'unauthorized', status: 401 };
  const digest = createHash('sha256').update(token!).digest();
  if (!timingSafeEqual(digest, Buffer.from(credential.sha256, 'hex')))
    return { code: 'unauthorized', status: 401 };
  if (!credential.scopes.includes(scope)) return { code: 'admin_scope_required', status: 403 };
  return { status: 200, principal: { actorId: credential.actorId, credentialId: credential.id } };
}

export function requireAdmin(scope: AdminScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = authenticateAdmin(request.headers.authorization, scope);
    if (result.status !== 200) {
      request.log.warn(
        { kind: 'admin_authorization_rejected', code: result.code },
        'admin authorization rejected',
      );
      return reply.code(result.status).send({ code: result.code });
    }
    request.adminPrincipal = result.principal;
  };
}
