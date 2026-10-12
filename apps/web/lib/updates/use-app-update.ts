'use client';

import { useSerwist } from '@serwist/turbopack/react';
import { useEffect, useRef, useState } from 'react';

import {
  INSTALLED_CHANGELOG_KEY,
  parseInstalledHistory,
  rememberInstalledEntries,
} from './history';
import { type InstalledRelease, type ReleaseManifest } from './release';
import { runningRelease as builtRelease } from './running-release';
import { isTroveWorker, requestWorkerRelease, TROVE_WORKER_PATH } from './worker';

// A module-local binding lets the callbacks below keep their null narrowing.
const runningRelease = builtRelease;

interface WaitingUpdate {
  worker: ServiceWorker;
  release: ReleaseManifest | null;
  generation: number;
}

export function useAppUpdate() {
  const { serwist } = useSerwist();
  const [waiting, setWaiting] = useState<WaitingUpdate | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [installedRelease, setInstalledRelease] = useState<InstalledRelease | null>(null);
  const [dismissed, setDismissed] = useState<Set<ServiceWorker | string>>(new Set());
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const acceptedWorker = useRef<ServiceWorker | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const installedHistory = useRef<string[]>([]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== INSTALLED_CHANGELOG_KEY && event.key !== null) return;
      installedHistory.current = rememberInstalledEntries(
        [],
        [...installedHistory.current, ...parseInstalledHistory(event.newValue)],
      );
      setInstalledIds(installedHistory.current);
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
    let activeWorker: ServiceWorker | null = null;
    // Worker identities are stable for an installation. Retry missing metadata
    // on later inspections, but avoid repeated message round trips once known.
    const releases = new Map<ServiceWorker, ReleaseManifest>();
    const readRelease = async (worker: ServiceWorker | null) => {
      if (!isTroveWorker(worker)) return null;
      const release = releases.get(worker) ?? (await requestWorkerRelease(worker));
      if (release) releases.set(worker, release);
      return release;
    };

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
      const active = current?.active ?? null;
      if (activeWorker !== active) {
        activeWorker?.removeEventListener('statechange', onActiveStateChange);
        activeWorker = active;
        activeWorker?.addEventListener('statechange', onActiveStateChange);
      }
      const pending = current?.waiting ?? null;
      const [activeRelease, pendingRelease] = await Promise.all([
        readRelease(active),
        readRelease(pending),
      ]);
      if (!alive || token !== request) return;
      // A replacement or activation during metadata lookup needs a fresh view.
      if ((current?.active ?? null) !== active || (current?.waiting ?? null) !== pending) {
        void inspect();
        return;
      }
      const installed = active?.state === 'activated' ? activeRelease : null;
      setInstalledRelease(installed);
      if (installed) {
        installedHistory.current = rememberInstalledEntries(
          installed.entryIds,
          installedHistory.current,
        );
        setInstalledIds(installedHistory.current);
      }
      const stalePage =
        installed &&
        runningRelease &&
        installed.buildId !== runningRelease.buildId &&
        // Distinct build IDs alone do not establish which is newer: a network
        // navigation can load new HTML while the previous worker is active.
        (active === target ||
          installed.entryIds.some((id) => !runningRelease.entryIds.includes(id)));
      const worker = pending ?? (stalePage ? active : null);
      if (!isTroveWorker(worker)) {
        target?.removeEventListener('statechange', onTargetStateChange);
        target = null;
        setWaiting(null);
        return;
      }
      if (worker !== target) {
        target?.removeEventListener('statechange', onTargetStateChange);
        target = worker;
        target.addEventListener('statechange', onTargetStateChange);
        generation += 1;
        setReloadError(false);
      }
      const update: WaitingUpdate = {
        worker,
        release: pending ? pendingRelease : activeRelease,
        generation,
      };
      setWaiting((previous) =>
        previous?.worker === worker && previous.release === update.release ? previous : update,
      );
    };
    const onTargetStateChange = () => {
      if (acceptedWorker.current?.state === 'activated') {
        onControlling();
      }
      void inspect();
    };
    const onActiveStateChange = () => {
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
        acceptedWorker.current = null;
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
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
      activeWorker?.removeEventListener('statechange', onActiveStateChange);
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
      // Another tab may have activated this exact update since the toast opened.
      // The traveller still explicitly accepts refreshing their own open page.
      if (registration?.active === waiting.worker && waiting.worker.state === 'activated') {
        window.location.reload();
        return;
      }
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
    installedRelease,
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
