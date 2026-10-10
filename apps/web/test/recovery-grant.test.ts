import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRecoveryGrant,
  recoveryFromGrant,
  recoverySigningKey,
  verifyRecoveryGrant,
} from '@/lib/auth/recovery-grant';

const now = 1700000000;
const identity = { userId: 'user', sessionId: 'session', email: 'user@example.test' };
const authenticated = {
  user: { id: identity.userId, email: identity.email },
  claims: {
    sub: identity.userId,
    session_id: identity.sessionId,
    role: 'authenticated',
    exp: now + 7200,
    amr: [{ method: 'otp', timestamp: now }],
  },
};
beforeEach(() => vi.stubEnv('AUTH_RECOVERY_SECRET', Buffer.alloc(32, 2).toString('base64url')));
afterEach(() => vi.unstubAllEnvs());

describe('server-signed recovery receipts', () => {
  it('binds a verified OTP recovery to its user and session for one hour', () => {
    const receipt = createRecoveryGrant(identity, now);
    const grant = verifyRecoveryGrant(receipt, now + 3599);
    expect(recoveryFromGrant(authenticated, grant, now + 3599)).toEqual(identity);
    expect(verifyRecoveryGrant(receipt, now + 3600)).toBeNull();
  });
  it.each([undefined, '', 'unsigned', 'a.b', 'a.b.c', 'x'.repeat(2049)])(
    'rejects malformed receipt %j',
    (receipt) => {
      expect(verifyRecoveryGrant(receipt, now)).toBeNull();
    },
  );
  it('rejects edits to the user/session/expiry without the server key', () => {
    const receipt = createRecoveryGrant(identity, now);
    const [, mac] = receipt.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        userId: 'other-user',
        sessionId: 'other-session',
        issuedAt: now,
        expiresAt: now + 7200,
      }),
    ).toString('base64url');
    expect(verifyRecoveryGrant(`${forged}.${mac}`, now)).toBeNull();
  });
  it('rejects signatures after key rotation', () => {
    const receipt = createRecoveryGrant(identity, now);
    vi.stubEnv('AUTH_RECOVERY_SECRET', Buffer.alloc(32, 3).toString('base64url'));
    expect(verifyRecoveryGrant(receipt, now)).toBeNull();
  });
  it('rejects future-dated receipts', () => {
    expect(verifyRecoveryGrant(createRecoveryGrant(identity, now + 120), now)).toBeNull();
  });
  it.each(['', 'short', '<secret>', Buffer.alloc(16).toString('base64url')])(
    'fails closed with unusable signing material %s',
    (secret) => {
      vi.stubEnv('AUTH_RECOVERY_SECRET', secret);
      expect(recoverySigningKey()).toBeNull();
      expect(() => createRecoveryGrant(identity, now)).toThrow('recovery_not_configured');
    },
  );
  it.each([
    { sub: 'another-user' },
    { session_id: 'another-session' },
    { exp: now - 1 },
    { role: 'service_role' },
  ])('rejects current identity claims %j', (override) => {
    const grant = verifyRecoveryGrant(createRecoveryGrant(identity, now), now);
    expect(
      recoveryFromGrant(
        { ...authenticated, claims: { ...authenticated.claims, ...override } },
        grant,
        now,
      ),
    ).toBeNull();
  });
  it('never authorizes OTP claims or editable metadata without a signed receipt', () => {
    expect(recoveryFromGrant(authenticated, null, now)).toBeNull();
    expect(
      recoveryFromGrant(
        {
          ...authenticated,
          claims: { ...authenticated.claims, user_metadata: { recovery: true } },
        },
        null,
        now,
      ),
    ).toBeNull();
  });
});
