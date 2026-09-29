import type { AiPlannerDraft, AiPlannerModelProposal } from '@trove/types';

const GENERIC_TITLE =
  /^(?:day\s*\d+|day\s*(?:one|two|three|four|five|six|seven)|explor(?:e|ing)\s+.+|discover(?:ing)?\s+.+|(?:amazing|ultimate|unforgettable|perfect)\s+.+|.+\s+(?:adventure|experience|getaway))$/i;
const TITLE_FILLER = new Set([
  'and',
  'the',
  'a',
  'an',
  'in',
  'at',
  'of',
  'on',
  'for',
  'with',
  'day',
  'morning',
  'afternoon',
  'evening',
  'food',
  'walk',
  'time',
]);

function words(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function supportedName(
  name: string,
  items: AiPlannerDraft['days'][number]['items'],
  places: AiPlannerDraft['places'],
) {
  const trimmed = name.trim();
  const count = words(trimmed).length;
  if (!trimmed || trimmed.length > 80 || count < 2 || count > 6 || GENERIC_TITLE.test(trimmed))
    return false;
  const evidence = new Set(
    words(
      items
        .map((item) =>
          [item.label, places.find((place) => place.id === item.placeRefId)?.name ?? ''].join(' '),
        )
        .join(' '),
    ),
  );
  const distinctive = words(trimmed).filter((word) => word.length >= 3 && !TITLE_FILLER.has(word));
  return distinctive.length > 0 && distinctive.every((word) => evidence.has(word));
}

function fallbackName(items: AiPlannerDraft['days'][number]['items']) {
  const main = [...items].sort((a, b) => {
    const priority = (item: typeof a) =>
      (item.priority === 'must_go' ? 8 : 0) +
      (item.isAnchor ? 4 : 0) +
      (item.blockType === 'activity' ? 2 : item.blockType === 'free_time' ? 0 : 1);
    return priority(b) - priority(a);
  })[0];
  if (!main) return null;
  const label = main.label.trim();
  return label.length <= 80 ? label : `${label.slice(0, 79).trimEnd()}…`;
}

/** Run after every deterministic move/removal and provider validation. Titles are presentation only. */
export function finalizeDraftDayTitles(
  draft: AiPlannerDraft,
  summaries: AiPlannerModelProposal['daySummaries'],
) {
  draft.days.forEach((day, dayIndex) => {
    const summary = summaries?.find((entry) => entry.dayIndex === dayIndex);
    const referenced = summary?.itemIds.map((id) => day.items.find((item) => item.id === id));
    day.name =
      summary?.itemIds.length &&
      referenced?.every(Boolean) &&
      supportedName(summary.name, referenced as typeof day.items, draft.places)
        ? summary.name.trim()
        : fallbackName(day.items);
  });
  return draft;
}
