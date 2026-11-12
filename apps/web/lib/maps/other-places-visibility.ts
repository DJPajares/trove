import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether maps draw the trip's other Places - the ones not on the day in view.
 *
 * Kept on this device only, as a viewing preference rather than part of the
 * account, and shared by every map so turning them off once means off
 * everywhere, including a map that is mounted but hidden at the time.
 */
const storageKey = 'trove:map-other-places:v1';
const listeners = new Set<() => void>();
// Where storage is blocked the choice still holds for this visit.
let fallback = true;

function read() {
  try {
    return window.localStorage.getItem(storageKey) !== 'hidden';
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing it follows along too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useOtherPlacesVisible() {
  // Shown by default, which is how the maps have always looked.
  const visible = useSyncExternalStore(subscribe, read, () => true);
  const setVisible = useCallback((next: boolean) => {
    fallback = next;
    try {
      if (next) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, 'hidden');
    } catch {
      // Private browsing or a full quota: remembered for this visit only.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [visible, setVisible] as const;
}
