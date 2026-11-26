import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATLAS_GUIDE_REFRESH_MS,
  getAtlasDestinationGuide,
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
    read: async (countryCode, slug = '') =>
      saved.findLast((g) => g.countryCode === countryCode && g.slug === slug) ?? null,
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

  it('resolves linked destination sub-guides and rejects unknown slugs without calling Wikivoyage', async () => {
    const store = memoryStore();
    let calls = 0;
    const fetcher = async (input: string | URL) => {
      calls += 1;
      const url = String(input);
      const isBohol = url.includes('titles=Bohol');
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                revisions: [
                  {
                    revid: isBohol ? 99 : 10,
                    slots: {
                      main: {
                        content: isBohol
                          ? 'Limestone hills.\n\n==See==\n* {{see| name=Chocolate Hills | content=Over 1,200 hills. }}\n'
                          : 'An archipelago.\n\n==Other destinations==\n* [[Bohol]] — Chocolate Hills.\n\n==Understand==\nIsland nation.\n',
                      },
                    },
                  },
                ],
                title: isBohol ? 'Bohol' : 'Philippines',
              },
            ],
          },
        }),
        { status: 200 },
      );
    };

    const unknown = await getAtlasDestinationGuide('PH', 'not-a-real-place', {
      fetcher,
      now: () => NOW,
      store,
      title: 'Philippines',
    });
    expect(unknown).toBe('unknown');
    expect(calls).toBe(1); // Only the country guide was fetched.

    const bohol = await getAtlasDestinationGuide('PH', 'bohol', {
      fetcher,
      now: () => NOW,
      store,
      title: 'Philippines',
    });
    expect(bohol).not.toBe('unknown');
    expect(bohol).not.toBeNull();
    if (bohol && bohol !== 'unknown') {
      expect(bohol.destination.slug).toBe('bohol');
      expect(bohol.guide.slug).toBe('bohol');
      expect(bohol.guide.title).toBe('Bohol');
      expect(bohol.guide.sections[0]?.id).toBe('see');
    }
    expect(calls).toBe(2);
  });

  it('automatically refreshes a legacy country guide stored without destinations', async () => {
    const store = memoryStore();
    await store.write({
      content: {
        lead: ['Old lead.'],
        sections: [{ blocks: [], id: 'understand', title: 'Understand' }],
      },
      countryCode: 'PH',
      fetchedAt: NOW,
      revisionId: 1n,
      slug: '',
      title: 'Philippines',
    });

    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                revisions: [
                  {
                    revid: 2,
                    slots: {
                      main: {
                        content:
                          'Archipelago.\n\n==Other destinations==\n* [[Bohol]] — Hills.\n\n==Understand==\nIslands.\n',
                      },
                    },
                  },
                ],
                title: 'Philippines',
              },
            ],
          },
        }),
        { status: 200 },
      );
    };

    const upgraded = await getAtlasGuide('PH', {
      fetcher,
      now: () => NOW,
      store,
      title: 'Philippines',
    });
    expect(calls).toBe(1);
    expect(upgraded?.destinations?.map((d) => d.slug)).toEqual(['bohol']);
  });
});
