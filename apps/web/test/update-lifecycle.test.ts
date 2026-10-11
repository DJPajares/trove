import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { INSTALLED_CHANGELOG_KEY, parseInstalledHistory } from '../lib/updates/history';
import {
  createReleaseManifest,
  unseenSummaries,
  type ReleaseManifest,
} from '../lib/updates/release';

const hooks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TROVE_RELEASE = JSON.stringify({
    schemaVersion: 1,
    appId: 'trove-web',
    buildId: 'page-build',
    entryIds: ['old', 'new'],
  });
  return {
    cursor: 0,
    slots: [] as unknown[],
    effects: new Map<number, { deps: readonly unknown[]; cleanup?: () => void }>(),
    serwist: new EventTarget(),
    metadata: vi.fn(),
  };
});

// Exercise the lifecycle hook without a DOM; state and refs survive each render.
vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
    return [
      hooks.slots[slot],
      (value: T | ((previous: T) => T)) => {
        hooks.slots[slot] =
          typeof value === 'function'
            ? (value as (previous: T) => T)(hooks.slots[slot] as T)
            : value;
      },
    ];
  },
  useRef: <T>(initial: T) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial };
    return hooks.slots[slot];
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const slot = hooks.cursor++;
    const previous = hooks.effects.get(slot);
    if (previous && deps.every((dep, index) => dep === previous.deps[index])) return;
    previous?.cleanup?.();
    hooks.effects.set(slot, { deps, cleanup: effect() ?? undefined });
  },
}));
vi.mock('@serwist/turbopack/react', () => ({ useSerwist: () => ({ serwist: hooks.serwist }) }));
vi.mock('../lib/updates/worker', async (original) => ({
  ...(await original<object>()),
  requestWorkerRelease: hooks.metadata,
}));

import { useAppUpdate } from '../lib/updates/use-app-update';

const note = (id: string) => ({ id, date: '2026-10-11', summaries: { en: [id] } });
const old = createReleaseManifest([note('old')], 'old-build');
const page = createReleaseManifest([note('old'), note('new')], 'page-build');
const latest = createReleaseManifest([note('old'), note('new'), note('latest')], 'latest-build');

class Worker extends EventTarget {
  scriptURL = 'https://trove.test/serwist/sw.js';
  postMessage = vi.fn();
  constructor(
    public release: ReleaseManifest | null,
    public state: ServiceWorkerState,
  ) {
    super();
  }
}
const values = new Map<string, string>();
const reload = vi.fn();
let registration: {
  active: Worker | null;
  waiting: Worker | null;
  installing: Worker | null;
} & EventTarget;
let serviceWorker: EventTarget & {
  controller: Worker | null;
  getRegistration: ReturnType<typeof vi.fn>;
};
const render = () => {
  hooks.cursor = 0;
  return useAppUpdate();
};
const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
  return render();
};
const installedIds = () => parseInstalledHistory(values.get(INSTALLED_CHANGELOG_KEY) ?? null);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hooks.slots = [];
  hooks.effects.clear();
  values.clear();
  registration = Object.assign(new EventTarget(), {
    active: new Worker(old, 'activated'),
    waiting: new Worker(page, 'installed'),
    installing: null,
  });
  serviceWorker = Object.assign(new EventTarget(), {
    controller: registration.active,
    getRegistration: vi.fn(async () => registration),
  });
  hooks.metadata.mockImplementation(async (worker: Worker) => worker.release);
  vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      location: { reload },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    }),
  );
});
afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('app and worker release lifecycle', () => {
  test('new HTML does not consume waiting notes, including polluted legacy history', async () => {
    values.set(
      'trove-web-installed-changelog-v1',
      JSON.stringify({
        schemaVersion: 1,
        appId: 'trove-web',
        entryIds: page.entryIds,
      }),
    );
    render();
    expect(installedIds()).toEqual([]);
    const update = await settle();
    expect(update.visible).toBe(true);
    expect(installedIds()).toEqual(['old']);
    expect(unseenSummaries(page, update.installedRelease, update.installedIds, 'en')).toEqual([
      { id: 'new:0', text: 'new' },
    ]);
    update.dismiss();
    expect(installedIds()).toEqual(['old']);
    expect(render().visible).toBe(false);
  });

  test('Update activates the exact worker and reloads once when it controls the page', async () => {
    render();
    let update = await settle();
    const accepted = registration.waiting!;
    await update.reload();
    expect(accepted.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(installedIds()).toEqual(['old']);
    registration.active = accepted;
    registration.waiting = null;
    accepted.state = 'activated';
    serviceWorker.controller = accepted;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    accepted.dispatchEvent(new Event('statechange'));
    update = await settle();
    expect(reload).toHaveBeenCalledOnce();
    expect(installedIds()).toEqual(['new', 'old']);
    expect(update.visible).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(render().reloadError).toBe(false);
  });

  test('another tab activating an update preserves this page and offers an explicit refresh', async () => {
    registration.waiting = new Worker(latest, 'installed');
    render();
    await settle();
    const acceptedElsewhere = registration.waiting;
    registration.active = acceptedElsewhere;
    registration.waiting = null;
    acceptedElsewhere.state = 'activated';
    serviceWorker.controller = acceptedElsewhere;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    const update = await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(update.visible).toBe(true);
    expect(update.waiting?.worker).toBe(acceptedElsewhere);
    await update.reload();
    expect(reload).toHaveBeenCalledOnce();
    expect(acceptedElsewhere.postMessage).not.toHaveBeenCalled();
  });

  test('Update still refreshes if the displayed worker activated elsewhere before the click', async () => {
    registration.waiting = new Worker(latest, 'installed');
    render();
    const update = await settle();
    registration.active = registration.waiting;
    registration.waiting = null;
    registration.active!.state = 'activated';
    await update.reload();
    expect(reload).toHaveBeenCalledOnce();
  });

  test('new HTML with only an older active worker does not offer a backwards update', async () => {
    registration.waiting = null;
    render();
    expect((await settle()).visible).toBe(false);
    expect(installedIds()).toEqual(['old']);
  });

  test('a worker still activating does not confirm an installation', async () => {
    registration.active = new Worker(page, 'activating');
    registration.waiting = null;
    render();
    expect((await settle()).installedRelease).toBeNull();
    expect(installedIds()).toEqual([]);
    registration.active.state = 'activated';
    registration.active.dispatchEvent(new Event('statechange'));
    expect((await settle()).installedRelease?.buildId).toBe(page.buildId);
    expect(installedIds()).toEqual(['new', 'old']);
  });

  test('legacy metadata keeps a generic Update action without consuming unconfirmed notes', async () => {
    registration.active!.release = null;
    registration.waiting!.release = null;
    render();
    const update = await settle();
    expect(update.visible).toBe(true);
    expect(update.waiting?.release).toBeNull();
    expect(installedIds()).toEqual([]);
    await update.reload();
    expect(registration.waiting!.postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(render().reloadError).toBe(true);
    await render().reload();
    expect(registration.waiting!.postMessage).toHaveBeenCalledTimes(2);
  });

  test('a replacement arriving during metadata lookup never renders the superseded release', async () => {
    let resolvePrevious!: (release: ReleaseManifest) => void;
    const previous = registration.waiting;
    hooks.metadata.mockImplementation((worker: Worker) =>
      worker === previous
        ? new Promise<ReleaseManifest>((resolve) => {
            resolvePrevious = resolve;
          })
        : Promise.resolve(worker.release),
    );
    render();
    await settle();
    registration.waiting = new Worker(latest, 'installed');
    resolvePrevious(page);
    const update = await settle();
    expect(update.waiting?.worker).toBe(registration.waiting);
    expect(update.waiting?.release?.buildId).toBe(latest.buildId);
    expect(installedIds()).toEqual(['old']);
  });

  test('blocked storage still uses activated metadata to show uninstalled notes', async () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    render();
    const update = await settle();
    expect(update.installedIds).toEqual(['old']);
    expect(unseenSummaries(page, update.installedRelease, update.installedIds, 'en')).toEqual([
      { id: 'new:0', text: 'new' },
    ]);
    await update.reload();
    expect(registration.waiting!.postMessage).toHaveBeenCalledOnce();
  });

  test('an observed code-only update remains refreshable after another tab activates it', async () => {
    registration.active = new Worker(page, 'activated');
    registration.waiting = new Worker(
      createReleaseManifest(page.entries, 'internal-build'),
      'installed',
    );
    render();
    await settle();
    registration.active = registration.waiting;
    registration.waiting = null;
    registration.active!.state = 'activated';
    serviceWorker.controller = registration.active;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    const update = await settle();
    expect(update.visible).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    await update.reload();
    expect(reload).toHaveBeenCalledOnce();
  });
});
