import { describe, expect, test } from 'vitest';

import { nextHeaderScrollState, type HeaderScrollState } from '../lib/shell/collapsing-header.ts';

const expanded: HeaderScrollState = { collapsed: false, lastOffset: 0 };

describe('nextHeaderScrollState', () => {
  test('stays expanded while the page is near the top', () => {
    expect(nextHeaderScrollState(expanded, 0)).toEqual({ collapsed: false, lastOffset: 0 });
    expect(nextHeaderScrollState(expanded, 64)).toEqual({ collapsed: false, lastOffset: 64 });
  });

  test('collapses once scrolling down past the header', () => {
    const state = nextHeaderScrollState({ collapsed: false, lastOffset: 64 }, 200);

    expect(state).toEqual({ collapsed: true, lastOffset: 200 });
  });

  test('returns on any upward scroll, without needing to reach the top', () => {
    const state = nextHeaderScrollState({ collapsed: true, lastOffset: 900 }, 700);

    expect(state).toEqual({ collapsed: false, lastOffset: 700 });
  });

  test('re-expands when scrolling back above the header, whatever the direction', () => {
    const state = nextHeaderScrollState({ collapsed: true, lastOffset: 400 }, 20);

    expect(state).toEqual({ collapsed: false, lastOffset: 20 });
  });

  test('ignores the jitter that momentum scrolling reports', () => {
    const settled: HeaderScrollState = { collapsed: true, lastOffset: 500 };

    // Two pixels back up is a finger resting on the screen, not an intent to
    // see the header again.
    expect(nextHeaderScrollState(settled, 498)).toBe(settled);
    expect(nextHeaderScrollState(settled, 502)).toBe(settled);
  });

  test('accumulates sub-threshold moves rather than discarding them', () => {
    // `lastOffset` is held while jitter is ignored, so a slow drag still adds up
    // to a real direction instead of never crossing the dead zone.
    const settled: HeaderScrollState = { collapsed: true, lastOffset: 500 };

    expect(nextHeaderScrollState(settled, 498)).toBe(settled);
    expect(nextHeaderScrollState(settled, 495)).toEqual({ collapsed: false, lastOffset: 495 });
  });

  test('treats an over-scrolled negative offset as the top of the page', () => {
    const state = nextHeaderScrollState({ collapsed: true, lastOffset: 300 }, -80);

    expect(state).toEqual({ collapsed: false, lastOffset: 0 });
  });
});
