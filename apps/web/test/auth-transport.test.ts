import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  setCookie: vi.fn(),
  getCookie: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.factory }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], get: mocks.getCookie, set: mocks.setCookie }),
}));
vi.mock('@/lib/supabase/environment', () => ({
  getSupabaseEnvironment: () => ({
    url: 'https://supabase.example.test',
    publishableKey: 'publishable-test-key',
  }),
}));

import { POST as confirmPost } from '@/app/auth/session/route';
import { GET as recoveryStatus } from '@/app/auth/recovery-session/route';
import { createRecoveryGrant } from '@/lib/auth/recovery-grant';
import { POST as resetPost } from '@/app/auth/reset-password/route';
import { updateSupabaseSession } from '@/lib/supabase/proxy';

type CookieAdapter = {
  setAll: (
    cookies: { name: string; value: string; options: object }[],
    headers: Record<string, string>,
  ) => void;
};
let adapter: CookieAdapter;
const now = Math.floor(Date.now() / 1000);
const user = { id: 'test-user', email: 'user@example.test' };
const claims = {
  sub: user.id,
  role: 'authenticated',
  session_id: 'test-session',
  exp: now + 3600,
  amr: [{ method: 'recovery', timestamp: now }],
};
const session = { access_token: 'verified.test.token', refresh_token: 'refresh', user };
const cookie = {
  name: 'sb-test-auth-token',
  value: 'session-cookie',
  options: { path: '/', sameSite: 'lax' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_RECOVERY_SECRET', Buffer.alloc(32, 1).toString('base64url'));
  mocks.getCookie.mockReturnValue(undefined);
  mocks.factory.mockImplementation((_url, _key, options) => {
    adapter = options.cookies;
    return {
      auth: {
        getSession: mocks.getSession,
        getClaims: mocks.getClaims,
        getUser: mocks.getUser,
        verifyOtp: mocks.verifyOtp,
        updateUser: mocks.updateUser,
      },
    };
  });
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.verifyOtp.mockImplementation(async () => {
    adapter.setAll([cookie], { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    return { data: { session }, error: null };
  });
  mocks.updateUser.mockResolvedValue({ data: { user }, error: null });
});

afterEach(() => vi.unstubAllEnvs());

const request = (path: string, body: unknown, origin = 'https://trove.wndrhive.com') =>
  new Request(`https://trove.wndrhive.com${path}`, {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('auth HTTP handlers', () => {
  it('writes the verified session cookies and forwards SSR cache headers', async () => {
    const response = await confirmPost(
      request('/auth/session', {
        kind: 'otp',
        tokenHash: 'a'.repeat(64),
        type: 'recovery',
        recovery: true,
        next: '/trips',
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.setCookie).toHaveBeenCalledWith(cookie.name, cookie.value, cookie.options);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await response.json()).toMatchObject({
      userId: user.id,
      redirect: '/reset-password?next=%2Ftrips',
    });
  });
  it.each([confirmPost, resetPost])(
    'rejects cross-origin mutation before touching Auth',
    async (handler) => {
      const response = await handler(request('/auth/session', {}, 'https://evil.test'));
      expect(response.status).toBe(403);
      expect(mocks.factory).not.toHaveBeenCalled();
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    },
  );
  it('maps malformed JSON to an invalid-link state', async () => {
    const response = await confirmPost(
      new Request('https://trove.wndrhive.com/auth/session', {
        method: 'POST',
        headers: { origin: 'https://trove.wndrhive.com', 'Content-Type': 'application/json' },
        body: '{',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalidLink' });
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('never updates a session that changed after the form rendered', async () => {
    const response = await resetPost(
      request('/auth/reset-password', {
        userId: user.id,
        sessionId: 'previous-session',
        password: 'new-password',
        confirmation: 'new-password',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

describe('proxy redirects', () => {
  it('retains refreshed cookies and private cache headers on authenticated sign-in redirects', async () => {
    mocks.getClaims.mockImplementation(async () => {
      adapter.setAll([cookie], { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
      return { data: { claims }, error: null };
    });
    const response = await updateSupabaseSession(
      new NextRequest('https://trove.wndrhive.com/sign-in?next=%2Ftrips%3Fview%3Dall'),
    );
    expect(response.headers.get('Location')).toBe('https://trove.wndrhive.com/trips?view=all');
    expect(response.cookies.get(cookie.name)?.value).toBe(cookie.value);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('preserves a protected route query through sign-in', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { status: 401 } });
    const response = await updateSupabaseSession(
      new NextRequest('https://trove.wndrhive.com/trips/123?day=2'),
    );
    const target = new URL(response.headers.get('Location')!);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('next')).toBe('/trips/123?day=2');
    expect(target.searchParams.has('day')).toBe(false);
  });
  it.each(['/auth/confirm', '/auth/callback', '/forgot-password', '/reset-password'])(
    'does not intercept %s for an existing user',
    async (path) => {
      const response = await updateSupabaseSession(
        new NextRequest(`https://trove.wndrhive.com${path}`),
      );
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    },
  );
});

describe('recovery receipt transport', () => {
  const link = {
    kind: 'otp',
    tokenHash: 'a'.repeat(64),
    type: 'recovery',
    recovery: true,
    next: '/trips',
  };
  const form = {
    userId: user.id,
    sessionId: claims.session_id,
    password: 'new-password',
    confirmation: 'new-password',
  };
  const identity = { userId: user.id, sessionId: claims.session_id, email: user.email };
  const useOtpClaims = () =>
    mocks.getClaims.mockResolvedValue({
      data: { claims: { ...claims, amr: [{ method: 'otp', timestamp: now }] } },
      error: null,
    });

  it('accepts the real Supabase OTP recovery response and writes a private receipt', async () => {
    useOtpClaims();
    const response = await confirmPost(request('/auth/session', link));
    expect(response.status).toBe(200);
    expect(mocks.setCookie).toHaveBeenCalledWith(
      'trove-recovery',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 3600 }),
    );
    const body = await response.json();
    expect(body.redirect).toBe('/reset-password?next=%2Ftrips');
    expect(body).not.toHaveProperty('recovery');
  });
  it('does not consume the link when its signing key is missing', async () => {
    vi.stubEnv('AUTH_RECOVERY_SECRET', '');
    const response = await confirmPost(request('/auth/session', link));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'configurationError' });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it('uses a host-only secure cookie in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    useOtpClaims();
    await confirmPost(request('/auth/session', link));
    expect(mocks.setCookie).toHaveBeenCalledWith(
      '__Host-trove-recovery',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true, path: '/' }),
    );
  });
  it('retains recovery after refresh, then clears the receipt on password update', async () => {
    useOtpClaims();
    mocks.getCookie.mockReturnValue({ value: createRecoveryGrant(identity) });
    const status = await recoveryStatus();
    expect(await status.json()).toEqual({
      recovery: true,
      userId: user.id,
      sessionId: claims.session_id,
    });
    expect(status.headers.get('Cache-Control')).toContain('no-store');
    const response = await resetPost(request('/auth/reset-password', form));
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: form.password });
    expect(mocks.setCookie).toHaveBeenCalledWith(
      'trove-recovery',
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
  });
  it.each([undefined, 'unsigned-receipt'])(
    'denies an ordinary OTP session with %s',
    async (value) => {
      useOtpClaims();
      mocks.getCookie.mockReturnValue(value ? { value } : undefined);
      expect((await resetPost(request('/auth/reset-password', form))).status).toBe(400);
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect((await (await recoveryStatus()).json()).recovery).toBe(false);
    },
  );
  it('does not transfer a recovery receipt to a different session', async () => {
    useOtpClaims();
    mocks.getCookie.mockReturnValue({
      value: createRecoveryGrant({ ...identity, sessionId: 'another-session' }),
    });
    expect((await resetPost(request('/auth/reset-password', form))).status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('preserves a previous receipt when another invalid link fails', async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: 'otp_expired', status: 403 },
    });
    await confirmPost(request('/auth/session', link));
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
