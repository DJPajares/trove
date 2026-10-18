import { draftDayStay, type AiPlannerDraft, type AiPlannerModelProposal } from '@trove/types';

type Stay = NonNullable<AiPlannerModelProposal['stays']>[number];
const dated = (
  stay: Stay,
): stay is Stay & { firstNightDayIndex: number; lastNightDayIndex: number } =>
  stay.firstNightDayIndex !== null && stay.lastNightDayIndex !== null;
const overlaps = (a: Stay, b: Stay) =>
  dated(a) &&
  dated(b) &&
  a.firstNightDayIndex <= b.lastNightDayIndex &&
  b.firstNightDayIndex <= a.lastNightDayIndex;

/** Never repair a traveler's hotel dates by silently moving or dropping a hotel. */
export function normalizeProposedStays(input: readonly Stay[], dayCount: number): Stay[] {
  const stays = input.map((stay): Stay => {
    const source = stay.source ?? 'user';
    if (!dated(stay))
      return {
        ...stay,
        source,
        firstNightDayIndex: null,
        lastNightDayIndex: null,
        assignmentIssue: stay.assignmentIssue ?? 'dates_missing',
      };
    if (
      stay.firstNightDayIndex > stay.lastNightDayIndex ||
      stay.firstNightDayIndex >= dayCount ||
      stay.lastNightDayIndex >= dayCount
    )
      return {
        ...stay,
        source,
        firstNightDayIndex: null,
        lastNightDayIndex: null,
        assignmentIssue: 'dates_conflicting',
      };
    return { ...stay, source };
  });
  const conflicts = new Set(
    stays.filter(
      (a) =>
        a.source === 'user' &&
        !a.isMain &&
        stays.some(
          (b) =>
            b !== a &&
            b.source === 'user' &&
            !b.isMain &&
            b.candidatePlaceId !== a.candidatePlaceId &&
            overlaps(a, b),
        ),
    ),
  );
  const users = stays
    .filter((stay) => stay.source === 'user')
    .map((stay): Stay =>
      conflicts.has(stay)
        ? {
            ...stay,
            firstNightDayIndex: null,
            lastNightDayIndex: null,
            assignmentIssue: 'dates_conflicting',
          }
        : stay,
    );
  // Unknown user bookings are not permission to choose a replacement hotel.
  if (users.some((stay) => !dated(stay))) return users;
  const occupied = new Set<number>();
  for (const stay of users)
    if (dated(stay))
      for (let night = stay.firstNightDayIndex; night <= stay.lastNightDayIndex; night++)
        occupied.add(night);
  const recommendations: Stay[] = [];
  for (const stay of stays.filter((entry) => entry.source === 'model')) {
    if (!dated(stay)) continue;
    let first: number | null = null;
    for (
      let night = stay.firstNightDayIndex;
      night <= Math.min(stay.lastNightDayIndex + 1, dayCount - 1);
      night++
    ) {
      const free = night <= stay.lastNightDayIndex && night < dayCount - 1 && !occupied.has(night);
      if (free) {
        first ??= night;
        occupied.add(night);
      } else if (first !== null) {
        recommendations.push({
          ...stay,
          firstNightDayIndex: first,
          lastNightDayIndex: night - 1,
          isMain: false,
        });
        first = null;
      }
    }
  }
  return [...users, ...recommendations];
}

/** Temporary stays override an explicitly designated main stay's broad coverage. */
export function proposedStayNights(stays: readonly Stay[]) {
  const nights = new Map<number, string>();
  const ordered = [...stays].sort(
    (a, b) =>
      Number(a.source === 'user') - Number(b.source === 'user') ||
      Number(Boolean(b.isMain)) - Number(Boolean(a.isMain)),
  );
  for (const stay of ordered)
    if (dated(stay))
      for (let night = stay.firstNightDayIndex; night <= stay.lastNightDayIndex; night++)
        nights.set(night, stay.candidatePlaceId);
  return nights;
}

export function mainStayCandidateId(stays: readonly Stay[]): string | null {
  const explicit = stays.find((stay) => stay.isMain && stay.source !== 'model');
  if (explicit) return explicit.candidatePlaceId;
  const counts = new Map<string, { nights: number; first: number }>();
  for (const [night, id] of proposedStayNights(stays)) {
    const entry = counts.get(id) ?? { nights: 0, first: night };
    entry.nights++;
    entry.first = Math.min(entry.first, night);
    counts.set(id, entry);
  }
  return (
    [...counts].sort((a, b) => b[1].nights - a[1].nights || a[1].first - b[1].first)[0]?.[0] ?? null
  );
}

/** Provider aliases can be one hotel: count its nights together before Apply. */
export function refreshDraftMainStay(draft: AiPlannerDraft) {
  if (!draft.stays?.length) return;
  const places = new Map(draft.places.map((place) => [place.id, place]));
  const identity = (ref: string) => {
    const place = places.get(ref);
    return place?.resolution === 'verified' ? place.placeId : ref;
  };
  const explicit =
    draft.mainStaySource === 'user' ? draft.stays.find((stay) => stay.isMain)?.placeRefId : null;
  const counts = new Map<string, number>();
  for (const day of draft.days.slice(0, -1)) {
    const ref = draftDayStay(day).end;
    if (ref) counts.set(identity(ref), (counts.get(identity(ref)) ?? 0) + 1);
  }
  const main = explicit ? identity(explicit) : [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const stay of draft.stays)
    stay.isMain = Boolean((explicit || stay.arriveDate) && identity(stay.placeRefId) === main);
}
