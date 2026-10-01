import type { z } from 'zod';
import {
  AI_PLANNER_MAX_DAYS,
  AI_PLANNER_TRIP_LENGTH_TIERS,
  type AiPlannerConstraint,
  type AiPlannerModelProposal,
} from '@trove/types';
import {
  aiPlannerCompactProposalSchema,
  type AiPlannerCompactProposal,
} from './ai-planner-compact.js';
import { AiPlannerRepairLog } from './ai-planner-repair-log.js';
import { DAY_PART_ORDER, DAY_PART_WINDOWS } from './day-part-windows.js';
import { enumerateDateRange } from './trip-rules.js';

type Path = readonly PropertyKey[];
type Json = Record<string, unknown>;

/** Arrays whose elements nothing refers to by position, so one can be dropped. */
const DROPPABLE_ARRAYS = new Set([
  'constraintIndices',
  'daySummaries',
  'destinations',
  'interests',
  'itemIndices',
  'items',
  'omittedOptionalDestinations',
  'stays',
]);
/** `normalizedRequest.destinations` is referenced by index, unlike the trip's. */
const INDEXED_PARENTS = new Set(['normalizedRequest']);
const MAX_PASSES = 8;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function container(root: unknown, path: Path): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key as string];
  }
  return current;
}

function setAt(root: unknown, path: Path, value: unknown) {
  const parent = container(root, path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return false;
  (parent as Record<PropertyKey, unknown>)[path.at(-1) as string] = value;
  return true;
}

/** The deepest element of a droppable array that contains `path`. */
function droppableElement(path: Path): Path | null {
  for (let index = path.length - 1; index > 0; index -= 1) {
    const key = path[index - 1];
    if (typeof path[index] !== 'number' || typeof key !== 'string') continue;
    if (!DROPPABLE_ARRAYS.has(key)) continue;
    if (key === 'destinations' && INDEXED_PARENTS.has(String(path[index - 2]))) continue;
    return path.slice(0, index + 1);
  }
  return null;
}

/** A daypart for a clock time the model was not allowed to state. */
export function dayPartForLocalTime(
  localTime: unknown,
): 'morning' | 'afternoon' | 'evening' | null {
  if (typeof localTime !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(localTime);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  const part = DAY_PART_ORDER.find((name) => minute < DAY_PART_WINDOWS[name].endMinute);
  return part ? (part.toLowerCase() as 'morning' | 'afternoon' | 'evening') : null;
}

function relaxedSchedule(schedule: unknown) {
  const localTime = isObject(schedule) ? schedule.localTime : null;
  const dayPart = isObject(schedule) ? schedule.dayPart : null;
  return {
    dayPart:
      typeof dayPart === 'string' &&
      ['morning', 'afternoon', 'evening', 'anytime'].includes(dayPart)
        ? dayPart
        : (dayPartForLocalTime(localTime) ?? 'anytime'),
    kind: 'day_part',
  };
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The value a field takes when the model's own is unusable, or `undefined`
 * when the field has no safe default and its element must go instead.
 */
function fieldDefault(root: Json, path: Path, rawPrompt: string): { value: unknown } | undefined {
  const key = String(path.at(-1));
  const parent = container(root, path.slice(0, -1));
  const inConstraint = path.includes('constraints');
  const inPlace = path[0] === 'places';
  const inDestination = path[0] === 'destinations';

  if (path.length === 1) {
    const request = isObject(root.normalizedRequest) ? root.normalizedRequest : {};
    const destinations = Array.isArray(request.destinations) ? request.destinations : [];
    const places = Array.isArray(root.places) ? root.places : [];
    const name = firstText(
      request.tripName,
      destinations[0],
      isObject(places[0]) ? places[0].name : null,
      rawPrompt,
    );
    switch (key) {
      case 'destinations':
      case 'items':
      case 'omittedOptionalDestinations':
      case 'places':
      case 'stays':
        return { value: [] };
      case 'daySummaries':
        return { value: undefined };
      case 'normalizedRequest':
        return {
          value: {
            constraints: [],
            datePreference: { kind: 'missing' },
            destinations: [],
            interests: [],
            pace: null,
            partySize: null,
            tripName: null,
          },
        };
      case 'partySize':
      case 'selectedDurationDays':
        return { value: null };
      case 'tripName':
        return name ? { value: name.slice(0, 120) } : undefined;
      case 'tripDescription':
        return firstText(root.tripName, name)
          ? { value: firstText(root.tripName, name)!.slice(0, 500) }
          : undefined;
    }
    return undefined;
  }

  if (path[0] === 'normalizedRequest' && path.length === 2) {
    switch (key) {
      case 'constraints':
      case 'destinations':
      case 'interests':
        return { value: [] };
      case 'datePreference':
        return { value: { kind: 'missing' } };
      case 'pace':
      case 'partySize':
      case 'tripName':
        return { value: null };
    }
    return undefined;
  }
  if (inConstraint) {
    switch (key) {
      case 'date':
      case 'dayPart':
      case 'destinationIntentIndex':
      case 'durationMinutes':
      case 'localTime':
      case 'priority':
        return { value: null };
      case 'kind':
        return { value: 'activity' };
      case 'source':
        return { value: 'model' };
      case 'strength':
        return { value: 'flexible' };
      case 'label':
        return {
          value: isObject(parent) && typeof parent.kind === 'string' ? parent.kind : 'activity',
        };
    }
    return undefined;
  }

  if (inPlace) {
    switch (key) {
      case 'note':
        return { value: null };
      case 'name': {
        const name = isObject(parent) ? firstText(parent.searchQuery) : null;
        return name ? { value: name.slice(0, 200) } : undefined;
      }
      case 'searchQuery': {
        const query = isObject(parent) ? firstText(parent.name) : null;
        return query ? { value: query.slice(0, 300) } : undefined;
      }
    }
    return undefined;
  }

  if (inDestination) {
    switch (key) {
      case 'destinationIntentIndex':
      case 'rationale':
        return { value: null };
      case 'source':
        return { value: 'model' };
    }
    return undefined;
  }

  if (path[0] === 'items') {
    switch (key) {
      case 'blockType':
        return { value: 'activity' };
      case 'candidatePlaceIndex':
      case 'dayIndex':
      case 'destinationIntentIndex':
      case 'notes':
      case 'priority':
        return { value: null };
      case 'constraintIndices':
        return { value: [] };
      case 'durationMinutes':
        return { value: 60 };
      case 'durationProvenance':
        return { value: 'ai_estimated' };
      case 'isAnchor':
        return { value: false };
      case 'origin':
        return { value: 'model' };
    }
    return undefined;
  }

  if (path[0] === 'daySummaries' && key === 'itemIndices') return { value: [] };
  return undefined;
}

/**
 * Brings a raw provider object into the compact schema, field by field, rather
 * than rejecting the whole plan for one bad value. Returns `null` only when the
 * output is not an object at all, which no repair can turn into a plan.
 */
export function repairCompactOutput(
  output: unknown,
  rawPrompt: string,
  log = new AiPlannerRepairLog(),
): AiPlannerCompactProposal | null {
  if (!isObject(output)) return null;
  const root = structuredClone(output);

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const parsed = aiPlannerCompactProposalSchema.safeParse(root);
    if (parsed.success) return parsed.data;

    const drops: Path[] = [];
    let changed = false;
    for (const issue of parsed.error.issues as z.core.$ZodIssue[]) {
      const fixed = repairIssue(root, issue, rawPrompt, log);
      if (fixed === 'drop') {
        const element = droppableElement(issue.path);
        if (element) drops.push(element);
      } else if (fixed) {
        changed = true;
      }
    }

    // Deepest and last first, so removing one element never shifts another
    // that is still waiting to be removed.
    const unique = [...new Map(drops.map((path) => [JSON.stringify(path), path])).values()];
    unique.sort((left, right) => {
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === b) continue;
        if (typeof a === 'number' && typeof b === 'number') return b - a;
        return String(a).localeCompare(String(b));
      }
      return right.length - left.length;
    });
    for (const path of unique) {
      const list = container(root, path.slice(0, -1));
      if (!Array.isArray(list)) continue;
      list.splice(path.at(-1) as number, 1);
      log.add('output_element_dropped');
      changed = true;
    }
    if (!changed) return null;
  }
  const parsed = aiPlannerCompactProposalSchema.safeParse(root);
  return parsed.success ? parsed.data : null;
}

function repairIssue(
  root: Json,
  issue: z.core.$ZodIssue,
  rawPrompt: string,
  log: AiPlannerRepairLog,
): boolean | 'drop' {
  const path = issue.path;
  const scheduleAt = path.indexOf('schedule');
  if (scheduleAt !== -1 && path[0] === 'items') {
    const schedulePath = path.slice(0, scheduleAt + 1);
    setAt(root, schedulePath, relaxedSchedule(container(root, schedulePath)));
    log.add('output_schedule_relaxed');
    return true;
  }
  const dateAt = path.indexOf('datePreference');
  if (dateAt !== -1 && path.length > dateAt + 1) {
    setAt(root, path.slice(0, dateAt + 1), { kind: 'missing' });
    log.add('output_field_defaulted');
    return true;
  }

  const value = container(root, path);
  switch (issue.code) {
    case 'unrecognized_keys': {
      const target = container(root, path);
      if (!isObject(target)) return 'drop';
      for (const key of issue.keys) delete target[key];
      log.add('output_key_removed');
      return true;
    }
    case 'too_big': {
      if (typeof value === 'string') {
        setAt(root, path, value.trim().slice(0, Number(issue.maximum)));
        log.add('output_text_shortened');
        return true;
      }
      if (Array.isArray(value)) {
        value.splice(Number(issue.maximum));
        log.add('output_text_shortened');
        return true;
      }
      if (typeof value === 'number') {
        const key = String(path.at(-1));
        // A day past the longest trip is no day at all; anything else is
        // nearest to its own limit.
        if (key === 'dayIndex' && path[0] === 'items') setAt(root, path, null);
        else setAt(root, path, Number(issue.maximum));
        log.add('output_number_clamped');
        return true;
      }
      break;
    }
    case 'too_small': {
      if (typeof value === 'number' && issue.inclusive !== false) {
        setAt(root, path, Number(issue.minimum));
        log.add('output_number_clamped');
        return true;
      }
      break;
    }
    case 'invalid_type': {
      if (
        issue.expected === 'string' &&
        (typeof value === 'number' || typeof value === 'boolean')
      ) {
        setAt(root, path, String(value));
        log.add('output_field_defaulted');
        return true;
      }
      if (issue.expected === 'number' && typeof value === 'string' && value.trim()) {
        const number = Number(value);
        if (Number.isFinite(number)) {
          setAt(root, path, Math.round(number));
          log.add('output_number_clamped');
          return true;
        }
      }
      if (issue.expected === 'int' && typeof value === 'number' && Number.isFinite(value)) {
        setAt(root, path, Math.round(value));
        log.add('output_number_clamped');
        return true;
      }
      break;
    }
  }

  const fallback = fieldDefault(root, path, rawPrompt);
  if (fallback) {
    setAt(root, path, fallback.value);
    log.add('output_field_defaulted');
    return true;
  }
  return 'drop';
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isCalendarDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function blockTypeFor(kind: AiPlannerConstraint['kind']) {
  return kind === 'must_go' ? 'activity' : kind;
}

function defaultDuration(kind: AiPlannerConstraint['kind']) {
  return kind === 'work' ? 480 : kind === 'meeting' ? 60 : kind === 'transport' ? 120 : 90;
}

type ProposalItem = AiPlannerModelProposal['items'][number];

/**
 * Makes a parsed proposal keep its own contract, the one
 * `validateAiPlannerModelProposal` checks, by the smallest change that honours
 * the traveller: the model loses what it was never allowed to claim, and the
 * traveller's own commitments are filled in from their constraints where the
 * model left them out or got them wrong.
 */
export function repairAiPlannerModelProposal(
  proposal: AiPlannerModelProposal,
  log = new AiPlannerRepairLog(),
): AiPlannerModelProposal {
  const request = proposal.normalizedRequest;
  const constraints = new Map(request.constraints.map((constraint) => [constraint.id, constraint]));
  const places = new Set(proposal.places.map((place) => place.id));
  const intents = new Set(request.destinations.map((intent) => intent.id));

  // Dates first: every day index below is read against them.
  const preference = request.datePreference;
  if (preference.kind === 'exact') {
    if (!isCalendarDate(preference.startDate) || !isCalendarDate(preference.endDate)) {
      request.datePreference = { kind: 'missing' };
      log.add('date_range_repaired');
    } else {
      if (preference.endDate < preference.startDate) {
        [preference.startDate, preference.endDate] = [preference.endDate, preference.startDate];
        log.add('date_range_repaired');
      }
      const lastAllowed = addDays(preference.startDate, AI_PLANNER_MAX_DAYS - 1);
      if (preference.endDate > lastAllowed) {
        preference.endDate = lastAllowed;
        log.add('date_range_repaired');
      }
    }
  } else if (preference.kind === 'flexible') {
    for (const key of ['earliestStartDate', 'latestEndDate'] as const) {
      const value = preference[key];
      if (value && !isCalendarDate(value)) {
        preference[key] = null;
        log.add('date_range_repaired');
      }
    }
  }
  if (request.datePreference.kind === 'exact' && proposal.selectedDurationDays !== null) {
    proposal.selectedDurationDays = null;
    log.add('duration_tier_defaulted');
  }
  if (request.datePreference.kind !== 'exact' && proposal.selectedDurationDays === null) {
    const flexible = request.datePreference;
    const window =
      flexible.kind === 'flexible' && flexible.earliestStartDate && flexible.latestEndDate
        ? enumerateDateRange(flexible.earliestStartDate, flexible.latestEndDate).length
        : null;
    const covered = Math.max(0, ...proposal.items.map((item) => (item.dayIndex ?? -1) + 1));
    const wanted = window ?? (covered || AI_PLANNER_TRIP_LENGTH_TIERS[0]);
    proposal.selectedDurationDays =
      AI_PLANNER_TRIP_LENGTH_TIERS.toReversed().find((tier) => tier <= wanted) ??
      AI_PLANNER_TRIP_LENGTH_TIERS[0];
    log.add('duration_tier_defaulted');
  }
  const dates =
    request.datePreference.kind === 'exact'
      ? enumerateDateRange(request.datePreference.startDate, request.datePreference.endDate)
      : null;
  const dayCount = dates?.length ?? proposal.selectedDurationDays ?? AI_PLANNER_MAX_DAYS;

  // A model may suggest; only the traveller makes something fixed.
  for (const constraint of request.constraints) {
    if (constraint.source === 'model' && constraint.strength === 'hard') {
      constraint.strength = 'flexible';
      log.add('model_constraint_relaxed');
    }
    if (constraint.destinationIntentId && !intents.has(constraint.destinationIntentId)) {
      constraint.destinationIntentId = null;
      log.add('reference_cleared');
    }
  }

  for (const destination of proposal.destinations) {
    if (destination.source === 'user' && destination.assumptionId !== null) {
      destination.assumptionId = null;
      log.add('destination_repaired');
    }
  }

  for (const item of proposal.items) {
    if (item.candidatePlaceId && !places.has(item.candidatePlaceId)) {
      item.candidatePlaceId = null;
      log.add('reference_cleared');
    }
    if (item.destinationIntentId && !intents.has(item.destinationIntentId)) {
      item.destinationIntentId = null;
      log.add('reference_cleared');
    }
    const linked = item.constraintIds.filter((id) => constraints.has(id));
    if (linked.length !== item.constraintIds.length) {
      item.constraintIds = linked;
      log.add('reference_cleared');
    }
    if (item.dayIndex !== null && item.dayIndex >= dayCount) {
      item.dayIndex = dayCount - 1;
      log.add('output_number_clamped');
    }
  }

  alignHardConstraints(proposal, constraints, dates, log);

  const userConstraints = (item: ProposalItem) =>
    item.origin === 'user'
      ? item.constraintIds.flatMap((id) => {
          const constraint = constraints.get(id);
          return constraint?.source === 'user' ? [constraint] : [];
        })
      : [];
  for (const item of proposal.items) {
    const owned = userConstraints(item);
    const schedule = item.schedule;
    if (
      schedule.kind === 'exact' &&
      !owned.some((constraint) => constraint.localTime === schedule.localTime)
    ) {
      item.schedule = {
        dayPart: dayPartForLocalTime(schedule.localTime) ?? 'anytime',
        kind: 'day_part',
      };
      log.add('exact_time_relaxed');
    }
    if (
      item.durationProvenance === 'user_owned' &&
      !owned.some((constraint) => constraint.durationMinutes === item.durationMinutes)
    ) {
      item.durationProvenance = 'ai_estimated';
      log.add('duration_provenance_relaxed');
    }
    if (
      item.priority === 'must_go' &&
      !owned.some(
        (constraint) => constraint.kind === 'must_go' || constraint.priority === 'must_go',
      )
    ) {
      item.priority = 'interested';
      log.add('must_go_relaxed');
    }
  }
  return proposal;
}

/**
 * Every hard traveller commitment ends up as exactly one item that says what
 * the traveller said. A commitment the model dropped is added back from its
 * constraint; one it changed is put back. This is the harness filling in the
 * details rather than asking the model again.
 */
function alignHardConstraints(
  proposal: AiPlannerModelProposal,
  constraints: ReadonlyMap<string, AiPlannerConstraint>,
  dates: string[] | null,
  log: AiPlannerRepairLog,
) {
  const intentPlace = new Map(
    proposal.destinations.flatMap((destination) =>
      destination.destinationIntentId
        ? [[destination.destinationIntentId, destination.candidatePlaceId] as const]
        : [],
    ),
  );
  const dayCount = dates?.length ?? proposal.selectedDurationDays ?? AI_PLANNER_MAX_DAYS;
  for (const constraint of constraints.values()) {
    if (constraint.source !== 'user' || constraint.strength !== 'hard') continue;
    // A commitment dated outside the trip cannot be kept on it. It stays the
    // traveller's item, as a suggestion the plan does not have to fit.
    if (constraint.date && dates && !dates.includes(constraint.date)) {
      constraint.strength = 'flexible';
      constraint.date = null;
      log.add('commitment_outside_dates');
      continue;
    }
    const linked = proposal.items.filter((item) => item.constraintIds.includes(constraint.id));
    let item = linked[0];
    for (const extra of linked.slice(1)) {
      extra.constraintIds = extra.constraintIds.filter((id) => id !== constraint.id);
      log.add('hard_constraint_link_removed');
    }
    const dayIndex =
      constraint.date && dates
        ? dates.indexOf(constraint.date)
        : (item?.dayIndex ?? lightestDay(proposal, dayCount));
    if (!item) {
      item = {
        blockType: blockTypeFor(constraint.kind),
        candidatePlaceId: placeForLabel(proposal, constraint.label),
        constraintIds: [constraint.id],
        dayIndex,
        destinationIntentId: constraint.destinationIntentId,
        durationMinutes: constraint.durationMinutes ?? defaultDuration(constraint.kind),
        durationProvenance: constraint.durationMinutes ? 'user_owned' : 'ai_estimated',
        id: `item:constraint:${constraint.id}`,
        isAnchor: constraint.kind === 'must_go',
        label: constraint.label,
        notes: null,
        origin: 'user',
        priority: constraint.kind === 'must_go' ? 'must_go' : constraint.priority,
        schedule: constraint.localTime
          ? { kind: 'exact', localTime: constraint.localTime, source: 'user' }
          : { dayPart: constraint.dayPart ?? 'anytime', kind: 'day_part' },
      };
      if (!item.candidatePlaceId && constraint.destinationIntentId) {
        item.candidatePlaceId = intentPlace.get(constraint.destinationIntentId) ?? null;
      }
      proposal.items.push(item);
      log.add('hard_constraint_item_added');
      continue;
    }

    let aligned = false;
    const set = <K extends keyof ProposalItem>(key: K, value: ProposalItem[K]) => {
      if (JSON.stringify(item![key]) === JSON.stringify(value)) return;
      item![key] = value;
      aligned = true;
    };
    set('origin', 'user');
    set('blockType', blockTypeFor(constraint.kind));
    if (item.dayIndex !== dayIndex) {
      item.dayIndex = dayIndex;
      log.add('hard_constraint_day_assigned');
    }
    if (constraint.localTime) {
      set('schedule', { kind: 'exact', localTime: constraint.localTime, source: 'user' });
    } else if (constraint.dayPart && constraint.dayPart !== 'anytime') {
      const current = item.schedule;
      const part =
        current.kind === 'exact' ? dayPartForLocalTime(current.localTime) : current.dayPart;
      if (part !== constraint.dayPart)
        set('schedule', { dayPart: constraint.dayPart, kind: 'day_part' });
    }
    if (constraint.durationMinutes) {
      set('durationMinutes', constraint.durationMinutes);
      set('durationProvenance', 'user_owned');
    }
    if (constraint.kind === 'must_go' || constraint.priority === 'must_go') {
      set('priority', 'must_go');
    }
    if (
      constraint.destinationIntentId &&
      item.destinationIntentId !== constraint.destinationIntentId
    ) {
      set('destinationIntentId', constraint.destinationIntentId);
    }
    if (aligned) log.add('hard_constraint_item_aligned');
  }
}

/** The earliest day carrying the fewest items, for a commitment with no date. */
function lightestDay(proposal: AiPlannerModelProposal, dayCount: number) {
  const load = Array.from({ length: dayCount }, () => 0);
  for (const item of proposal.items) {
    if (item.dayIndex !== null && item.dayIndex < dayCount) load[item.dayIndex]! += 1;
  }
  return load.indexOf(Math.min(...load));
}

function placeForLabel(proposal: AiPlannerModelProposal, label: string) {
  const wanted = label.trim().toLowerCase();
  return (
    proposal.places.find((place) => {
      const name = place.name.trim().toLowerCase();
      return name.length >= 3 && (wanted.includes(name) || name.includes(wanted));
    })?.id ?? null
  );
}
