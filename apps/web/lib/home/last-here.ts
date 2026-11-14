'use client';

import { useSyncExternalStore } from 'react';

/**
 * Where Home last found the traveller, so the weather strip can open on the
 * place it named last time instead of waiting seconds for a fresh fix with no
 * place at all. The fresh fix still decides: when it lands somewhere else, the
 * strip moves there.
 *
 * Kept only at the weather key's own resolution (two decimals, about a
 * kilometre), only on this device, and only for a while: an old fix stops
 * standing in for the traveller, and a refusal of location forgets it.
 */
const STORAGE_KEY = 'trove:home-last-here';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type LastHere = { latitude: number; longitude: number };

const round = (value: number) => Math.round(value * 100) / 100;

let cachedRaw: string | null | undefined;
let cachedValue: LastHere | null = null;
const listeners = new Set<() => void>();

function read(): LastHere | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  // The same object for the same stored text, as useSyncExternalStore requires.
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  cachedValue = null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      latitude?: unknown;
      longitude?: unknown;
      savedAt?: unknown;
    };
    if (
      typeof parsed.latitude === 'number' &&
      typeof parsed.longitude === 'number' &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt <= MAX_AGE_MS
    ) {
      cachedValue = { latitude: parsed.latitude, longitude: parsed.longitude };
    }
  } catch {
    // A value this code did not write is no fix at all.
  }
  return cachedValue;
}

function write(value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Without storage the strip simply waits for the fix, as it always did.
  }
  for (const listener of listeners) listener();
}

export function rememberHere(position: LastHere) {
  const next = { latitude: round(position.latitude), longitude: round(position.longitude) };
  const current = read();
  // Rewriting the same place only to refresh its age, without waking readers.
  if (current?.latitude === next.latitude && current.longitude === next.longitude) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, savedAt: Date.now() }));
    } catch {
      // As above.
    }
    return;
  }
  write(JSON.stringify({ ...next, savedAt: Date.now() }));
}

export function forgetHere() {
  write(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The remembered place, or null on the server and when there is none. */
export function useLastHere() {
  return useSyncExternalStore(subscribe, read, () => null);
}
