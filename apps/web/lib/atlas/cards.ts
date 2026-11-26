export type AtlasCardItem = {
  title: string;
  detail: string;
};

/**
 * Sections whose Wikivoyage bullet lists describe named places, regions,
 * dishes or experiences in "Name — description" form, suited to field-guide cards.
 */
export const CARD_LIST_SECTIONS = new Set([
  'regions',
  'cities',
  'other-destinations',
  'see',
  'do',
  'eat',
  'drink',
  'buy',
  'sleep',
]);

const SEPARATORS = [' — ', ' – ', ': ', ' - '] as const;

/**
 * Splits a Wikivoyage list item like "Pad Thai — stir-fried rice noodles..."
 * into a concise card title and its description, or returns null for plain prose.
 */
export function parseNamedListItem(item: string): AtlasCardItem | null {
  const trimmed = item.trim();
  if (!trimmed) return null;

  for (const separator of SEPARATORS) {
    const index = trimmed.indexOf(separator);
    if (index <= 0) continue;
    const title = trimmed.slice(0, index).trim();
    const detail = trimmed.slice(index + separator.length).trim();
    const maxTitle = separator === ' — ' || separator === ' – ' ? 80 : 60;
    if (!title || !detail || title.length > maxTitle) continue;
    // A full sentence before the separator is prose, not a named entry.
    if (/[.!?]$/.test(title)) continue;
    // Avoid splitting clock times like "10:00" on ": ".
    if (separator === ': ' && /\d$/.test(title) && /^\d/.test(detail)) continue;
    return { detail, title };
  }

  return null;
}

/**
 * Converts a bullet list into structured cards when most items follow the
 * "Name — description" pattern; returns null so ordinary prose lists stay bullets.
 */
export function extractListCards(items: readonly string[]): AtlasCardItem[] | null {
  if (items.length < 2) return null;
  const parsed = items.map(parseNamedListItem);
  const matched = parsed.filter((entry): entry is AtlasCardItem => entry !== null);
  if (matched.length / items.length < 0.6) return null;
  return items.map((raw, index) => parsed[index] ?? { detail: '', title: raw.trim() });
}
