export const RELEASE_SCHEMA_VERSION = 1;
export const WEB_APP_ID = 'trove-web';
export const RELEASE_MESSAGE = 'TROVE_GET_RELEASE';
export const MAX_DISPLAY_ENTRIES = 100;

export interface ChangelogEntry {
  id: string;
  date: string;
  summaries: Record<string, string[]>;
}

export interface InstalledRelease {
  schemaVersion: typeof RELEASE_SCHEMA_VERSION;
  appId: typeof WEB_APP_ID;
  buildId: string;
  entryIds: string[];
}

export interface ReleaseManifest extends InstalledRelease {
  entries: ChangelogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function parseChangelogEntry(value: unknown): ChangelogEntry {
  if (!isRecord(value) || !isEntryId(value.id)) throw new Error('Invalid changelog ID');
  const { date, summaries } = value;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid changelog date: ${value.id}`);
  }
  if (!isRecord(summaries) || !Object.hasOwn(summaries, 'en')) {
    throw new Error(`Changelog requires English summaries: ${value.id}`);
  }
  const parsed: Record<string, string[]> = {};
  for (const [locale, lines] of Object.entries(summaries)) {
    if (
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ||
      !Array.isArray(lines) ||
      lines.length < 1 ||
      lines.length > 3 ||
      !lines.every(
        (line): line is string =>
          typeof line === 'string' &&
          line.trim() === line &&
          line.length > 0 &&
          [...line].length <= 180 &&
          !/[\r\n]/.test(line),
      )
    ) {
      throw new Error(`Changelog needs 1–3 brief summaries per locale: ${value.id}`);
    }
    parsed[locale] = lines;
  }
  return { id: value.id, date, summaries: parsed };
}

export function createReleaseManifest(entries: ChangelogEntry[], buildId: string): ReleaseManifest {
  const catalog = entries.map(parseChangelogEntry);
  const ids = catalog.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate changelog IDs');
  if (!buildId.trim()) throw new Error('Missing web build ID');
  const sorted = catalog.toSorted(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    appId: WEB_APP_ID,
    buildId,
    entryIds: sorted.map((entry) => entry.id),
    entries: sorted.slice(0, MAX_DISPLAY_ENTRIES),
  };
}

export function parseInstalledRelease(value: unknown): InstalledRelease | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RELEASE_SCHEMA_VERSION ||
    value.appId !== WEB_APP_ID ||
    typeof value.buildId !== 'string' ||
    !value.buildId.trim() ||
    !Array.isArray(value.entryIds) ||
    !value.entryIds.every(isEntryId) ||
    new Set(value.entryIds).size !== value.entryIds.length
  ) {
    return null;
  }
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    appId: WEB_APP_ID,
    buildId: value.buildId,
    entryIds: value.entryIds,
  };
}

export function parseReleaseManifest(value: unknown): ReleaseManifest | null {
  const installed = parseInstalledRelease(value);
  if (!installed || !isRecord(value) || !Array.isArray(value.entries)) return null;
  try {
    const entries = value.entries.map(parseChangelogEntry);
    if (
      entries.length > MAX_DISPLAY_ENTRIES ||
      new Set(entries.map((entry) => entry.id)).size !== entries.length ||
      entries.some((entry) => !installed.entryIds.includes(entry.id))
    ) {
      return null;
    }
    return { ...installed, entries };
  } catch {
    return null;
  }
}

export function unseenSummaries(
  target: ReleaseManifest,
  installed: InstalledRelease | null,
  installedIds: readonly string[],
  locale: string,
): { id: string; text: string }[] {
  // Only an activated worker establishes an installed baseline. A network
  // navigation can already load the waiting build's JavaScript before Update.
  if (!installed) return [];
  const known = new Set([...installed.entryIds, ...installedIds]);
  return target.entries
    .filter((entry) => !known.has(entry.id))
    .flatMap((entry) =>
      (entry.summaries[locale] ?? entry.summaries.en ?? []).map((text, index) => ({
        id: `${entry.id}:${index}`,
        text,
      })),
    );
}
