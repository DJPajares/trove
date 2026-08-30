import { describe, expect, it } from 'vitest';

import { motionDuration } from '@/lib/motion';
import {
  FLOATING_ACTION_STAGGER_S,
  floatingActionDelay,
  floatingActionOrder,
} from '@/lib/shell/floating-actions';

describe('floating action stack order', () => {
  it('reads identity, then what is waiting, then appearance', () => {
    expect(floatingActionOrder).toEqual(['account', 'notifications', 'appearance']);
  });
});

describe('floatingActionDelay', () => {
  it('starts the first button immediately and steps down the stack', () => {
    expect(floatingActionDelay(0)).toBe(0);
    expect(floatingActionDelay(1)).toBeCloseTo(FLOATING_ACTION_STAGGER_S);
    expect(floatingActionDelay(2)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * 2);
  });

  it('folds back towards the trigger on the way out', () => {
    expect(floatingActionDelay(floatingActionOrder.length - 1, true)).toBe(0);
    expect(floatingActionDelay(0, true)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * 2);
  });

  it('finishes the whole reveal inside one standard beat', () => {
    const last = floatingActionDelay(floatingActionOrder.length - 1);

    expect(last).toBeLessThan(motionDuration.standard);
  });
});
