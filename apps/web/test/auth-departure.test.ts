import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), getSession: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signOut: mocks.signOut, getSession: mocks.getSession },
  }),
}));
vi.mock('@/lib/notifications/push', () => ({ clearPushForSignOut: mocks.push }));

import { authenticatedFetch, getProtectedSession } from '@/lib/auth/transport';
import { expectAuthSession, getAuthTransition, setAuthTransition } from '@/lib/auth/transition';
import { registerLocalPrivateDataClearer, signOutFromTrove } from '@/lib/auth/sign-out';

const navigate = vi.fn();
const session = { access_token: 'outgoing-token', user: { id: 'traveller' } };
const supabase = { auth: { getSession: mocks.getSession } } as unknown as SupabaseClient;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuthTransition('idle');
  expectAuthSession(true);
  vi.stubGlobal('window', { location: { replace: navigate } });
  vi.stubGlobal('navigator', { onLine: true });
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.push.mockResolvedValue(undefined);
});
afterEach(() => {
  expectAuthSession(false);
  setAuthTransition('idle');
  vi.unstubAllGlobals();
});

describe('auth departure transport', () => {
  it('blocks a new request before it reads the session or reaches the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    setAuthTransition('signing-out');
    await expect(getProtectedSession(supabase)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(authenticatedFetch('/trips')).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a session read begun before departure even after a failed logout restores the UI', async () => {
    const read = deferred<Awaited<ReturnType<SupabaseClient['auth']['getSession']>>>();
    mocks.getSession.mockReturnValue(read.promise);
    const pending = getProtectedSession(supabase);
    setAuthTransition('signing-out');
    setAuthTransition('sign-out-failed');
    read.resolve({ data: { session: session as never }, error: null });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('aborts in-flight reads and rejects their late responses', async () => {
    const read = deferred<Response>();
    let signal!: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        signal = init.signal;
        return read.promise;
      }),
    );
    const pending = authenticatedFetch('/trips');
    setAuthTransition('signing-out');
    expect(signal.aborted).toBe(true);
    read.resolve(Response.json({ trips: ['private'] }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps caller cancellation connected to the actual request', async () => {
    const caller = new AbortController();
    let signal!: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        signal = init.signal;
        return Response.json({});
      }),
    );
    await authenticatedFetch('/trips', { signal: caller.signal });
    caller.abort();
    expect(signal.aborted).toBe(true);
  });
  it('turns an API authorization failure into session departure before publishing an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(authenticatedFetch('/trips')).rejects.toMatchObject({ name: 'AbortError' });
    expect(getAuthTransition()).toBe('session-expired');
  });
  it('detects a missing session without making a request', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getProtectedSession(supabase)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getAuthTransition()).toBe('session-expired');
  });
  it('preserves offline work and does not mistake a transient outage for invalidation', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: { status: 503 } });
    await getProtectedSession(supabase);
    expect(getAuthTransition()).toBe('idle');
    vi.stubGlobal('navigator', { onLine: false });
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await getProtectedSession(supabase);
    expect(getAuthTransition()).toBe('idle');
  });
  it('does not send public screens to login when their optional account queries have no session', async () => {
    expectAuthSession(false);
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await getProtectedSession(supabase);
    expect(getAuthTransition()).toBe('idle');
  });
});

describe('sign-out lifecycle', () => {
  it.each(['signing-out', 'session-expired'] as const)(
    'handles account-scoped offline work during %s',
    async (reason) => {
      const offline = vi.fn();
      const memory = vi.fn();
      const unregisterOffline = registerLocalPrivateDataClearer(offline, {
        preserveOnSessionLoss: true,
      });
      const unregisterMemory = registerLocalPrivateDataClearer(memory);
      try {
        setAuthTransition(reason);
        await signOutFromTrove();
        expect(memory).toHaveBeenCalledOnce();
        expect(offline).toHaveBeenCalledTimes(reason === 'session-expired' ? 0 : 1);
        expect(navigate).toHaveBeenCalledExactlyOnceWith('/sign-in');
      } finally {
        unregisterOffline();
        unregisterMemory();
      }
    },
  );
  it('enters departure before push cleanup and stays there through private cleanup and navigation', async () => {
    const push = deferred<void>();
    const clear = deferred<void>();
    mocks.push.mockImplementation(() => {
      expect(getAuthTransition()).toBe('signing-out');
      return push.promise;
    });
    const unregister = registerLocalPrivateDataClearer(() => clear.promise);
    try {
      const pending = signOutFromTrove();
      expect(signOutFromTrove()).toBe(pending);
      expect(navigate).not.toHaveBeenCalled();
      push.resolve();
      await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
      expect(navigate).not.toHaveBeenCalled();
      clear.resolve();
      await pending;
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/sign-in');
      expect(getAuthTransition()).toBe('signing-out');
    } finally {
      unregister();
    }
  });
  it('restores a still-valid session after a failed manual logout without discarding private work', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('offline') });
    const clear = vi.fn();
    const unregister = registerLocalPrivateDataClearer(clear);
    try {
      await expect(signOutFromTrove()).rejects.toThrow('offline');
      expect(getAuthTransition()).toBe('sign-out-failed');
      expect(clear).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
  it('never restores protected content if private cleanup fails after the session was cleared', async () => {
    const unregister = registerLocalPrivateDataClearer(() => {
      throw new Error('storage');
    });
    try {
      await expect(signOutFromTrove()).rejects.toThrow('storage');
      expect(getAuthTransition()).toBe('cleanup-failed');
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
    await signOutFromTrove();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/sign-in');
  });
  it('never restores an invalidated session even when revocation and its retry fail', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('offline') });
    setAuthTransition('session-expired');
    await expect(signOutFromTrove()).rejects.toThrow('offline');
    expect(getAuthTransition()).toBe('cleanup-failed');
    await expect(signOutFromTrove()).rejects.toThrow('offline');
    expect(getAuthTransition()).toBe('cleanup-failed');
    expect(navigate).not.toHaveBeenCalled();
  });
});
