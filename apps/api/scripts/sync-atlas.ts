/**
 * Keeps Atlas's shared reference data in Trove's database (PRD 40.6).
 *
 *   pnpm --filter @trove/api atlas:sync            countries and their climate
 *   pnpm --filter @trove/api atlas:sync --guides   ...and every country's guide
 *
 * Countries: each Wikivoyage article title, the city typical conditions are
 * measured at, and twelve months of conditions averaged over the last five
 * complete years, upserted into `atlas_countries`. Conditions already stored
 * for the current five years are reused, so the climate archive is asked only
 * once a new year completes. Run it about once a year.
 * Answers from Wikivoyage and the climate archive are cached on disk
 * (ATLAS_CACHE_DIR, default node_modules/.cache/atlas), so a run stopped by a
 * rate limit resumes where it left off; a country with no pattern yet is
 * stored without one rather than with an invented one.
 *
 * Guides (`--guides`): reads each country's article once and stores it in
 * `atlas_guides`, so no reader waits on Wikivoyage. Guides already stored are
 * kept; `--refresh` checks every one for a newer revision.
 *
 * Needs DATABASE_URL. Wikimedia asks automated clients to identify
 * themselves: set ATLAS_USER_AGENT to a name and contact address first.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPrismaClient } from '@trove/db';
import type { AtlasClimateNorm } from '@trove/types';

import { resetAtlasCountryMemory } from '../src/services/atlas-countries.js';
import { getAtlasGuide, resetAtlasGuideFailures } from '../src/services/atlas-guides.js';
import { getProviderCallTotal } from '../src/services/provider-usage.js';
import { ATLAS_CITIES } from './atlas-cities.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.ATLAS_CACHE_DIR ?? path.resolve(here, '../node_modules/.cache/atlas');
const USER_AGENT = process.env.ATLAS_USER_AGENT ?? 'TroveAtlas/1.0';
const WITH_GUIDES = process.argv.includes('--guides');
const REFRESH_GUIDES = process.argv.includes('--refresh');
const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const PAUSE_MS = 1_500;
/** Whole articles are heavier than title lookups: one every few seconds. */
const GUIDE_PAUSE_MS = 5_000;
const GUIDE_RETRY_WAITS_MS = [30_000, 60_000, 120_000, 240_000];

type Sample = { max: number; min: number; precipitation: number };

/**
 * The same five complete years and 1 mm wet-day threshold as Insights'
 * climate norms (services/climate-norms.ts), restated because that module
 * works per cell-month rather than per year of daily data.
 */
const CLIMATE_YEARS = 5;
const WET_DAY_MM = 1;
const MIN_SAMPLE_DAYS = 20;

function climateYears(now: Date) {
  const to = now.getUTCFullYear() - 1;
  return { from: to - CLIMATE_YEARS + 1, to };
}

function summarizeClimate(samples: readonly Sample[]) {
  if (samples.length < MIN_SAMPLE_DAYS) return null;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    temperatureMaxC: Math.round(mean(samples.map((sample) => sample.max)) * 10) / 10,
    temperatureMinC: Math.round(mean(samples.map((sample) => sample.min)) * 10) / 10,
    wetDayShare:
      Math.round(
        (100 * samples.filter((sample) => sample.precipitation >= WET_DAY_MM).length) /
          samples.length,
      ) / 100,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url: URL, attempts = 4): Promise<Response | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (response?.ok) return response;
    if (response && response.status !== 429 && response.status < 500) return null;
    await sleep(PAUSE_MS * 2 ** (attempt + 2));
  }
  return null;
}

async function cached<T>(name: string, load: () => Promise<T | null>): Promise<T | null> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    const value = await load();
    if (value !== null) await writeFile(file, JSON.stringify(value));
    return value;
  }
}

/** Resolves each candidate title, following redirects, fifty to a request. */
async function resolveTitles(candidates: Map<string, string>) {
  const resolved = new Map<string, string>();
  const entries = [...candidates.entries()];
  for (let start = 0; start < entries.length; start += 50) {
    const batch = entries.slice(start, start + 50);
    const key = `titles-${batch.map(([code]) => code).join('')}`;
    const answer = await cached<{ from: string; to: string | null }[]>(key, async () => {
      const url = new URL(WIKIVOYAGE_API);
      url.search = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        redirects: '1',
        titles: batch.map(([, title]) => title).join('|'),
      }).toString();
      const response = await politeFetch(url);
      if (!response) return null;
      const body = (await response.json()) as {
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages?: { title: string; missing?: boolean }[];
        };
      };
      const follow = (title: string) => {
        let current = body.query?.normalized?.find((n) => n.from === title)?.to ?? title;
        current = body.query?.redirects?.find((r) => r.from === current)?.to ?? current;
        const page = body.query?.pages?.find((p) => p.title === current);
        return page && !page.missing ? current : null;
      };
      return batch.map(([, title]) => ({ from: title, to: follow(title) }));
    });
    await sleep(PAUSE_MS);
    for (const [code, title] of batch) {
      const to = answer?.find((a) => a.from === title)?.to;
      if (to) resolved.set(code, to);
    }
  }
  return resolved;
}

async function climateFor(
  code: string,
  latitude: number,
  longitude: number,
  years: { from: number; to: number },
) {
  return cached<AtlasClimateNorm[]>(`climate-${code}-${years.from}-${years.to}`, async () => {
    const url = new URL(ARCHIVE_URL);
    url.search = new URLSearchParams({
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      end_date: `${years.to}-12-31`,
      latitude: String(latitude),
      longitude: String(longitude),
      start_date: `${years.from}-01-01`,
      timezone: 'auto',
    }).toString();
    const response = await politeFetch(url);
    await sleep(PAUSE_MS);
    if (!response) return null;
    const body = (await response.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: unknown[];
        temperature_2m_min?: unknown[];
        precipitation_sum?: unknown[];
      };
    };
    const byMonth = new Map<number, Sample[]>();
    (body.daily?.time ?? []).forEach((day, index) => {
      const max = body.daily?.temperature_2m_max?.[index];
      const min = body.daily?.temperature_2m_min?.[index];
      const precipitation = body.daily?.precipitation_sum?.[index];
      if (typeof max !== 'number' || typeof min !== 'number' || typeof precipitation !== 'number')
        return;
      const month = Number(day.slice(5, 7));
      byMonth.set(month, [...(byMonth.get(month) ?? []), { max, min, precipitation }]);
    });
    const months: AtlasClimateNorm[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const norm = summarizeClimate(byMonth.get(month) ?? []);
      if (!norm) return null;
      months.push({ month, ...norm });
    }
    return months;
  });
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const codes = Object.keys(ATLAS_CITIES).sort();
  const candidates = new Map(
    codes.map((code) => [code, ATLAS_CITIES[code]!.wikivoyage ?? names.of(code) ?? code]),
  );
  const titles = await resolveTitles(candidates);
  const unresolved = codes.filter((code) => !titles.has(code));
  if (unresolved.length) {
    console.error(
      `No Wikivoyage article for: ${unresolved.map((c) => `${c} (${candidates.get(c)})`).join(', ')}`,
    );
  }

  const years = climateYears(new Date());
  const prisma = getPrismaClient();
  // Conditions already stored for the same five years are kept as they are,
  // so a run after the seed migration asks the climate archive nothing.
  const stored = new Map(
    (await prisma.atlasCountry.findMany()).map((row) => [row.countryCode, row]),
  );
  let withoutClimate = 0;
  let written = 0;
  for (const code of codes) {
    const title = titles.get(code);
    if (!title) continue;
    const city = ATLAS_CITIES[code]!;
    const existing = stored.get(code);
    const current =
      existing?.climate && existing.climateYearTo === years.to
        ? (existing.climate as AtlasClimateNorm[])
        : null;
    const climate = current ?? (await climateFor(code, city.latitude, city.longitude, years));
    if (!climate) withoutClimate += 1;
    const data = {
      climateCity: city.city,
      latitude: city.latitude,
      longitude: city.longitude,
      region: city.region,
      wikivoyageTitle: title,
      // A failed climate fetch never erases a pattern already stored.
      ...(climate ? { climate, climateYearFrom: years.from, climateYearTo: years.to } : {}),
    };
    await prisma.atlasCountry.upsert({
      create: { ...data, countryCode: code },
      update: data,
      where: { countryCode: code },
    });
    written += 1;
    process.stdout.write(`${code}${climate ? '' : '?'} `);
  }
  console.log(`\n${written} countries stored, ${withoutClimate} still without a climate pattern.`);
  resetAtlasCountryMemory();

  if (!WITH_GUIDES) return;
  let guides = 0;
  let missing = 0;
  for (const code of codes) {
    const title = titles.get(code);
    if (!title) continue;
    // Wikimedia answers a burst of whole-article requests with 429, so each
    // country is retried after a growing wait rather than skipped.
    let guide = null;
    const callsBefore = getProviderCallTotal();
    for (let attempt = 0; attempt <= GUIDE_RETRY_WAITS_MS.length; attempt += 1) {
      resetAtlasGuideFailures();
      guide = await getAtlasGuide(code, { force: REFRESH_GUIDES, title, userAgent: USER_AGENT });
      if (guide || attempt === GUIDE_RETRY_WAITS_MS.length) break;
      const wait = GUIDE_RETRY_WAITS_MS[attempt]!;
      process.stdout.write(`(${code}: waiting ${wait / 1_000}s) `);
      await sleep(wait);
    }
    if (guide) guides += 1;
    else missing += 1;
    process.stdout.write(`${code}${guide ? '' : '?'} `);
    // A guide already stored asked Wikivoyage nothing, so needs no pause.
    if (getProviderCallTotal() > callsBefore) await sleep(GUIDE_PAUSE_MS);
  }
  console.log(`\n${guides} guides stored, ${missing} could not be read this run.`);
}

await main();
