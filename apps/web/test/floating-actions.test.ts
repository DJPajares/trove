import { describe, expect, it } from 'vitest';

import { motionDuration } from '@/lib/motion';
import {
  FLOATING_ACTION_STAGGER_S,
  floatingActionDelay,
  floatingActionOrder,
  profileInitials,
  searchStandsAlone,
} from '@/lib/shell/floating-actions';

describe('floating action stack order', () => {
  it('leads with the one action that starts something', () => {
    expect(floatingActionOrder[0]).toBe('search');
  });

  it('follows with notifications and appearance, then account at the bottom', () => {
    expect(floatingActionOrder).toEqual(['search', 'notifications', 'appearance', 'account']);
  });
});

describe('searchStandsAlone', () => {
  it('gives search its own button on the main destinations', () => {
    for (const path of ['/', '/trips', '/saved', '/tools']) {
      expect(searchStandsAlone(path), path).toBe(true);
    }
  });

  it('folds search into the stack everywhere else', () => {
    for (const path of ['/trips/abc', '/trips/abc/itinerary', '/tools/currency', '/profile']) {
      expect(searchStandsAlone(path), path).toBe(false);
    }
  });
});

describe('profileInitials', () => {
  it('takes the first letter of the first and last words', () => {
    expect(profileInitials('dj pajares')).toBe('DP');
    expect(profileInitials('  Ana  Maria de Souza ')).toBe('AS');
  });

  it('gives one letter for a single name', () => {
    expect(profileInitials('Mika')).toBe('M');
  });

  it('has nothing to show without a name', () => {
    expect(profileInitials(null)).toBeNull();
    expect(profileInitials('   ')).toBeNull();
  });
});

describe('floatingActionDelay', () => {
  it('starts the first button immediately and steps down the stack', () => {
    expect(floatingActionDelay(0)).toBe(0);
    expect(floatingActionDelay(1)).toBeCloseTo(FLOATING_ACTION_STAGGER_S);
    expect(floatingActionDelay(2)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * 2);
  });

  it('counts a shorter stack from its own length', () => {
    expect(floatingActionDelay(0, true, 3)).toBeCloseTo(FLOATING_ACTION_STAGGER_S * 2);
    expect(floatingActionDelay(2, true, 3)).toBe(0);
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
