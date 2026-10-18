import { z } from 'zod';
import {
  AI_PLANNER_SCHEMA_VERSION,
  aiPlannerCandidatePlaceSchema,
  aiPlannerConstraintSchema,
  aiPlannerModelProposalSchema,
  aiPlannerNormalizedRequestSchema,
  aiPlannerProposalItemSchema,
  type AiPlannerModelProposal,
} from '@trove/types';
import { AiPlannerRepairLog } from './ai-planner-repair-log.js';
import { enumerateDateRange } from './trip-rules.js';
import { normalizeProposedStays } from './ai-planning-stays.js';

const index = z.number().int().min(0);

/**
 * Like `localityKey`, but keeps every script: a traveller who names their hotel
 * in Japanese or Thai named it just as plainly as one who wrote in English.
 */
function stayKey(text: string) {
  return text
    .replace(/[Đđ]/g, 'd')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Words any lodging name shares, which prove nothing about which one was meant. */
const GENERIC_STAY_WORDS = new Set(
  [
    'hotel',
    'hotels',
    'hostel',
    'motel',
    'resort',
    'inn',
    'suites',
    'apartment',
    'apartments',
    'house',
    'lodge',
    'stay',
    'residence',
    'the',
    'and',
    'ホテル',
    '旅館',
    '酒店',
    '飯店',
    '饭店',
    '호텔',
    'โรงแรม',
  ].map(stayKey),
);

/** Scripts written without spaces, where a word can only be found inside a run. */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Whether the traveller named this stay, rather than the model choosing one.
 * A distinctive word of its name must appear in the request; a city in the
 * name ("Hilton Tokyo") is no evidence, because the traveller named the city as
 * a destination. A name too short to have a distinctive word ("W Hotel")
 * counts when the request carries the whole name.
 */
function stayNamedInRequest(
  names: readonly string[],
  requestKey: string,
  destinationWords: ReadonlySet<string>,
) {
  const requestWords = new Set(requestKey.split(' '));
  const unspacedRequest = requestKey.replaceAll(' ', '');
  return names.some((name) => {
    const words = stayKey(name)
      .split(' ')
      .filter((word) => word && !destinationWords.has(word));
    const distinctive = words.filter((word) => !GENERIC_STAY_WORDS.has(word));
    if (
      distinctive.some((word) =>
        UNSPACED_SCRIPT.test(word)
          ? word.length >= 2 && unspacedRequest.includes(word)
          : word.length >= 3 && requestWords.has(word),
      )
    )
      return true;
    return distinctive.length > 0 && ` ${requestKey} `.includes(` ${words.join(' ')} `);
  });
}

/**
 * Provider-facing shape. The model chooses the trip and the provenance of its
 * choices; application code supplies stable identifiers and default metadata.
 * Stored drafts retain the existing versioned contract.
 */
export const aiPlannerCompactProposalSchema = z
  .object({
    destinations: z.array(
      z
        .object({
          candidatePlaceIndex: index,
          destinationIntentIndex: index.nullable(),
          rationale: z.string().trim().max(500).nullable(),
          source: z.enum(['user', 'model']),
        })
        .strict(),
    ),
    items: z.array(
      aiPlannerProposalItemSchema
        .omit({ id: true, candidatePlaceId: true, destinationIntentId: true, constraintIds: true })
        .extend({
          candidatePlaceIndex: index.nullable(),
          constraintIndices: z.array(index),
          destinationIntentIndex: index.nullable(),
        }),
    ),
    daySummaries: z
      .array(
        z
          .object({
            dayIndex: z.number().int(),
            name: z.string().trim().max(500),
            itemIndices: z.array(z.number().int()),
          })
          .strict(),
      )
      .optional(),
    normalizedRequest: aiPlannerNormalizedRequestSchema
      .omit({ schemaVersion: true, destinations: true, constraints: true })
      .extend({
        constraints: z.array(
          aiPlannerConstraintSchema
            .omit({ id: true, destinationIntentId: true })
            .extend({ destinationIntentIndex: index.nullable() }),
        ),
        destinations: z.array(z.string().trim().min(1).max(200)),
      }),
    omittedOptionalDestinations: z.array(z.string().trim().min(1).max(200)),
    partySize: aiPlannerModelProposalSchema.shape.partySize,
    places: z.array(aiPlannerCandidatePlaceSchema.omit({ id: true })),
    selectedDurationDays: aiPlannerModelProposalSchema.shape.selectedDurationDays,
    lodgingRecommendations: z.enum(['allow', 'declined']).optional(),
    stays: z
      .array(
        z
          .object({
            candidatePlaceIndex: index.describe('The places entry the traveller is sleeping at.'),
            firstNightDayIndex: index
              .nullable()
              .describe('Arrival night, zero-based. Null when the traveller gave no usable dates.'),
            lastNightDayIndex: index
              .nullable()
              .describe('Last night, zero-based. Null when dates are unknown.'),
            source: z.enum(['user', 'model']).optional(),
            isMain: z.boolean().optional(),
            assignmentIssue: z.enum(['dates_missing', 'dates_conflicting']).optional(),
          })
          .strict(),
      )
      .optional()
      .describe(
        'Every named accommodation, including those with unknown dates, and recommended lodging unless declined. Mark recommendations as model source.',
      ),
    tripDescription: aiPlannerModelProposalSchema.shape.tripDescription,
    tripName: aiPlannerModelProposalSchema.shape.tripName,
  })
  .strict();

export type AiPlannerCompactProposal = z.infer<typeof aiPlannerCompactProposalSchema>;

export function createAiPlannerCompactProposalSchema(maxItineraryDays: number) {
  return aiPlannerCompactProposalSchema.extend({
    items: z.array(
      aiPlannerCompactProposalSchema.shape.items.element.extend({
        dayIndex: z
          .number()
          .int()
          .min(0)
          .max(maxItineraryDays - 1)
          .nullable(),
      }),
    ),
  });
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function requestedRecurringWorkDays(rawPrompt: string) {
  const mentioned = new Set(
    [
      ...rawPrompt
        .toLowerCase()
        .matchAll(/\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/g),
    ].map((match) => match[1]!.slice(0, -1)),
  );
  return new Set(WEEKDAYS.flatMap((day, index) => (mentioned.has(day) ? [index] : [])));
}

function exactDates(compact: AiPlannerCompactProposal) {
  const preference = compact.normalizedRequest.datePreference;
  return preference.kind === 'exact'
    ? enumerateDateRange(preference.startDate, preference.endDate)
    : null;
}

function hasExplicitDuration(rawPrompt: string, minutes: number) {
  // A turnaround range (for example 24-48 hours) describes elapsed service
  // time, not the length of a fitting. Ignore numbers on either side of it.
  const withoutRanges = rawPrompt.replace(
    /\b\d+\s*(?:-|to)\s*\d+\s*(?:hours?|hrs?|minutes?|mins?)\b/gi,
    '',
  );
  return [...withoutRanges.matchAll(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/gi)].some(
    (match) => {
      const amount = Number(match[1]);
      const unit = match[2]!.toLowerCase();
      return (unit.startsWith('h') ? amount * 60 : amount) === minutes;
    },
  );
}

function removeInventedUserDurations(
  rawPrompt: string,
  constraints: AiPlannerModelProposal['normalizedRequest']['constraints'],
  items: AiPlannerModelProposal['items'],
) {
  for (const constraint of constraints) {
    if (
      constraint.source !== 'user' ||
      constraint.durationMinutes === null ||
      hasExplicitDuration(rawPrompt, constraint.durationMinutes)
    )
      continue;
    constraint.durationMinutes = null;
    for (const item of items) {
      if (item.constraintIds.includes(constraint.id) && item.durationProvenance === 'user_owned') {
        item.durationProvenance = 'ai_estimated';
      }
    }
  }
}

function splitRepeatedHardOccurrences(
  constraints: AiPlannerModelProposal['normalizedRequest']['constraints'],
  items: AiPlannerModelProposal['items'],
  dates: string[] | null,
) {
  const originalConstraintCount = constraints.length;
  for (let constraintIndex = 0; constraintIndex < originalConstraintCount; constraintIndex += 1) {
    const constraint = constraints[constraintIndex]!;
    if (
      constraint.source !== 'user' ||
      constraint.strength !== 'hard' ||
      constraint.date !== null ||
      constraint.localTime !== null ||
      constraint.durationMinutes !== null
    )
      continue;
    const matches = items.filter((item) => item.constraintIds.includes(constraint.id));
    if (matches.length < 2) continue;
    for (const [occurrence, item] of matches.entries()) {
      const occurrenceConstraint =
        occurrence === 0
          ? constraint
          : { ...constraint, id: `${constraint.id}:occurrence:${occurrence}` };
      occurrenceConstraint.date = item.dayIndex === null ? null : (dates?.[item.dayIndex] ?? null);
      occurrenceConstraint.label = item.label;
      if (occurrence > 0) constraints.push(occurrenceConstraint);
      item.constraintIds = item.constraintIds.map((id) =>
        id === constraint.id ? occurrenceConstraint.id : id,
      );
    }
  }
}

function alignRecurringWork(
  rawPrompt: string,
  constraints: AiPlannerModelProposal['normalizedRequest']['constraints'],
  items: AiPlannerModelProposal['items'],
  dates: string[] | null,
) {
  if (!dates) return;
  const weekdays = requestedRecurringWorkDays(rawPrompt);
  if (!weekdays.size) return;
  const required = dates.flatMap((date, dayIndex) =>
    weekdays.has(new Date(`${date}T00:00:00Z`).getUTCDay()) ? [{ date, dayIndex }] : [],
  );
  const workItems = items
    .filter((item) => item.blockType === 'work' && item.origin === 'user')
    .sort((left, right) => (left.dayIndex ?? Infinity) - (right.dayIndex ?? Infinity));
  if (!workItems.length) return;
  const assigned = new Set<string>();
  const align = (item: AiPlannerModelProposal['items'][number], date: string, dayIndex: number) => {
    item.dayIndex = dayIndex;
    for (const constraintId of item.constraintIds) {
      const constraint = constraints.find((entry) => entry.id === constraintId);
      if (constraint?.kind === 'work' && constraint.source === 'user') constraint.date = date;
    }
    assigned.add(item.id);
  };
  const remaining = new Set(required.map(({ dayIndex }) => dayIndex));
  for (const item of workItems) {
    const labels = item.constraintIds
      .flatMap((id) => {
        const constraint = constraints.find((entry) => entry.id === id);
        return constraint ? [constraint.label, item.label] : [];
      })
      .join(' ')
      .toLowerCase();
    const namedWeekday = WEEKDAYS.find((day) => new RegExp(`\\b${day}s?\\b`).test(labels));
    if (!namedWeekday) continue;
    const target = required.find(
      ({ date, dayIndex }) =>
        remaining.has(dayIndex) &&
        new Date(`${date}T00:00:00Z`).getUTCDay() === WEEKDAYS.indexOf(namedWeekday),
    );
    if (!target) continue;
    align(item, target.date, target.dayIndex);
    remaining.delete(target.dayIndex);
  }
  const unassigned = workItems.filter((item) => !assigned.has(item.id));
  for (const target of required.filter(({ dayIndex }) => remaining.has(dayIndex))) {
    const item = unassigned.shift();
    if (!item) break;
    align(item, target.date, target.dayIndex);
  }
}

function preserveNightFlightLanguage(
  rawPrompt: string,
  constraints: AiPlannerModelProposal['normalizedRequest']['constraints'],
  items: AiPlannerModelProposal['items'],
) {
  const nightRequest = rawPrompt.match(
    /\bflights?\b[^.!?]{0,100}\b(?:at night|nighttime)\b|\bnight\s+flights?\b/i,
  )?.[0];
  if (!nightRequest) return;
  for (const item of items) {
    if (item.blockType !== 'transport' || item.origin !== 'user') continue;
    const flightConstraint = item.constraintIds
      .map((id) => constraints.find((constraint) => constraint.id === id))
      .find(
        (constraint) => constraint?.kind === 'transport' && /\bflight\b/i.test(constraint.label),
      );
    if (!flightConstraint) continue;
    if (/\bnight\b/i.test(flightConstraint.label)) item.label = flightConstraint.label;
    else if (!item.notes?.includes(nightRequest)) {
      item.notes = [nightRequest, item.notes].filter(Boolean).join(' ').slice(0, 5_000);
    }
    if (item.schedule.kind === 'day_part') item.schedule.dayPart = 'evening';
  }
}

/**
 * A model index pointing past its array is a reference to nothing: it is
 * cleared, never a reason to discard the plan.
 */
function reference<T>(values: readonly T[], at: number | null, log: AiPlannerRepairLog): T | null {
  if (at === null) return null;
  const value = values[at];
  if (value === undefined) log.add('reference_cleared');
  return value ?? null;
}

function localityKey(name: string) {
  return name
    .replace(/[Đđ]/g, 'd')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function expandAiPlannerProposal(
  compact: AiPlannerCompactProposal,
  rawPrompt: string,
  log = new AiPlannerRepairLog(),
): AiPlannerModelProposal {
  const destinationIntents = compact.normalizedRequest.destinations.map((name, i) => ({
    id: `intent:${i}`,
    name,
  }));
  const places = compact.places.map((place, i) => ({ ...place, id: `place:${i}` }));
  const constraints = compact.normalizedRequest.constraints.map((constraint, i) => {
    const { destinationIntentIndex, ...fields } = constraint;
    return {
      ...fields,
      id: `constraint:${i}`,
      destinationIntentId: reference(destinationIntents, destinationIntentIndex, log)?.id ?? null,
    };
  });
  const assumptions: AiPlannerModelProposal['assumptions'] = [];
  if (compact.normalizedRequest.tripName === null) {
    assumptions.push({
      code: 'trip_name_inferred',
      fieldPath: 'trip.name',
      id: 'assumption:trip-name',
      rationale: null,
      value: compact.tripName,
    });
  }
  if (
    compact.normalizedRequest.datePreference.kind === 'exact' &&
    !/\b(?:19|20|21)\d{2}\b/.test(rawPrompt)
  ) {
    assumptions.push({
      code: 'date_year_inferred',
      fieldPath: 'normalizedRequest.datePreference',
      id: 'assumption:date-year',
      rationale: null,
      value: compact.normalizedRequest.datePreference.startDate.slice(0, 4),
    });
  }
  const placeForIntent = (intent: { name: string }) => {
    let place =
      places.find((candidate) => localityKey(candidate.name) === localityKey(intent.name)) ?? null;
    if (!place) {
      place = {
        id: `place:${places.length}`,
        name: intent.name,
        note: null,
        searchQuery: intent.name,
      };
      places.push(place);
    }
    return place;
  };
  const destinations = compact.destinations.flatMap((destination, i) => {
    let place = reference(places, destination.candidatePlaceIndex, log);
    let intent = reference(destinationIntents, destination.destinationIntentIndex, log);
    // Provenance follows the request, not the model's label for it: a
    // destination the traveller named is theirs, any other is a suggestion.
    if (!intent && place) {
      intent =
        destinationIntents.find(
          (candidate) => localityKey(candidate.name) === localityKey(place!.name),
        ) ?? null;
    }
    const source = intent ? ('user' as const) : ('model' as const);
    if (source !== destination.source) log.add('destination_repaired');
    // A model can point a city intent at a same-named office, hotel, or
    // attraction. The traveller chose the locality, so its place identity
    // comes from that intent; provider grounding then verifies it normally.
    if (intent && (!place || localityKey(place.name) !== localityKey(intent.name))) {
      place = placeForIntent(intent);
    }
    if (!place) {
      log.add('destination_repaired');
      return [];
    }
    const assumptionId = source === 'model' ? `assumption:destination:${i}` : null;
    if (assumptionId) {
      assumptions.push({
        code: 'destination_inferred',
        fieldPath: `trip.destinations.${i}`,
        id: assumptionId,
        rationale: destination.rationale,
        value: place.name,
      });
    }
    return [
      {
        assumptionId,
        candidatePlaceId: place.id,
        destinationIntentId: intent?.id ?? null,
        source,
      },
    ];
  });
  compact.omittedOptionalDestinations.forEach((name, i) => {
    assumptions.push({
      code: 'optional_destination_omitted',
      fieldPath: 'trip.destinations',
      id: `assumption:omitted:${i}`,
      rationale: null,
      value: name,
    });
  });
  const items = compact.items.map((item, i) => {
    const { candidatePlaceIndex, constraintIndices, destinationIntentIndex, ...fields } = item;
    return {
      ...fields,
      id: `item:${i}`,
      candidatePlaceId: reference(places, candidatePlaceIndex, log)?.id ?? null,
      destinationIntentId: reference(destinationIntents, destinationIntentIndex, log)?.id ?? null,
      constraintIds: [
        ...new Set(
          constraintIndices.flatMap((at) => {
            const constraint = reference(constraints, at, log);
            return constraint ? [constraint.id] : [];
          }),
        ),
      ],
    };
  });
  const daySummaries = compact.daySummaries
    ?.filter(
      (summary) =>
        summary.dayIndex >= 0 &&
        summary.dayIndex <
          (compact.normalizedRequest.datePreference.kind === 'exact'
            ? enumerateDateRange(
                compact.normalizedRequest.datePreference.startDate,
                compact.normalizedRequest.datePreference.endDate,
              ).length
            : (compact.selectedDurationDays ?? 0)),
    )
    .map((summary) => ({
      dayIndex: summary.dayIndex,
      name: summary.name,
      // Title hints are cosmetic. A bad reference falls back to a surviving item,
      // never discards an otherwise useful plan or spends another model call.
      itemIds: summary.itemIndices.map((at) => items[at]?.id ?? `item:missing:${at}`),
    }));
  // A stay is only ever one the traveller named: a place whose name the
  // request never mentions is a suggestion, and is dropped.
  const requestKey = stayKey(rawPrompt);
  const destinationWords = new Set(
    destinationIntents.flatMap((intent) => stayKey(intent.name).split(' ')),
  );
  const lodgingRecommendations =
    compact.lodgingRecommendations === 'declined' ||
    /\b(?:do not|don['’]t|no|without)\s+(?:(?:recommend|suggest)(?:ing|ed)?\s+)?(?:(?:a|any|new)\s+)?(?:hotels?|lodging|accommodations?|places? to stay|stays?)\b/i.test(
      rawPrompt,
    )
      ? ('declined' as const)
      : ('allow' as const);
  const stays = normalizeProposedStays(
    (compact.stays ?? []).flatMap((stay) => {
      const place = places[stay.candidatePlaceIndex];
      if (!place) return [];
      const named = stayNamedInRequest(
        [place.name, place.searchName ?? ''].filter(Boolean),
        requestKey,
        destinationWords,
      );
      const source =
        stay.source === 'model' ? ('model' as const) : named ? ('user' as const) : null;
      if (!source) return [];
      if (
        source === 'model' &&
        destinations.some((destination) => destination.candidatePlaceId === place.id)
      )
        return [];
      if (source === 'model' && lodgingRecommendations === 'declined') return [];
      return [
        {
          candidatePlaceId: place.id,
          firstNightDayIndex: stay.firstNightDayIndex,
          lastNightDayIndex: stay.lastNightDayIndex,
          source,
          isMain: source === 'user' && stay.isMain === true,
        },
      ];
    }),
    compact.normalizedRequest.datePreference.kind === 'exact'
      ? enumerateDateRange(
          compact.normalizedRequest.datePreference.startDate,
          compact.normalizedRequest.datePreference.endDate,
        ).length
      : (compact.selectedDurationDays ?? 0),
  );
  // A stay is where days start and end. A stop the model added there on its
  // own (checking in, heading back) repeats the Stay row; one the traveller
  // asked for, such as dinner at the hotel, is theirs and stays.
  const stayPlaceIds = new Set(stays.map((stay) => stay.candidatePlaceId));
  const plannedItems = items.filter((item) => {
    const repeatsStay =
      item.origin === 'model' &&
      item.candidatePlaceId !== null &&
      stayPlaceIds.has(item.candidatePlaceId);
    if (repeatsStay) log.add('stay_item_removed');
    return !repeatsStay;
  });
  const dates = exactDates(compact);
  removeInventedUserDurations(rawPrompt, constraints, plannedItems);
  splitRepeatedHardOccurrences(constraints, plannedItems, dates);
  alignRecurringWork(rawPrompt, constraints, plannedItems, dates);
  preserveNightFlightLanguage(rawPrompt, constraints, plannedItems);
  return {
    assumptions,
    destinations,
    items: plannedItems,
    daySummaries,
    normalizedRequest: {
      ...compact.normalizedRequest,
      constraints,
      destinations: destinationIntents,
      schemaVersion: AI_PLANNER_SCHEMA_VERSION,
    },
    partySize: compact.partySize,
    places,
    schemaVersion: AI_PLANNER_SCHEMA_VERSION,
    selectedDurationDays: compact.selectedDurationDays,
    stays,
    lodgingRecommendations,
    tripDescription: compact.tripDescription,
    tripName: compact.tripName,
  };
}
