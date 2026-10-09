import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isCurrentReadingStale } from '../lib/weather/freshness.ts';

const harness = vi.hoisted(() => ({
  effect: null as (() => (() => void) | void) | null,
  now: new Date(),
}));
vi.mock('react', () => ({
  useState: (initial: () => Date) => {
    harness.now = initial();
    return [
      harness.now,
      (now: Date) => {
        harness.now = now;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void) => {
    harness.effect = effect;
  },
}));
const { useNowTick } = await import('../hooks/use-now-tick.ts');
let cleanup: (() => void) | void;
let documentState: EventTarget & { hidden: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T02:59:59Z'));
  documentState = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', documentState);
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
});
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a visible offline clock expires an observation without a request', () => {
  useNowTick(true, true);
  cleanup = harness.effect!();
  expect(isCurrentReadingStale('2026-10-03T11:00', 'Asia/Tokyo', harness.now)).toBe(false);
  vi.advanceTimersByTime(61_000);
  expect(isCurrentReadingStale('2026-10-03T11:00', 'Asia/Tokyo', harness.now)).toBe(true);
});
test('hidden clocks pause and immediately age evidence when shown again', () => {
  useNowTick(true, true);
  cleanup = harness.effect!();
  documentState.hidden = true;
  documentState.dispatchEvent(new Event('visibilitychange'));
  const previous = harness.now;
  vi.advanceTimersByTime(3_600_000);
  expect(harness.now).toBe(previous);
  documentState.hidden = false;
  documentState.dispatchEvent(new Event('visibilitychange'));
  expect(isCurrentReadingStale('2026-10-03T11:00', 'Asia/Tokyo', harness.now)).toBe(true);
});
test('existing clock callers still pause offline and disabled clocks do not schedule', () => {
  useNowTick(true);
  cleanup = harness.effect!();
  expect(vi.getTimerCount()).toBe(0);
  cleanup?.();
  useNowTick(false, true);
  cleanup = harness.effect!();
  expect(vi.getTimerCount()).toBe(0);
});
