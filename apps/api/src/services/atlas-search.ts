import { getPrismaClient } from '@trove/db';
import type { AtlasDestinationKind } from '@trove/types';

const ATLAS_RESULT_LIMIT = 5;

/** A guide found by Global Search: secondary to the traveller's own Trove (PRD 16.3). */
export type AtlasSearchResult = {
  countryCode: string;
  href: string;
  kind: AtlasDestinationKind | 'country';
  name: string;
  /** Empty for a country guide. */
  slug: string;
};

type DestinationRow = {
  country_code: string;
  kind: string | null;
  name: string | null;
  slug: string | null;
};

function fold(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase();
}

/** Exact, then prefix, then word-prefix, then substring; 0 for no match. */
export function atlasMatchScore(query: string, value: string) {
  const needle = fold(query);
  const haystack = fold(value);
  if (!needle || !haystack) return 0;
  if (haystack === needle) return 4;
  if (haystack.startsWith(needle)) return 3;
  if (haystack.split(/[\s,()-]+/).some((word) => word.startsWith(needle))) return 2;
  if (haystack.includes(needle)) return 1;
  return 0;
}

const englishRegions = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Matches Atlas countries by name and the destinations their stored guides
 * link to. Database only: no Wikivoyage or Google request runs for a search.
 */
export async function searchAtlasGuides(input: string): Promise<AtlasSearchResult[]> {
  const query = input.trim();
  if (query.length < 2) return [];
  const prisma = getPrismaClient();
  const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

  const [countries, destinations] = await Promise.all([
    prisma.atlasCountry.findMany({ select: { countryCode: true, wikivoyageTitle: true } }),
    prisma.$queryRaw<DestinationRow[]>`
      SELECT g.country_code, d->>'slug' AS slug, d->>'name' AS name, d->>'kind' AS kind
      FROM trove.atlas_guides g
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(g.content->'destinations') = 'array'
          THEN g.content->'destinations' ELSE '[]'::jsonb END
      ) AS d
      WHERE g.slug = '' AND g.language = 'en' AND d->>'name' ILIKE ${pattern}
      LIMIT 40
    `,
  ]);

  const ranked: Array<AtlasSearchResult & { score: number }> = [];
  for (const country of countries) {
    const names = [country.wikivoyageTitle, englishRegions.of(country.countryCode) ?? ''];
    const score = Math.max(
      ...names.map((name) => atlasMatchScore(query, name)),
      country.countryCode === query.toUpperCase() ? 4 : 0,
    );
    if (score) {
      ranked.push({
        countryCode: country.countryCode,
        href: `/atlas/${country.countryCode}`,
        kind: 'country',
        name: englishRegions.of(country.countryCode) ?? country.wikivoyageTitle,
        // Countries outrank a destination matched equally well.
        score: score + 0.5,
        slug: '',
      });
    }
  }
  for (const row of destinations) {
    if (!row.slug || !row.name) continue;
    const score = atlasMatchScore(query, row.name);
    if (!score) continue;
    const kind =
      row.kind === 'city' || row.kind === 'region' || row.kind === 'destination'
        ? row.kind
        : 'destination';
    ranked.push({
      countryCode: row.country_code,
      href: `/atlas/${row.country_code}/${row.slug}`,
      kind,
      name: row.name,
      score,
      slug: row.slug,
    });
  }

  const seen = new Set<string>();
  return ranked
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .filter((result) => {
      const key = `${result.countryCode}:${result.slug}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, ATLAS_RESULT_LIMIT)
    .map(({ score: _score, ...result }) => result);
}
