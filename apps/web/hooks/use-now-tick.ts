'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, re-rendered exactly on each minute boundary rather than on
 * a naive polling interval, so a displayed "3:41 PM" flips to "3:42 PM" right
 * on time instead of up to 59s late.
 *
 * Mirrors `useTripModeClock`'s idiom: a hidden or offline tab has no one to
 * show a tick to, so scheduling pauses until it becomes visible/online again.
 * When `enabled` is false (a Trip Mode preview, which stands at a fixed
 * hypothetical instant), no timer is ever set and the caller is expected to
 * source its displayed time elsewhere.
 */
export function useNowTick(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden || !navigator.onLine) return;
      const current = new Date();
      const msToNextMinute = 60_000 - (current.getTime() % 60_000);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute);
    };

    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        return;
      }
      setNow(new Date());
      schedule();
    };

    setNow(new Date());
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', schedule);
      window.removeEventListener('offline', schedule);
    };
  }, [enabled]);

  return now;
}
