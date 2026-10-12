/**
 * The searches a traveller opened something from lately, kept on this device
 * only: a convenience for the search sheet, never part of their account.
 */
const recentSearchesKey = 'trove:recent-searches:v1';
export const MAX_RECENT_SEARCHES = 5;

export function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(recentSearchesKey) ?? 'null');
    return Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(searches: readonly string[]) {
  try {
    window.localStorage.setItem(recentSearchesKey, JSON.stringify(searches));
  } catch {
    // Private browsing or a full quota should not break search.
  }
}

/** Puts a search first, once, ignoring case; the list keeps its newest few. */
export function rememberSearch(searches: readonly string[], query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [...searches];
  return [
    trimmed,
    ...searches.filter((entry) => entry.toLocaleLowerCase() !== trimmed.toLocaleLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
}

/**
 * Splits text around the first case-insensitive match of the query, so the
 * matching words can be set apart. No match leaves the text whole.
 */
export function splitMatch(text: string, query: string): [string, string, string] {
  const needle = query.trim().toLocaleLowerCase();
  const index = needle ? text.toLocaleLowerCase().indexOf(needle) : -1;
  if (index < 0) return [text, '', ''];
  return [
    text.slice(0, index),
    text.slice(index, index + needle.length),
    text.slice(index + needle.length),
  ];
}
