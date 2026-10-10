import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  RECOVERY_WINDOW_SECONDS,
  sessionIdentityFromClaims,
  type RecoveryIdentity,
} from '@/lib/auth/recovery';

export type RecoveryGrant = {
  userId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

/** Server-only signing material. Never use a publishable key or session token. */
export function recoverySigningKey() {
  const value = process.env.AUTH_RECOVERY_SECRET;
  return value && /^[A-Za-z0-9_-]{43,}$/.test(value) && Buffer.from(value, 'base64url').length >= 32
    ? Buffer.from(value, 'base64url')
    : null;
}

function signature(payload: string, key: Buffer) {
  return createHmac('sha256', key).update(`trove:password-recovery:v1.${payload}`).digest();
}

/** Mint only after Supabase accepts a recovery hash or verifies recovery AMR. */
export function createRecoveryGrant(
  identity: RecoveryIdentity,
  now = Math.floor(Date.now() / 1000),
) {
  const key = recoverySigningKey();
  if (!key) throw new Error('recovery_not_configured');
  const payload = Buffer.from(
    JSON.stringify({
      userId: identity.userId,
      sessionId: identity.sessionId,
      issuedAt: now,
      expiresAt: now + RECOVERY_WINDOW_SECONDS,
    }),
  ).toString('base64url');
  return `${payload}.${signature(payload, key).toString('base64url')}`;
}

export function verifyRecoveryGrant(
  value: string | undefined,
  now = Date.now() / 1000,
): RecoveryGrant | null {
  const key = recoverySigningKey();
  if (!key || !value || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, mac] = parts as [string, string];
  const supplied = Buffer.from(mac, 'base64url');
  const expected = signature(payload, key);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecoveryGrant;
    return grant &&
      typeof grant.userId === 'string' &&
      !!grant.userId &&
      typeof grant.sessionId === 'string' &&
      !!grant.sessionId &&
      Number.isSafeInteger(grant.issuedAt) &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.issuedAt <= now + 60 &&
      grant.expiresAt > now &&
      grant.expiresAt === grant.issuedAt + RECOVERY_WINDOW_SECONDS
      ? grant
      : null;
  } catch {
    return null;
  }
}

export function recoveryFromGrant(
  identity: { user: { id: string; email?: string }; claims: Record<string, unknown> } | null,
  grant: RecoveryGrant | null | undefined,
  now = Date.now() / 1000,
): RecoveryIdentity | null {
  if (!identity || !grant || grant.expiresAt <= now || grant.issuedAt > now + 60) return null;
  const session = sessionIdentityFromClaims(identity.claims, identity.user, now);
  return session && session.userId === grant.userId && session.sessionId === grant.sessionId
    ? session
    : null;
}
