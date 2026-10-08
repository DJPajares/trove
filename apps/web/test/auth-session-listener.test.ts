import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  clear: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    mocks.cleanup = effect() ?? undefined;
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }),
}));
vi.mock('@/lib/auth/recovery', () => ({ getValidatedAuthIdentity: mocks.identity }));
vi.mock('@/lib/auth/sign-out', () => ({ clearLocalPrivateData: mocks.clear }));

import { AuthSessionListener } from '@/components/auth-session-listener';

const navigate = vi.fn();
let callback: (event: AuthChangeEvent, session: Session | null) => void;
const session = (token: string) => ({ access_token: token }) as Session;

function open(path: string, userId = 'current-user') {
  const url = new URL(path, 'https://trove.wndrhive.com');
  vi.stubGlobal('window', {
    location: {
      href: url.href,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: navigate,
    },
  });
  AuthSessionListener({ userId });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.cleanup = undefined;
  mocks.clear.mockResolvedValue(undefined);
  mocks.identity.mockResolvedValue({
    user: { id: 'current-user' },
    claims: { session_id: 'recovery-session', amr: [{ method: 'recovery' }] },
    recovery: { sessionId: 'recovery-session' },
  });
  mocks.subscribe.mockImplementation((listener: typeof callback) => {
    callback = listener;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
});
afterEach(() => {
  mocks.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('already-open authentication navigation', () => {
  it.each(['/forgot-password?next=%2Ftrips', '/reset-password?next=%2Ftrips', '/trips'])(
    'follows a verified new recovery session from %s',
    async (path) => {
      open(path);
      callback('SIGNED_IN', session('new-recovery-token'));
      await vi.runAllTimersAsync();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/reset-password?next=%2Ftrips');
    },
  );
  it('follows OTP recovery only after the server confirms its receipt and matching session', async () => {
    mocks.identity.mockResolvedValue({
      user: { id: 'current-user' },
      claims: { session_id: 'receipt-session', amr: [{ method: 'otp' }] },
      recovery: null,
    });
    const fetchStatus = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recovery: true,
        userId: 'current-user',
        sessionId: 'receipt-session',
      }),
    });
    vi.stubGlobal('fetch', fetchStatus);
    open('/forgot-password?next=%2Ftrips');
    callback('SIGNED_IN', session('otp-token'));
    await vi.runAllTimersAsync();
    expect(fetchStatus).toHaveBeenCalledWith('/auth/recovery-session', { cache: 'no-store' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/reset-password?next=%2Ftrips');
  });
  it.each([
    { recovery: false, userId: 'current-user', sessionId: 'receipt-session' },
    { recovery: true, userId: 'other-user', sessionId: 'receipt-session' },
    { recovery: true, userId: 'current-user', sessionId: 'other-session' },
  ])('does not route ordinary/mismatched OTP session %j to reset', async (status) => {
    mocks.identity.mockResolvedValue({
      user: { id: 'current-user' },
      claims: { session_id: 'receipt-session', amr: [{ method: 'otp' }] },
      recovery: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => status }));
    open('/trips');
    callback('SIGNED_IN', session('otp-token'));
    await vi.runAllTimersAsync();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not reroute an unchanged recovery session when the tab regains focus', async () => {
    open('/trips');
    callback('INITIAL_SESSION', session('existing-token'));
    callback('SIGNED_IN', session('existing-token'));
    await vi.runAllTimersAsync();
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('still clears the previous account when OTP recovery status is unavailable', async () => {
    mocks.identity.mockResolvedValue({
      user: { id: 'another-user' },
      claims: { session_id: 'otp-session', amr: [{ method: 'otp' }] },
      recovery: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    open('/trips');
    callback('SIGNED_IN', session('another-user-otp'));
    await vi.runAllTimersAsync();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/trips');
  });
  it('lets the confirmation screen finish its own verified session installation', async () => {
    open('/auth/confirm?next=%2Ftrips');
    callback('PASSWORD_RECOVERY', session('new-token'));
    await vi.runAllTimersAsync();
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('never navigates on an unvalidated session', async () => {
    mocks.identity.mockResolvedValue(null);
    open('/trips');
    callback('SIGNED_IN', session('invalid-token'));
    await vi.runAllTimersAsync();
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('clears private data before navigating after another tab changes accounts', async () => {
    mocks.identity.mockResolvedValue({
      user: { id: 'another-user' },
      claims: { amr: [{ method: 'password' }] },
      recovery: null,
    });
    mocks.clear.mockImplementation(async () => {
      expect(navigate).not.toHaveBeenCalled();
    });
    open('/trips/123?day=2#place');
    callback('SIGNED_IN', session('another-user-token'));
    await vi.runAllTimersAsync();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/trips/123?day=2#place');
  });
  it('forwards legacy recovery fragments to the confirmation owner without consuming them', () => {
    const path = '/#access_token=one.two.three&refresh_token=token&type=recovery';
    open(path);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `https://trove.wndrhive.com/auth/callback${new URL(path, 'https://trove.wndrhive.com').hash}`,
    );
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});
