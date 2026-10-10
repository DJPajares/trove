import { describe, expect, test } from 'vitest';

import { expandAiPlannerProposal } from '../src/services/ai-planner-compact.js';
import { AiPlannerRepairLog } from '../src/services/ai-planner-repair-log.js';
import {
  dayPartForLocalTime,
  repairAiPlannerModelProposal,
  repairCompactOutput,
} from '../src/services/ai-planner-repair.js';
import {
  assembleAiPlanningDraft,
  assignDraftLegModes,
} from '../src/services/ai-planning-pipeline.js';
import {
  validateAiPlannerDraft,
  validateAiPlannerModelProposal,
} from '../src/services/ai-planning-rules.js';
import { preferredLegMode } from '../src/services/ai-planning-travel-modes.js';
import { compactModelProposal, explicitModelProposal } from './fixtures/ai-planning.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const PROMPT = 'Tokyo from October 2 to 4, 2026. Team meeting at 09:00 on Saturday.';
const TOKYO = { latitude: 35.6812, longitude: 139.7671 };

function north(km: number) {
  return { latitude: TOKYO.latitude + km / 111.2, longitude: TOKYO.longitude };
}

describe('preferredLegMode', () => {
  test('walks a short hop, rides across a city, and drives only beyond it', () => {
    expect(preferredLegMode(TOKYO, TOKYO)).toBe('walk');
    expect(preferredLegMode(TOKYO, north(1))).toBe('walk');
    expect(preferredLegMode(TOKYO, north(1.5))).toBe('transit');
    expect(preferredLegMode(TOKYO, north(35))).toBe('transit');
    expect(preferredLegMode(TOKYO, north(60))).toBe('drive');
  });
});

describe('assignDraftLegModes', () => {
  test('keeps a routed mode and chooses the stay legs by distance', () => {
    const draft = assembleAiPlanningDraft(explicitModelProposal(), NOW);
    const day = draft.days.find((entry) => entry.items.length >= 2)!;
    const [first, second] = day.items;
    day.dailyBasePlaceRefId = 'stay';
    first!.placeRefId = 'first';
    second!.placeRefId = 'second';
    const contexts = new Map([
      ['stay', { location: TOKYO }],
      ['first', { location: north(0.5) }],
      ['second', { location: north(3) }],
    ]);

    assignDraftLegModes(
      day,
      contexts,
      new Map([[`${day.date}:${first!.id}:${second!.id}`, 'drive' as const]]),
    );

    expect(day.routeStartTravelMode).toBe('walk');
    expect(first!.travelModeToNext).toBe('drive');
    expect(second!.travelModeToNext).toBe('transit');
  });
});

describe('repairCompactOutput', () => {
  test('fixes bad values field by field instead of rejecting the plan', () => {
    const compact = compactModelProposal(explicitModelProposal()) as Record<string, any>;
    compact.items[0].blockType = 'sightseeing';
    compact.items[0].label = 'x'.repeat(260);
    compact.items[0].schedule = { kind: 'exact', localTime: '14:30', source: 'model' };
    compact.items[0].unexpected = true;
    compact.items[1].durationMinutes = '90';
    compact.normalizedRequest.constraints[0].localTime = '9am';
    compact.places[0].searchQuery = '';
    const log = new AiPlannerRepairLog();

    const repaired = repairCompactOutput(compact, PROMPT, log);

    expect(repaired).not.toBeNull();
    expect(repaired!.items[0]).toMatchObject({
      blockType: 'activity',
      schedule: { dayPart: 'afternoon', kind: 'day_part' },
    });
    expect(repaired!.items[0]!.label).toHaveLength(200);
    expect(repaired!.items[0]).not.toHaveProperty('unexpected');
    expect(repaired!.items[1]!.durationMinutes).toBe(90);
    expect(repaired!.normalizedRequest.constraints[0]!.localTime).toBeNull();
    expect(repaired!.places[0]!.searchQuery).toBe(repaired!.places[0]!.name);
    expect(log.codes).toEqual(
      expect.arrayContaining([
        'output_field_defaulted',
        'output_key_removed',
        'output_schedule_relaxed',
        'output_text_shortened',
      ]),
    );
  });

  test('drops only an item it cannot repair', () => {
    const compact = compactModelProposal(explicitModelProposal()) as Record<string, any>;
    const before = compact.items.length;
    compact.items[0].label = '   ';

    const repaired = repairCompactOutput(compact, PROMPT);

    expect(repaired!.items).toHaveLength(before - 1);
  });

  test('fills a missing trip name from the destination', () => {
    const compact = compactModelProposal(explicitModelProposal()) as Record<string, any>;
    delete compact.tripName;
    compact.normalizedRequest.tripName = null;

    expect(repairCompactOutput(compact, PROMPT)?.tripName).toBe('Tokyo');
  });

  test('gives up only on output that is not an object', () => {
    expect(repairCompactOutput('not a plan', PROMPT)).toBeNull();
    expect(repairCompactOutput(null, PROMPT)).toBeNull();
  });
});

describe('repairAiPlannerModelProposal', () => {
  function expanded() {
    return expandAiPlannerProposal(compactModelProposal(explicitModelProposal()), PROMPT);
  }

  test('takes back what a model may not claim', () => {
    const proposal = expanded();
    const suggestion = {
      ...proposal.items[0]!,
      constraintIds: [],
      id: 'item:suggestion',
      origin: 'model' as const,
    };
    proposal.items.push(suggestion);
    suggestion.schedule = { kind: 'exact', localTime: '19:00', source: 'user' };
    suggestion.durationProvenance = 'user_owned';
    suggestion.priority = 'must_go';
    proposal.normalizedRequest.constraints.push({
      ...proposal.normalizedRequest.constraints[0]!,
      id: 'constraint:model',
      source: 'model',
    });
    expect(validateAiPlannerModelProposal(proposal).success).toBe(false);

    repairAiPlannerModelProposal(proposal);

    expect(suggestion).toMatchObject({
      durationProvenance: 'ai_estimated',
      priority: 'interested',
      schedule: { dayPart: 'evening', kind: 'day_part' },
    });
    expect(
      proposal.normalizedRequest.constraints.find((entry) => entry.id === 'constraint:model')
        ?.strength,
    ).toBe('flexible');
    const validated = validateAiPlannerModelProposal(proposal);
    expect(validated.success ? [] : validated.issues).toStrictEqual([]);
  });

  test('fills in a commitment the model left out, from its constraint', () => {
    const proposal = expanded();
    const meeting = proposal.normalizedRequest.constraints.find(
      (entry) => entry.kind === 'meeting',
    )!;
    proposal.items = proposal.items.filter((item) => !item.constraintIds.includes(meeting.id));
    const log = new AiPlannerRepairLog();

    repairAiPlannerModelProposal(proposal, log);

    const restored = proposal.items.find((item) => item.constraintIds.includes(meeting.id));
    expect(restored).toMatchObject({
      blockType: 'meeting',
      dayIndex: 1,
      label: meeting.label,
      origin: 'user',
      schedule: { kind: 'exact', localTime: '09:00', source: 'user' },
    });
    expect(log.codes).toContain('hard_constraint_item_added');
    const draft = validateAiPlannerDraft(assembleAiPlanningDraft(proposal, NOW));
    expect(draft.success ? [] : draft.issues).toStrictEqual([]);
  });

  test('puts a commitment the model moved back where the traveller asked', () => {
    const proposal = expanded();
    const meeting = proposal.items.find((item) => item.blockType === 'meeting')!;
    meeting.dayIndex = 2;
    meeting.schedule = { dayPart: 'afternoon', kind: 'day_part' };

    repairAiPlannerModelProposal(proposal);

    expect(meeting).toMatchObject({
      dayIndex: 1,
      schedule: { kind: 'exact', localTime: '09:00', source: 'user' },
    });
  });

  test('settles a missing or contradictory trip length', () => {
    const proposal = expanded();
    proposal.normalizedRequest.datePreference = {
      endDate: '2026-10-02',
      kind: 'exact',
      startDate: '2026-12-30',
    };

    expect(() => repairAiPlannerModelProposal(proposal)).toThrow('itinerary_day_limit_exceeded');

    // Date ordering can be repaired, but an excessive trip must never be shortened.
    expect(proposal.normalizedRequest.datePreference).toStrictEqual({
      endDate: '2026-12-30',
      kind: 'exact',
      startDate: '2026-10-02',
    });

    const flexible = expanded();
    flexible.normalizedRequest.datePreference = { kind: 'missing' };
    flexible.selectedDurationDays = null;
    repairAiPlannerModelProposal(flexible);
    expect(flexible.selectedDurationDays).toBe(3);
  });
});

describe('dayPartForLocalTime', () => {
  test('reads a clock time as the daypart it falls in', () => {
    expect(dayPartForLocalTime('08:00')).toBe('morning');
    expect(dayPartForLocalTime('13:15')).toBe('afternoon');
    expect(dayPartForLocalTime('21:00')).toBe('evening');
    expect(dayPartForLocalTime('later')).toBeNull();
  });
});
