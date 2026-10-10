'use client';

import { useSerwist } from '@serwist/turbopack/react';
import { useEffect, useRef, useState } from 'react';

import {
  INSTALLED_CHANGELOG_KEY,
  parseInstalledHistory,
  rememberInstalledEntries,
} from './history';
import { parseInstalledRelease, type ReleaseManifest } from './release';
import { isTroveWorker, requestWorkerRelease, TROVE_WORKER_PATH } from './worker';

export const runningRelease = parseInstalledRelease(
  JSON.parse(process.env.NEXT_PUBLIC_TROVE_RELEASE ?? 'null'),
);

interface WaitingUpdate {
  worker: ServiceWorker;
  release: ReleaseManifest | null;
  generation: number;
}

export function useAppUpdate() {
  const { serwist } = useSerwist();
  const [waiting, setWaiting] = useState<WaitingUpdate | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<Set<ServiceWorker | string>>(new Set());
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const acceptedWorker = useRef<ServiceWorker | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    const known = { ids: rememberInstalledEntries(runningRelease?.entryIds ?? []) };
    setInstalledIds(known.ids);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== INSTALLED_CHANGELOG_KEY && event.key !== null) return;
      known.ids = rememberInstalledEntries(runningRelease?.entryIds ?? [], [
        ...known.ids,
        ...parseInstalledHistory(event.newValue),
      ]);
      setInstalledIds(known.ids);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!serwist || !('serviceWorker' in navigator)) return;
    mounted.current = true;
    let alive = true;
    let request = 0;
    let generation = 0;
    let target: ServiceWorker | null = null;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;

    const inspect = async () => {
      const token = ++request;
      const current = await navigator.serviceWorker
        .getRegistration(TROVE_WORKER_PATH)
        .catch(() => undefined);
      if (!alive || token !== request) return;
      if (registration !== current) {
        registration?.removeEventListener('updatefound', onUpdateFound);
        registration = current;
        registration?.addEventListener('updatefound', onUpdateFound);
        onUpdateFound();
      }
      const worker = current?.waiting ?? null;
      if (!isTroveWorker(worker)) {
        target?.removeEventListener('statechange', onTargetStateChange);
        target = null;
        setWaiting(null);
        return;
      }
      if (worker === target) return;
      target?.removeEventListener('statechange', onTargetStateChange);
      target = worker;
      target.addEventListener('statechange', onTargetStateChange);
      generation += 1;
      const update = { worker, release: null, generation };
      setWaiting(update);
      setReloadError(false);
      const release = await requestWorkerRelease(worker);
      if (alive && worker === target && worker.state === 'installed') {
        setWaiting({ ...update, release });
      }
    };
    const onTargetStateChange = () => {
      void inspect();
    };
    const onInstallingStateChange = () => {
      void inspect();
    };
    const onUpdateFound = () => {
      installing?.removeEventListener('statechange', onInstallingStateChange);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', onInstallingStateChange);
    };
    const onWaiting = () => {
      void inspect();
    };
    const onControlling = () => {
      // Activation in another tab must not refresh a traveller's open work.
      if (acceptedWorker.current && navigator.serviceWorker.controller === acceptedWorker.current) {
        window.location.reload();
      } else {
        void inspect();
      }
    };
    refresh.current = inspect;
    serwist.addEventListener('waiting', onWaiting);
    navigator.serviceWorker.addEventListener('controllerchange', onControlling);
    void inspect();
    return () => {
      alive = false;
      mounted.current = false;
      refresh.current = async () => {};
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      acceptedWorker.current = null;
      target?.removeEventListener('statechange', onTargetStateChange);
      installing?.removeEventListener('statechange', onInstallingStateChange);
      registration?.removeEventListener('updatefound', onUpdateFound);
      serwist.removeEventListener('waiting', onWaiting);
      navigator.serviceWorker.removeEventListener('controllerchange', onControlling);
    };
  }, [serwist]);

  const reload = async () => {
    if (!waiting || reloading) return;
    setReloadError(false);
    setReloading(true);
    const fail = () => {
      acceptedWorker.current = null;
      if (mounted.current) {
        setReloading(false);
        setReloadError(true);
      }
    };
    try {
      const registration = await navigator.serviceWorker.getRegistration(TROVE_WORKER_PATH);
      if (!mounted.current) return;
      if (registration?.waiting !== waiting.worker || waiting.worker.state !== 'installed') {
        setReloading(false);
        await refresh.current();
        return;
      }
      acceptedWorker.current = waiting.worker;
      reloadTimer.current = setTimeout(fail, 10000);
      waiting.worker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      fail();
    }
  };

  return {
    waiting,
    installedIds,
    reloading,
    reloadError,
    visible:
      waiting !== null &&
      !dismissed.has(waiting.worker) &&
      !dismissed.has(waiting.release?.buildId ?? ''),
    reload,
    dismiss: () => {
      if (!waiting) return;
      setDismissed(
        (previous) =>
          new Set([
            ...previous,
            waiting.worker,
            ...(waiting.release ? [waiting.release.buildId] : []),
          ]),
      );
    },
  };
}
