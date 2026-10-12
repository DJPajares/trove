import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AiPlanningSession } from '../lib/ai-planning/api.ts';

// A deterministic hook scheduler lets these lifecycle tests control concurrent
// network completions without DOM dependencies or a live model/provider call.
const harness = vi.hoisted(() => ({
  slots: [] as Array<{ value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }>,
  index: 0,
  effects: [] as Array<() => void>,
  cache: new Map<string, unknown>(),
  refetch: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('react', () => {
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    useState: (initial: unknown) => {
      const i = harness.index++;
      harness.slots[i] ??= { value: initial };
      return [
        harness.slots[i]!.value,
        (next: unknown) => {
          harness.slots[i]!.value =
            typeof next === 'function' ? next(harness.slots[i]!.value) : next;
        },
      ];
    },
    useRef: (value: unknown) => {
      const i = harness.index++;
      harness.slots[i] ??= { value: { current: value } };
      return harness.slots[i]!.value;
    },
    useCallback: (fn: unknown, deps: readonly unknown[]) => {
      const i = harness.index++;
      if (!same(harness.slots[i]?.deps, deps)) harness.slots[i] = { value: fn, deps };
      return harness.slots[i]!.value;
    },
    useEffect: (fn: () => (() => void) | void, deps: readonly unknown[]) => {
      const i = harness.index++;
      if (same(harness.slots[i]?.deps, deps)) return;
      const previous = harness.slots[i];
      harness.slots[i] = { deps };
      harness.effects.push(() => {
        previous?.cleanup?.();
        harness.slots[i]!.cleanup = fn() ?? undefined;
      });
    },
  };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[1] === 'availability'
        ? { availability: { status: 'available', maxItineraryDays: 10 } }
        : harness.cache.get(queryKey.join(':')),
    refetch: harness.refetch,
  }),
  useQueryClient: () => ({
    setQueryData: (key: string[], value: unknown) => harness.cache.set(key.join(':'), value),
    removeQueries: ({ queryKey }: { queryKey: string[] }) =>
      harness.cache.delete(queryKey.join(':')),
    invalidateQueries: harness.refresh,
  }),
}));
vi.mock('../lib/ai-planning/api.ts', () => ({
  AiPlanningApiError: class extends Error {
    code = 'request_failed';
  },
  createAiPlanningSession: harness.create,
  regenerateAiPlanningSession: harness.create,
  cancelAiPlanningSession: harness.cancel,
  fetchAiPlanningSession: async () => ({ session: null }),
  recoverAiPlanningSession: async () => ({ session: null }),
  fetchAiPlanningAvailability: async () => ({}),
}));
import { useAiPlanningLifecycle } from '../lib/ai-planning/use-lifecycle.ts';
import { setAuthTransition } from '../lib/auth/transition.ts';

function render(enabled = true) {
  harness.index = 0;
  const result = useAiPlanningLifecycle(enabled);
  harness.effects.splice(0).forEach((effect) => effect());
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function session(id = 'run') {
  return {
    id,
    status: 'generating',
    prompt: 'server brief',
    draftRevision: 0,
    expiresAt: '2026-10-19T00:00:00Z',
    deadlineAt: '2026-10-12T12:01:00Z',
    stage: 'generating',
  } as AiPlanningSession;
}
const choice = {
  key: 'who',
  option: 'couple',
  label: 'Two of us',
  sentence: 'There are two of us.',
};
function brief() {
  const lifecycle = render();
  lifecycle.setPrompt('  My own brief  ');
  lifecycle.setBriefSelections([choice]);
  return render();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  harness.slots = [];
  harness.effects = [];
  harness.cache.clear();
  vi.clearAllMocks();
  harness.refetch.mockResolvedValue({ data: { session: null } });
  harness.cancel.mockResolvedValue({ session: null });
  harness.refresh.mockResolvedValue(undefined);
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} });
  setAuthTransition('idle');
});
afterEach(() => {
  harness.slots.forEach((slot) => slot.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('cancellation before Create returns retains words and choices, and deduplicates cancellation', async () => {
  const create = deferred<{ session: AiPlanningSession }>();
  harness.create.mockReturnValue(create.promise);
  const generated = brief().generate();
  await render().cancel();
  await render().cancel();
  expect(render().operation).toBe('cancelling');
  expect(render().canGenerate).toBe(false);
  create.resolve({ session: session() });
  await generated;
  const cancelled = render();
  expect(harness.cancel).toHaveBeenCalledTimes(1);
  expect(cancelled.prompt).toBe('  My own brief  ');
  expect(cancelled.briefSelections).toEqual([choice]);
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.session).toBeNull();
  expect(cancelled.canGenerate).toBe(true);
});

test('a cancelled session cannot return through stale recovery, and retry uses a new key', async () => {
  harness.create.mockResolvedValue({ session: session() });
  await brief().generate();
  await render().cancel();
  harness.cache.set('ai-planning:recovery', { session: session() });
  expect(render().session).toBeNull();
  const cancelled = render();
  cancelled.setPrompt('An edited brief');
  harness.create.mockResolvedValue({ session: session('new-run') });
  await render().generate();
  expect(harness.create.mock.calls[1]![0]).toContain('An edited brief');
  expect(harness.create.mock.calls[1]![1]).not.toBe(harness.create.mock.calls[0]![1]);
  expect(render().session?.id).toBe('new-run');
});

test('a late response from the cancelled request does not cancel a newer retry', async () => {
  const create = deferred<{ session: AiPlanningSession }>();
  harness.create.mockReturnValueOnce(create.promise);
  const running = brief().generate();
  harness.cache.set('ai-planning:recovery', { session: session() });
  render();
  await render().cancel();
  harness.create.mockResolvedValue({ session: session('new-run') });
  await render().generate();
  create.resolve({ session: session() });
  await running;
  expect(render().session?.id).toBe('new-run');
  expect(harness.cancel).toHaveBeenCalledTimes(1);
});

test('failed cancellation preserves the brief and permits recovery', async () => {
  harness.create.mockResolvedValue({ session: session() });
  await brief().generate();
  harness.cancel.mockRejectedValue(new Error('offline'));
  await render().cancel();
  expect(render().prompt).toBe('  My own brief  ');
  expect(render().briefSelections).toEqual([choice]);
  expect(render().cancelled).toBe(false);
  expect(render().visibleError).toBe('request_failed');
});

test('explicit Start over clears the brief after cancelling the failed session', async () => {
  harness.create.mockResolvedValue({ session: { ...session(), status: 'failed' } });
  await brief().generate();
  await render().startOver();
  expect(render().prompt).toBe('');
  expect(render().briefSelections).toEqual([]);
});

test('Apply clearing the mirrored recovery clears the retained brief', async () => {
  const reviewing = { ...session(), status: 'reviewing' as const };
  harness.cache.set('ai-planning:recovery', { session: reviewing });
  brief();
  render();
  harness.cache.set('ai-planning:recovery', { session: null });
  render();
  expect(render().prompt).toBe('');
  expect(render().briefSelections).toEqual([]);
});

test('sign-out clears in-memory content and ignores an old generation response', async () => {
  const create = deferred<{ session: AiPlanningSession }>();
  harness.create.mockReturnValue(create.promise);
  const running = brief().generate();
  setAuthTransition('signing-out');
  create.resolve({ session: session() });
  await running;
  expect(render(false).prompt).toBe('');
  expect(render(false).session).toBeNull();
});

test('the cancelled brief still clears at the original private-content expiry', async () => {
  harness.create.mockResolvedValue({ session: session() });
  await brief().generate();
  await render().cancel();
  render();
  vi.advanceTimersByTime(7 * 86_400_000);
  expect(render().prompt).toBe('');
  expect(render().briefSelections).toEqual([]);
});

test('a lost Create response cancels the recovered reservation instead of starting another run', async () => {
  const create = deferred<{ session: AiPlanningSession }>();
  harness.create.mockReturnValue(create.promise);
  const running = brief().generate();
  await render().cancel();
  harness.refetch.mockResolvedValue({ data: { session: session() } });
  create.reject(new Error('connection lost'));
  await running;
  expect(harness.cancel).toHaveBeenCalledWith('run');
  expect(harness.create).toHaveBeenCalledTimes(1);
  expect(render().cancelled).toBe(true);
  expect(render().prompt).toBe('  My own brief  ');
});

test('expiry clears queued cancellation and ignores the eventual Create response', async () => {
  const create = deferred<{ session: AiPlanningSession }>();
  harness.create.mockReturnValue(create.promise);
  const running = brief().generate();
  await render().cancel();
  const expired = { ...session(), expiresAt: '2026-10-11T00:00:00Z' };
  harness.cache.set('ai-planning:recovery', { session: expired });
  render();
  create.resolve({ session: expired });
  await running;
  expect(render().operation).toBe('idle');
  expect(render().prompt).toBe('');
  expect(render().session).toBeNull();
  expect(render().visibleError).toBe('session_expired');
});

test('stale recovery after Apply cannot resurrect the brief or draft', () => {
  const reviewing = { ...session(), status: 'reviewing' as const };
  harness.cache.set('ai-planning:recovery', { session: reviewing });
  brief();
  render();
  harness.cache.set('ai-planning:recovery', { session: null });
  render();
  harness.cache.set('ai-planning:recovery', { session: reviewing });
  render();
  expect(render().session).toBeNull();
  expect(render().prompt).toBe('');
});
