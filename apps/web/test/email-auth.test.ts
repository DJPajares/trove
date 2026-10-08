import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { completeEmailAuth, resetRecoveryPassword } from '@/lib/auth/email-flow';
import { parseEmailLink, validateEmailLink } from '@/lib/auth/email-link';
import { isSameOriginAuthPost, AUTH_RESPONSE_HEADERS } from '@/lib/auth/http';
import {
  buildEmailRedirectUrl,
  getSafeRedirectPath,
  isSensitiveAuthUrl,
} from '@/lib/auth/redirect';
import { recoveryIdentityFromClaims } from '@/lib/auth/recovery';

const now = Math.floor(Date.now() / 1000);
const user = { id: 'recovery-user', email: 'traveller@example.test' };
const claims = {
  sub: user.id,
  role: 'authenticated',
  session_id: 'recovery-session',
  exp: now + 3600,
  amr: [{ method: 'recovery', timestamp: now }],
};
const session = { access_token: 'verified.access.token', refresh_token: 'refresh-token', user };
const otp = {
  kind: 'otp',
  tokenHash: 'a'.repeat(64),
  type: 'recovery',
  recovery: true,
  next: '/trips/123?day=2#place',
};
const reset = {
  userId: user.id,
  sessionId: claims.session_id,
  password: 'new-password',
  confirmation: 'new-password',
  next: '/trips',
};

function fakeClient(overrides: Record<string, unknown> = {}) {
  const auth = {
    verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    setSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    getClaims: vi.fn().mockResolvedValue({ data: { claims }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    ...overrides,
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

describe('application return paths', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/\t/evil.test',
    '/\n/evil.test',
    '/%5cevil.test',
    '/%0a/evil.test',
    '/sign-in',
    '/sign-in/',
    '/%73ign-in',
    '/auth/confirm',
    '/reset-password',
    '/onboarding',
    '/onboarding/',
    '/%6fnboarding/',
    '/trips/../sign-up',
    '',
  ])('rejects %j', (value) => {
    expect(getSafeRedirectPath(value)).toBe('/');
  });
  it('retains a valid trip query and anchor', () =>
    expect(getSafeRedirectPath('/trips/123?day=2#place')).toBe('/trips/123?day=2#place'));
  it.each([
    'http://localhost:3000',
    'https://trove-preview-djpajares-projects.vercel.app',
    'https://trove.wndrhive.com',
  ])('keeps email redirects in %s', (origin) => {
    const url = new URL(buildEmailRedirectUrl(origin, '/trips/123?day=2#place', 'recovery'));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe('/auth/confirm');
    expect(url.searchParams.get('next')).toBe('/trips/123?day=2#place');
    expect(url.searchParams.get('flow')).toBe('recovery');
  });
});

describe('email link parsing', () => {
  const parse = (suffix: string) =>
    parseEmailLink(new URL(`https://trove.invalid/auth/confirm${suffix}`));
  it('accepts a recovery hash without browser PKCE state', () => {
    expect(parse(`?token_hash=${otp.tokenHash}&type=recovery&flow=recovery`)).toMatchObject({
      link: { kind: 'otp', recovery: true },
    });
  });
  it('accepts a PKCE code with its flow ID', () =>
    expect(parse('?code=auth-code-value&sb_flow_id=flow-id-123')).toMatchObject({
      link: { kind: 'code', flowId: 'flow-id-123' },
    }));
  it('accepts a legacy token fragment', () =>
    expect(
      parse('#access_token=one.two.three&refresh_token=refresh-token&type=recovery'),
    ).toMatchObject({ link: { kind: 'tokens', recovery: true } }));
  it.each([
    '',
    '?token_hash=valid-token-hash',
    '?code=',
    '?code=valid-code&sb_flow_id=bad',
    '?type=invite&code=valid-code',
    '?flow=wrong&code=valid-code',
    '?code=one-code&code=two-code',
    '?code=valid-code#code=other-code',
    `?code=valid-code&token_hash=${otp.tokenHash}&type=email`,
    '#access_token=one.two.three',
    '#refresh_token=token',
    '#access_token=broken&refresh_token=token',
    `?token_hash=${otp.tokenHash}&type=email&flow=recovery`,
    '?error_description=%3Cscript%3E',
  ])('rejects missing/ambiguous credentials: %s', (value) =>
    expect(parse(value)).toEqual({ error: 'invalidLink' }),
  );
  it('maps used or expired provider errors without exposing their text', () => {
    expect(parse('#error=access_denied&error_code=otp_expired&error_description=secret')).toEqual({
      error: 'expiredLink',
    });
  });
  it('rejects conflicting credentials in JSON before any Auth call', () =>
    expect(validateEmailLink({ ...otp, code: 'other-code' })).toBeNull());
});

describe('recovery authorization', () => {
  it('requires a recent provider-signed recovery method and matching identity', () =>
    expect(recoveryIdentityFromClaims(claims, user, now)).toEqual({
      userId: user.id,
      sessionId: claims.session_id,
      email: user.email,
    }));
  it.each([
    { amr: [{ method: 'password', timestamp: now }] },
    { amr: [{ method: 'recovery', timestamp: now - 3601 }] },
    { amr: [{ method: 'recovery', timestamp: now + 120 }] },
    { amr: [{ method: 'recovery', timestamp: 'now' }] },
    { session_id: '' },
    { exp: now - 1 },
    { sub: 'another-user' },
    { role: 'service_role' },
    { amr: null },
  ])('rejects invalid recovery claims: %j', (override) =>
    expect(recoveryIdentityFromClaims({ ...claims, ...override }, user, now)).toBeNull(),
  );
  it('does not treat user metadata as authentication evidence', () =>
    expect(
      recoveryIdentityFromClaims(
        { ...claims, amr: [], user_metadata: { recovery: true } },
        user,
        now,
      ),
    ).toBeNull());
});

describe('session establishment', () => {
  it('verifies the OTP, verifies its identity, and redirects recovery to reset', async () => {
    const { client, auth } = fakeClient();
    const result = await completeEmailAuth(client, otp);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: otp.tokenHash, type: 'recovery' });
    expect(auth.getClaims).toHaveBeenCalledWith(session.access_token);
    expect(auth.getUser).toHaveBeenCalledWith(session.access_token);
    expect(result).toMatchObject({
      userId: user.id,
      redirect: '/reset-password?next=%2Ftrips%2F123%3Fday%3D2%23place',
    });
  });
  it('routes verified signup to its destination', async () => {
    const { client } = fakeClient({
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { ...claims, amr: [{ method: 'email/signup', timestamp: now }] } },
        error: null,
      }),
    });
    expect(
      await completeEmailAuth(client, { ...otp, type: 'email', recovery: false }),
    ).toMatchObject({ redirect: otp.next });
  });
  it('passes the flow ID to PKCE exchange and derives recovery from verified claims', async () => {
    const { client, auth } = fakeClient();
    expect(
      await completeEmailAuth(client, {
        kind: 'code',
        code: 'legacy-auth-code',
        flowId: 'legacy-flow-id',
        recovery: false,
        next: '/',
      }),
    ).toMatchObject({ redirect: '/reset-password?next=%2F' });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('legacy-auth-code', {
      flowId: 'legacy-flow-id',
    });
  });
  it('does not reuse an existing session after a used link fails', async () => {
    const { client, auth } = fakeClient({
      verifyOtp: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { code: 'otp_expired', status: 403 },
      }),
    });
    expect(await completeEmailAuth(client, otp)).toEqual({ error: 'expiredLink' });
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it('does not install legacy tokens that falsely claim to be recovery', async () => {
    const { client, auth } = fakeClient({
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: { claims: { ...claims, amr: [] } }, error: null }),
    });
    expect(
      await completeEmailAuth(client, {
        kind: 'tokens',
        accessToken: 'one.two.three',
        refreshToken: 'refresh',
        recovery: true,
        next: '/',
      }),
    ).toEqual({ error: 'invalidLink' });
    expect(auth.setSession).not.toHaveBeenCalled();
  });
  it('rejects provider validation failure even when session data exists', async () => {
    const { client } = fakeClient({
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: { status: 401 } }),
    });
    expect(await completeEmailAuth(client, otp)).toEqual({ error: 'invalidLink' });
  });
});

describe('password mutation', () => {
  it('updates only the validated recovery account and sanitizes the destination', async () => {
    const { client, auth } = fakeClient();
    expect(await resetRecoveryPassword(client, { ...reset, next: '/\\evil.test' })).toEqual({
      redirect: '/',
    });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: reset.password });
  });
  it.each([
    { userId: 'another-account' },
    { sessionId: 'another-session' },
    { password: 'short' },
    { confirmation: 'wrong' },
  ])('does not update for %j', async (override) => {
    const { client, auth } = fakeClient();
    expect(await resetRecoveryPassword(client, { ...reset, ...override })).toHaveProperty('error');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects an ordinary signed-in session', async () => {
    const { client, auth } = fakeClient({
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: { claims: { ...claims, amr: [] } }, error: null }),
    });
    expect(await resetRecoveryPassword(client, reset)).toEqual({ error: 'invalidLink' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it.each([
    ['same_password', 'samePassword'],
    ['weak_password', 'weakPassword'],
    ['over_request_rate_limit', 'rateLimit'],
  ])('maps %s safely', async (code, error) => {
    const { client } = fakeClient({
      updateUser: vi.fn().mockResolvedValue({ error: { code, status: 422 } }),
    });
    expect(await resetRecoveryPassword(client, reset)).toEqual({ error });
  });
});

describe('transport protection', () => {
  it('requires an exact origin and JSON content type for auth POST', () => {
    const req = (origin: string, contentType = 'application/json') =>
      new Request('https://trove.wndrhive.com/auth/session', {
        method: 'POST',
        headers: { origin, 'content-type': contentType },
      });
    expect(isSameOriginAuthPost(req('https://trove.wndrhive.com'))).toBe(true);
    expect(isSameOriginAuthPost(req('https://evil.test'))).toBe(false);
    expect(isSameOriginAuthPost(req('https://trove.wndrhive.com', 'text/plain'))).toBe(false);
    expect(AUTH_RESPONSE_HEADERS['Cache-Control']).toContain('no-store');
    expect(AUTH_RESPONSE_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });
  it.each([
    '/auth/confirm',
    '/reset-password',
    '/trips/123?token_hash=secret',
    '/trips/123?code=secret',
  ])('never caches %s', (path) =>
    expect(isSensitiveAuthUrl(new URL(path, 'https://trove.invalid'))).toBe(true),
  );
  it('retains ordinary offline trip caching', () =>
    expect(isSensitiveAuthUrl(new URL('/trips/123/mode', 'https://trove.invalid'))).toBe(false));
});
