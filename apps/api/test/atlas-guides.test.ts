import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATLAS_GUIDE_REFRESH_MS,
  getAtlasGuide,
  resetAtlasGuideFailures,
  type AtlasGuideStore,
} from '../src/services/atlas-guides.js';
import { getProviderCallTotal, resetProviderCallCounts } from '../src/services/provider-usage.js';

const COUNTRY = 'JP';
const TITLE = 'Japan';
const NOW = new Date('2026-11-26T00:00:00Z');

function memoryStore(): AtlasGuideStore & { saved: Parameters<AtlasGuideStore['write']>[0][] } {
  const saved: Parameters<AtlasGuideStore['write']>[0][] = [];
  return {
    read: async (countryCode) => saved.findLast((g) => g.countryCode === countryCode) ?? null,
    saved,
    write: async (guide) => {
      saved.push(guide);
    },
  };
}

function article(revid: number) {
  return new Response(
    JSON.stringify({
      query: {
        pages: [
          {
            revisions: [
              {
                revid,
                slots: { main: { content: 'An intro.\n\n==See==\nA temple.\n' } },
              },
            ],
            title: 'Somewhere',
          },
        ],
      },
    }),
    { status: 200 },
  );
}

describe('getAtlasGuide', () => {
  beforeEach(() => {
    resetAtlasGuideFailures();
    resetProviderCallCounts();
  });
  afterEach(() => resetAtlasGuideFailures());

  it('reads the article once, then serves every later reader from the stored copy', async () => {
    const store = memoryStore();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return article(42);
    };
    const first = await getAtlasGuide(COUNTRY, { title: TITLE, fetcher, now: () => NOW, store });
    const second = await getAtlasGuide(COUNTRY, { title: TITLE, fetcher, now: () => NOW, store });

    expect(first).toMatchObject({
      lead: ['An intro.'],
      revisionId: 42,
      sections: [{ id: 'see', title: 'See' }],
      title: 'Somewhere',
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(getProviderCallTotal()).toBe(1);
  });

  it('checks a month-old copy for a newer revision, and keeps the stored guide when the check fails', async () => {
    const store = memoryStore();
    await getAtlasGuide(COUNTRY, {
      title: TITLE,
      fetcher: async () => article(1),
      now: () => NOW,
      store,
    });
    const later = new Date(NOW.getTime() + ATLAS_GUIDE_REFRESH_MS + 1);

    const refreshed = await getAtlasGuide(COUNTRY, {
      title: TITLE,
      fetcher: async () => article(2),
      now: () => later,
      store,
    });
    expect(refreshed?.revisionId).toBe(2);

    const failing = async () => new Response('busy', { status: 429 });
    const evenLater = new Date(later.getTime() + ATLAS_GUIDE_REFRESH_MS + 1);
    const stale = await getAtlasGuide(COUNTRY, {
      title: TITLE,
      fetcher: failing,
      now: () => evenLater,
      store,
    });
    expect(stale?.revisionId).toBe(2);
  });

  it('remembers a failure for a few minutes instead of asking again', async () => {
    const store = memoryStore();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      return new Response('busy', { status: 429 });
    };
    expect(
      await getAtlasGuide(COUNTRY, { title: TITLE, fetcher: failing, now: () => NOW, store }),
    ).toBeNull();
    expect(
      await getAtlasGuide(COUNTRY, { title: TITLE, fetcher: failing, now: () => NOW, store }),
    ).toBeNull();
    expect(calls).toBe(1);
  });

  it('checks for a newer revision whatever the age when forced, as the sync does', async () => {
    const store = memoryStore();
    await getAtlasGuide(COUNTRY, {
      fetcher: async () => article(1),
      now: () => NOW,
      store,
      title: TITLE,
    });
    const forced = await getAtlasGuide(COUNTRY, {
      fetcher: async () => article(2),
      force: true,
      now: () => NOW,
      store,
      title: TITLE,
    });
    expect(forced?.revisionId).toBe(2);
    expect(store.saved).toHaveLength(2);
  });
});
