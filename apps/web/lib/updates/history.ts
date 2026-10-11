import { isEntryId, RELEASE_SCHEMA_VERSION, WEB_APP_ID } from './release';

// Public product history is device-level state, independent of account/private trip cleanup.
// v1 recorded the page's entries before its worker activated. Keep that key
// untouched for older tabs, but do not trust it as proof of an installation.
export const INSTALLED_CHANGELOG_KEY = 'trove-web-installed-changelog-v2';

export function parseInstalledHistory(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      value?.schemaVersion === RELEASE_SCHEMA_VERSION &&
      value?.appId === WEB_APP_ID &&
      Array.isArray(value.entryIds) &&
      value.entryIds.every(isEntryId)
    ) {
      return [...new Set<string>(value.entryIds)];
    }
  } catch {
    // Missing, corrupt, or unavailable history falls back to the active worker.
  }
  return [];
}

/** Merge rather than replace so an older open tab or a rollback cannot erase installations. */
export function rememberInstalledEntries(
  activatedIds: readonly string[],
  knownIds: readonly string[] = [],
): string[] {
  let ids = [...new Set([...activatedIds, ...knownIds])];
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(INSTALLED_CHANGELOG_KEY);
    ids = [...new Set([...ids, ...parseInstalledHistory(raw)])].sort();
    const next = JSON.stringify({
      schemaVersion: RELEASE_SCHEMA_VERSION,
      appId: WEB_APP_ID,
      entryIds: ids,
    });
    if (raw !== next) storage.setItem(INSTALLED_CHANGELOG_KEY, next);
  } catch {
    // Keep the same baseline in memory when storage is disabled or full.
  }
  return ids;
}
