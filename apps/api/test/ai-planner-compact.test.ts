import { describe, expect, test } from 'vitest';

import {
  AiPlannerCompactReferenceError,
  aiPlannerCompactProposalSchema,
  expandAiPlannerProposal,
} from '../src/services/ai-planner-compact.js';
import {
  assembleAiPlanningDraft,
  assignAiPlannerSuggestedTimes,
} from '../src/services/ai-planning-pipeline.js';
import {
  validateAiPlannerDraft,
  validateAiPlannerModelProposal,
} from '../src/services/ai-planning-rules.js';
import { compactModelProposal, explicitModelProposal } from './fixtures/ai-planning.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');

describe('compact planner contract', () => {
  test('accepts flexible strength and rejects the old soft spelling', () => {
    const compact = compactModelProposal(explicitModelProposal());
    expect(aiPlannerCompactProposalSchema.safeParse(compact).success).toBe(true);
    compact.normalizedRequest.constraints[0]!.strength = 'flexible';
    expect(aiPlannerCompactProposalSchema.safeParse(compact).success).toBe(true);
    expect(
      aiPlannerCompactProposalSchema.safeParse({
        ...compact,
        normalizedRequest: {
          ...compact.normalizedRequest,
          constraints: [{ ...compact.normalizedRequest.constraints[0], strength: 'soft' }],
        },
      }).success,
    ).toBe(false);
  });

  test('rejects a broken index before storing a draft', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.items[0]!.constraintIndices = [99];
    expect(() => expandAiPlannerProposal(compact, 'Tokyo')).toThrowError(
      AiPlannerCompactReferenceError,
    );
  });

  test('a user destination resolves to its locality instead of a same-named venue', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.places[0]!.name = 'Tokyo Representative Office in Singapore';
    compact.places[0]!.searchQuery = 'Tokyo Representative Office in Singapore';
    const proposal = expandAiPlannerProposal(compact, 'Plan Tokyo');
    const destination = proposal.destinations[0]!;
    expect(proposal.places.find((place) => place.id === destination.candidatePlaceId)?.name).toBe(
      'Tokyo',
    );
    expect(destination.destinationIntentId).toBe('intent:0');
  });

  test('splits repeat visits to an undated hard place and keeps their priority', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.normalizedRequest.constraints[1]!.date = null;
    compact.items.push({
      ...compact.items[1]!,
      dayIndex: 2,
      label: 'Tokyo National Museum return visit',
    });
    const proposal = expandAiPlannerProposal(compact, 'Tokyo, October 2 to 4, 2026');
    const linked = proposal.items.filter((item) => item.priority === 'must_go');
    expect(new Set(linked.flatMap((item) => item.constraintIds)).size).toBe(2);
    expect(validateAiPlannerModelProposal(proposal).success).toBe(true);
    const validated = validateAiPlannerDraft(assembleAiPlanningDraft(proposal, NOW));
    expect(validated.success ? [] : validated.issues).toStrictEqual([]);
  });

  test('aligns recurring work to calendar weekdays and separates turnaround from visit duration', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.normalizedRequest.datePreference = {
      kind: 'exact',
      startDate: '2026-11-04',
      endDate: '2026-11-10',
    };
    compact.normalizedRequest.constraints = [
      {
        date: '2026-11-06',
        dayPart: 'morning',
        destinationIntentIndex: 0,
        durationMinutes: 360,
        kind: 'work',
        label: 'Remote work Tuesday',
        localTime: null,
        priority: 'must_go',
        source: 'user',
        strength: 'hard',
      },
      {
        date: '2026-11-08',
        dayPart: 'morning',
        destinationIntentIndex: 0,
        durationMinutes: 360,
        kind: 'work',
        label: 'Remote work Thursday',
        localTime: null,
        priority: 'must_go',
        source: 'user',
        strength: 'hard',
      },
      {
        date: null,
        dayPart: null,
        destinationIntentIndex: 0,
        durationMinutes: null,
        kind: 'activity',
        label: '24-48 hour suit tailoring',
        localTime: null,
        priority: 'must_go',
        source: 'user',
        strength: 'hard',
      },
    ];
    compact.items = [
      {
        ...compact.items[0]!,
        blockType: 'work',
        constraintIndices: [0],
        dayIndex: 2,
        durationMinutes: 360,
        durationProvenance: 'ai_estimated',
        label: 'Remote work session',
        priority: 'must_go',
        schedule: { dayPart: 'morning', kind: 'day_part' },
      },
      {
        ...compact.items[0]!,
        blockType: 'work',
        constraintIndices: [1],
        dayIndex: 4,
        durationMinutes: 360,
        durationProvenance: 'ai_estimated',
        label: 'Remote work session',
        priority: 'must_go',
        schedule: { dayPart: 'morning', kind: 'day_part' },
      },
      {
        ...compact.items[1]!,
        blockType: 'activity',
        constraintIndices: [2],
        dayIndex: 1,
        durationMinutes: 90,
        label: 'Suit fitting',
        priority: 'must_go',
      },
      {
        ...compact.items[1]!,
        blockType: 'activity',
        constraintIndices: [2],
        dayIndex: 3,
        durationMinutes: 60,
        label: 'Suit pickup',
        priority: 'must_go',
      },
      {
        ...compact.items[1]!,
        candidatePlaceIndex: null,
        constraintIndices: [],
        dayIndex: 1,
        durationMinutes: 60,
        label: 'Morning shopping',
        origin: 'model',
        priority: null,
        schedule: { dayPart: 'morning', kind: 'day_part' },
      },
    ];
    const proposal = expandAiPlannerProposal(
      compact,
      'November 4-10: work on Tuesdays and Thursdays; 24-48 hour suit tailoring.',
    );
    const work = proposal.normalizedRequest.constraints.filter((entry) => entry.kind === 'work');
    expect(work.map((entry) => [entry.label, entry.date])).toStrictEqual([
      ['Remote work Tuesday', '2026-11-10'],
      ['Remote work Thursday', '2026-11-05'],
    ]);
    expect(work.every((entry) => entry.durationMinutes === null)).toBe(true);
    expect(
      proposal.normalizedRequest.constraints.filter((entry) => entry.label.startsWith('Suit')),
    ).toHaveLength(2);
    expect(proposal.assumptions.map((entry) => entry.code)).toContain('date_year_inferred');
    const draft = assembleAiPlanningDraft(proposal, NOW);
    expect(draft.unscheduledItems.map((item) => item.label)).toContain('Morning shopping');
    const validated = validateAiPlannerDraft(draft);
    expect(validated.success ? [] : validated.issues).toStrictEqual([]);
  });

  test('discloses an omitted optional destination and keeps night flights coarse', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.omittedOptionalDestinations = ['Sapa'];
    compact.normalizedRequest.constraints[0] = {
      ...compact.normalizedRequest.constraints[0]!,
      kind: 'transport',
      label: 'Flight to Tokyo',
      priority: 'must_go',
      durationMinutes: null,
      localTime: null,
      dayPart: 'evening',
    };
    compact.items[0] = {
      ...compact.items[0]!,
      blockType: 'transport',
      label: 'Flight to Tokyo',
      priority: 'must_go',
      durationProvenance: 'ai_estimated',
      schedule: { dayPart: 'evening', kind: 'day_part' },
    };
    const proposal = expandAiPlannerProposal(
      compact,
      'Tokyo, October 2-4, 2026. If possible, Sapa. My flight is at night.',
    );
    expect(proposal.assumptions.map((entry) => entry.code)).toContain(
      'optional_destination_omitted',
    );
    const day = assembleAiPlanningDraft(proposal, NOW).days[1]!;
    assignAiPlannerSuggestedTimes(day, new Map(), new Map());
    const flight = day.items.find((item) => item.blockType === 'transport');
    expect(flight?.label).toBe('Flight to Tokyo');
    expect(flight?.notes).toContain('flight is at night');
    expect(flight?.schedule).toStrictEqual({ dayPart: 'evening', kind: 'day_part' });
  });
});
