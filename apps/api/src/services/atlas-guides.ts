import { getPrismaClient } from '@trove/db';
import type { AtlasGuide, AtlasSection } from '@trove/types';

import { getAtlasCountry } from './atlas-countries.js';
import { parseWikivoyageArticle } from './atlas-wikitext.js';
import { recordProviderCacheEvent, recordProviderCall } from './provider-usage.js';
import { singleFlight } from './single-flight.js';

/**
 * Atlas guides (PRD 40.6): shared reference data, stored permanently.
 *
 * A guide is read from Wikivoyage once - by `atlas:sync`, or by the first
 * traveller to open it - and kept as plain-text sections that every reader
 * shares. The licence permits keeping open-licensed text, so nothing deletes
 * it. Once a stored copy is a month old, the next reader triggers a check for
 * a newer revision; a failed check leaves the stored guide exactly as it was,
 * and a recent failure is remembered for a few minutes so a refreshing reader
 * does not become a stream of requests.
 */
const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php';
/** How old a stored guide may grow before a reader triggers a revision check. */
export const ATLAS_GUIDE_REFRESH_MS = 30 * 24 * 60 * 60 * 1_000;
const FAILURE_MEMORY_MS = 10 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** A country article is tens of kilobytes; anything far larger is not one. */
const MAX_WIKITEXT_LENGTH = 2_000_000;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type StoredGuide = {
  content: unknown;
  countryCode: string;
  fetchedAt: Date;
  revisionId: bigint;
  title: string;
};

export type AtlasGuideStore = {
  read(countryCode: string): Promise<StoredGuide | null>;
  write(guide: StoredGuide): Promise<void>;
};

export type AtlasGuideOptions = {
  fetcher?: Fetcher;
  /** Check Wikivoyage whatever the stored copy's age, as `atlas:sync` does. */
  force?: boolean;
  /** The country's Wikivoyage title; read from the stored countries when absent. */
  title?: string;
  now?: () => Date;
  store?: AtlasGuideStore;
  /** Wikimedia asks automated clients for a name and contact address. */
  userAgent?: string;
};

const recentFailures = new Map<string, number>();

export function resetAtlasGuideFailures() {
  recentFailures.clear();
}

function prismaStore(): AtlasGuideStore {
  const prisma = getPrismaClient();
  return {
    read: (countryCode) =>
      prisma.atlasGuide.findUnique({
        where: { atlas_guide_subject: { countryCode, language: 'en' } },
      }),
    async write(guide) {
      const data = {
        content: guide.content as object,
        fetchedAt: guide.fetchedAt,
        revisionId: guide.revisionId,
        title: guide.title,
      };
      await prisma.atlasGuide.upsert({
        create: { ...data, countryCode: guide.countryCode, language: 'en' },
        update: data,
        where: { atlas_guide_subject: { countryCode: guide.countryCode, language: 'en' } },
      });
    },
  };
}

function toGuide(stored: StoredGuide): AtlasGuide | null {
  const content = stored.content as { lead?: unknown; sections?: unknown } | null;
  if (!content || !Array.isArray(content.lead) || !Array.isArray(content.sections)) return null;
  return {
    countryCode: stored.countryCode,
    fetchedAt: stored.fetchedAt.toISOString(),
    lead: content.lead as string[],
    revisionId: Number(stored.revisionId),
    sections: content.sections as AtlasSection[],
    title: stored.title,
  };
}

async function fetchArticle(title: string, options: AtlasGuideOptions) {
  const url = new URL(WIKIVOYAGE_API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions',
    redirects: '1',
    rvprop: 'ids|content',
    rvslots: 'main',
    titles: title,
  }).toString();
  recordProviderCall({
    endpoint: '/w/api.php',
    expectedSku: 'wikivoyage-free',
    operation: 'getArticle',
    provider: 'wikivoyage',
    source: 'atlas',
  });
  const response = await (options.fetcher ?? globalThis.fetch)(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': options.userAgent ?? 'TroveAtlas/1.0',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('atlas_guide_unavailable');
  const body = (await response.json()) as {
    query?: {
      pages?: {
        missing?: boolean;
        revisions?: { revid?: number; slots?: { main?: { content?: string } } }[];
        title?: string;
      }[];
    };
  };
  const page = body.query?.pages?.[0];
  const revision = page?.revisions?.[0];
  const wikitext = revision?.slots?.main?.content;
  if (!page || page.missing || !revision?.revid || typeof wikitext !== 'string') {
    throw new Error('atlas_guide_missing');
  }
  if (wikitext.length > MAX_WIKITEXT_LENGTH) throw new Error('atlas_guide_too_large');
  return { revisionId: revision.revid, title: page.title ?? title, wikitext };
}

/**
 * The guide for one country in the bundled index, or null when the country
 * has no guide or none can be read yet.
 */
export async function getAtlasGuide(
  countryCode: string,
  options: AtlasGuideOptions = {},
): Promise<AtlasGuide | null> {
  const title = options.title ?? (await getAtlasCountry(countryCode))?.wikivoyageTitle;
  if (!title) return null;
  const now = options.now?.() ?? new Date();
  const store = options.store ?? prismaStore();
  const stored = await store.read(countryCode).catch(() => null);
  const storedGuide = stored ? toGuide(stored) : null;
  if (
    storedGuide &&
    !options.force &&
    now.getTime() - stored!.fetchedAt.getTime() < ATLAS_GUIDE_REFRESH_MS
  ) {
    recordProviderCacheEvent({
      cache: 'atlas-guide',
      kind: 'cache_hit',
      operation: 'getArticle',
      provider: 'wikivoyage',
      source: 'atlas',
    });
    return storedGuide;
  }
  const failedAt = recentFailures.get(countryCode);
  if (!options.force && failedAt !== undefined && now.getTime() - failedAt < FAILURE_MEMORY_MS) {
    recordProviderCacheEvent({
      cache: 'atlas-guide',
      kind: 'negative_cache_hit',
      operation: 'getArticle',
      provider: 'wikivoyage',
      source: 'atlas',
    });
    return storedGuide;
  }

  return singleFlight(`atlas-guide:${countryCode}`, async () => {
    try {
      const article = await fetchArticle(title, options);
      const parsed = parseWikivoyageArticle(article.wikitext);
      const fresh = {
        content: parsed,
        countryCode,
        fetchedAt: now,
        revisionId: BigInt(article.revisionId),
        title: article.title,
      };
      await store.write(fresh).catch(() => undefined);
      recentFailures.delete(countryCode);
      return toGuide(fresh);
    } catch {
      recentFailures.set(countryCode, now.getTime());
      return storedGuide;
    }
  });
}
