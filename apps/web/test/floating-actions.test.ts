import { describe, expect, it } from 'vitest';

import { motionDuration } from '@/lib/motion';
import {
  FLOATING_ACTION_STAGGER_S,
  floatingActionDelay,
  floatingActionOrder,
} from '@/lib/shell/floating-actions';

describe('floating action stack order', () => {
  it('leads with the one action that starts something', () => {
    expect(floatingActionOrder[0]).toBe('search');
  });

  it('then reads identity, what is waiting, and how the app looks', () => {
    expect(floatingActionOrder).toEqual(['search', 'account', 'notifications', 'appearance']);
  });
});

describe('floatingActionDelay', () => {
  it('starts the first button immediately and steps down the stack', () => {
    expect(floatingActionDelay(0)).toBe(0);
    expect(floatingActionDelay(1)).toBeCloseTo(FLOATING_ACTION_STAGGER_S);
    expect(floatingActionDelay(2)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * 2);
  });

  it('folds back towards the trigger on the way out', () => {
    const last = floatingActionOrder.length - 1;

    expect(floatingActionDelay(last, true)).toBe(0);
    expect(floatingActionDelay(0, true)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * last);
  });

  it('finishes the whole reveal inside one standard beat', () => {
    const last = floatingActionDelay(floatingActionOrder.length - 1);

    expect(last).toBeLessThan(motionDuration.standard);
  });
});
