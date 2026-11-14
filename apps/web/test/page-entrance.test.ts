import { describe, expect, it } from 'vitest';

import { decideEntrance, type EntranceClock } from '@/lib/page-entrance';

const offset = (clock: EntranceClock, replay: boolean, now: number) => {
  const entrance = decideEntrance(clock, replay, now);
  return entrance.enter
    ? ((entrance.style as Record<string, string> | undefined)?.['--entrance-offset'] ?? '0')
    : null;
};

describe('decideEntrance', () => {
  it('starts an entrance on the first mount', () => {
    const clock: EntranceClock = { startedAt: null };
    expect(offset(clock, false, 1000)).toBe('0');
    expect(clock.startedAt).toBe(1000);
  });

  it('continues an entrance a second mount interrupts, instead of restarting it', () => {
    const clock: EntranceClock = { startedAt: 1000 };
    expect(offset(clock, false, 1300)).toBe('-300ms');
    expect(offset(clock, true, 1300)).toBe('-300ms');
    expect(clock.startedAt).toBe(1000);
  });

  it('makes a once-per-visit entrance only once', () => {
    const clock: EntranceClock = { startedAt: 1000 };
    expect(offset(clock, false, 5000)).toBeNull();
  });

  it('replays a finished entrance on a later visit when asked to', () => {
    const clock: EntranceClock = { startedAt: 1000 };
    expect(offset(clock, true, 5000)).toBe('0');
    expect(clock.startedAt).toBe(5000);
  });
});
