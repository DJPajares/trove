import type { AtlasDrivingSide, AtlasQuickFacts } from '@trove/types';

/**
 * Fetches CC0 country quick facts from Wikidata (PRD 40.1 & 40.3):
 * official languages (P37), electrical plug types (P2853), driving side
 * (P1622), and national dish (P8647), keyed by ISO 3166-1 alpha-2 code (P297).
 *
 * Called only during `atlas:sync` (never on live user requests) in a single
 * batched SPARQL query for all countries, cached on disk alongside climate data.
 */
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';

const QUICK_FACTS_QUERY = `
SELECT ?code ?langLabel ?plugLabel ?driveLabel ?dishLabel WHERE {
  ?country wdt:P297 ?code .
  FILTER(STRLEN(?code) = 2)
  OPTIONAL { ?country wdt:P37 ?lang . }
  OPTIONAL { ?country wdt:P2853 ?plug . }
  OPTIONAL { ?country wdt:P1622 ?drive . }
  OPTIONAL { ?country wdt:P8647 ?dish . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;

export type WikidataBinding = {
  code?: { value?: string };
  dishLabel?: { value?: string };
  driveLabel?: { value?: string };
  langLabel?: { value?: string };
  plugLabel?: { value?: string };
};

const MAX_LANGUAGES = 3;
const MAX_PLUG_TYPES = 4;

/** Maps verbose Wikidata plug labels (e.g. "Type A", "NEMA 1-15", "Europlug") to concise IEC letters when recognizable. */
export function normalizePlugLabel(raw: string): string | null {
  const value = raw.trim();
  if (!value || /^Q\d+$/i.test(value)) return null;
  const typeMatch = /\btype\s+([A-N])\b/i.exec(value);
  if (typeMatch) return typeMatch[1]!.toUpperCase();
  if (/nema\s*1-15/i.test(value)) return 'A';
  if (/nema\s*5-15/i.test(value)) return 'B';
  if (/europlug|cee\s*7\/16/i.test(value)) return 'C';
  if (/bs\s*546\b/i.test(value)) return 'D';
  if (/cee\s*7\/5|type\s*e/i.test(value)) return 'E';
  if (/schuko|cee\s*7\/4|cee\s*7\/7/i.test(value)) return 'F';
  if (/bs\s*1363/i.test(value)) return 'G';
  if (/si\s*32/i.test(value)) return 'H';
  if (/as\/nzs\s*3112/i.test(value)) return 'I';
  if (/sev\s*1011/i.test(value)) return 'J';
  if (/sraf\s*1962/i.test(value)) return 'K';
  if (/cei\s*23-50/i.test(value)) return 'L';
  if (/sans\s*164-1/i.test(value)) return 'M';
  if (/nbr\s*14136/i.test(value)) return 'N';
  return value.length <= 24 ? value : null;
}

export function normalizeDrivingSide(raw: string): AtlasDrivingSide | null {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('left')) return 'left';
  if (lower.includes('right')) return 'right';
  return null;
}

function cleanLabel(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value || /^Q\d+$/i.test(value)) return null;
  return value;
}

export function parseWikidataQuickFacts(
  bindings: readonly WikidataBinding[],
): Record<string, AtlasQuickFacts> {
  const acc = new Map<
    string,
    {
      drivingSide: AtlasDrivingSide | null;
      languages: Set<string>;
      nationalDish: string | null;
      plugTypes: Set<string>;
    }
  >();

  for (const row of bindings) {
    const code = row.code?.value?.trim().toUpperCase();
    if (!code || !/^[A-Z]{2}$/.test(code)) continue;
    let bucket = acc.get(code);
    if (!bucket) {
      bucket = {
        drivingSide: null,
        languages: new Set(),
        nationalDish: null,
        plugTypes: new Set(),
      };
      acc.set(code, bucket);
    }

    const lang = cleanLabel(row.langLabel?.value);
    if (lang) bucket.languages.add(lang);

    const plug = row.plugLabel?.value ? normalizePlugLabel(row.plugLabel.value) : null;
    if (plug) bucket.plugTypes.add(plug);

    if (!bucket.drivingSide && row.driveLabel?.value) {
      bucket.drivingSide = normalizeDrivingSide(row.driveLabel.value);
    }

    if (!bucket.nationalDish) {
      const dish = cleanLabel(row.dishLabel?.value);
      if (dish) bucket.nationalDish = dish;
    }
  }

  const result: Record<string, AtlasQuickFacts> = {};
  for (const [code, bucket] of acc.entries()) {
    const languages = [...bucket.languages]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_LANGUAGES);
    const plugTypes = [...bucket.plugTypes]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_PLUG_TYPES);
    if (
      languages.length === 0 &&
      plugTypes.length === 0 &&
      !bucket.drivingSide &&
      !bucket.nationalDish
    ) {
      continue;
    }
    result[code] = {
      drivingSide: bucket.drivingSide,
      languages,
      nationalDish: bucket.nationalDish,
      plugTypes,
    };
  }
  return result;
}

export async function fetchWikidataQuickFacts(
  userAgent: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<Record<string, AtlasQuickFacts> | null> {
  const url = new URL(WIKIDATA_SPARQL_URL);
  url.search = new URLSearchParams({ format: 'json', query: QUICK_FACTS_QUERY }).toString();
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': userAgent,
    },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    results?: { bindings?: WikidataBinding[] };
  } | null;
  if (!Array.isArray(body?.results?.bindings)) return null;
  return parseWikidataQuickFacts(body.results.bindings);
}
