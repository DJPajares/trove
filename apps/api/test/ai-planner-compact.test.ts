import { describe, expect, test } from 'vitest';

import {
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
import { AiPlannerRepairLog } from '../src/services/ai-planner-repair-log.js';
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

  test('clears a broken index instead of discarding the plan', () => {
    const compact = compactModelProposal(explicitModelProposal());
    compact.items[0]!.constraintIndices = [99];
    compact.items[0]!.candidatePlaceIndex = 42;
    const proposal = expandAiPlannerProposal(compact, 'Tokyo');
    expect(proposal.items[0]!.constraintIds).toStrictEqual([]);
    expect(proposal.items[0]!.candidatePlaceId).toBeNull();
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
    compact.omittedOptionalDestinations = ['Sapa'];
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
    expect(proposal.assumptions.map((entry) => entry.code)).toContain(
      'optional_destination_omitted',
    );
    expect(validateAiPlannerModelProposal(proposal).success).toBe(true);
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

describe('traveller-named stays', () => {
  function withStays(
    hotels: Array<{ name: string; searchName?: string }>,
    stays: Array<[place: number, firstNight: number, lastNight: number]>,
  ) {
    const compact = compactModelProposal(explicitModelProposal());
    const offset = compact.places.length;
    compact.places.push(
      ...hotels.map((hotel) => ({
        name: hotel.name,
        note: null,
        searchName: hotel.searchName ?? null,
        searchQuery: `${hotel.name} Tokyo`,
      })),
    );
    compact.stays = stays.map(([place, firstNightDayIndex, lastNightDayIndex]) => ({
      candidatePlaceIndex: offset + place,
      firstNightDayIndex,
      lastNightDayIndex,
    }));
    return compact;
  }

  function stayedAt(proposal: ReturnType<typeof expandAiPlannerProposal>) {
    return (proposal.stays ?? []).map((stay) => [
      proposal.places.find((place) => place.id === stay.candidatePlaceId)?.name,
      stay.firstNightDayIndex,
      stay.lastNightDayIndex,
    ]);
  }

  test('keeps a hotel the traveller named, in any script or length of name', () => {
    expect(
      stayedAt(
        expandAiPlannerProposal(
          withStays([{ name: 'Park Hyatt Tokyo' }], [[0, 0, 1]]),
          'Tokyo, October 2 to 4, staying at the Park Hyatt',
        ),
      ),
    ).toStrictEqual([['Park Hyatt Tokyo', 0, 1]]);
    expect(
      stayedAt(
        expandAiPlannerProposal(
          withStays([{ name: 'W Hotel' }], [[0, 0, 1]]),
          'Three days around Tokyo, and we booked the W Hotel',
        ),
      ),
    ).toHaveLength(1);
    expect(
      stayedAt(
        expandAiPlannerProposal(
          withStays(
            [{ name: 'Park Hyatt Tokyo', searchName: 'パーク ハイアット 東京' }],
            [[0, 0, 1]],
          ),
          '10月2日から4日まで東京。パークハイアット東京に泊まります。',
        ),
      ),
    ).toHaveLength(1);
  });

  test('retains recommended lodging unless suggestions are declined', () => {
    const recommended = withStays([{ name: 'Hotel Gracery Shinjuku' }], [[0, 0, 1]]);
    recommended.stays![0]!.source = 'model';
    const suggested = expandAiPlannerProposal(
      recommended,
      'Tokyo for three days, please find us a hotel in Tokyo',
    );
    expect(suggested.stays).toEqual([
      expect.objectContaining({ source: 'model', firstNightDayIndex: 0, lastNightDayIndex: 1 }),
    ]);
    expect(
      expandAiPlannerProposal(
        withStays([{ name: 'Hilton Tokyo' }], [[0, 0, 1]]),
        'Plan Tokyo. Do not recommend hotels.',
      ).stays,
    ).toEqual([]);
    const declined = withStays([{ name: 'Hilton Tokyo' }], [[0, 0, 1]]);
    declined.stays![0]!.source = 'model';
    declined.lodgingRecommendations = 'declined';
    expect(expandAiPlannerProposal(declined, '東京。宿泊施設の提案はいりません。').stays).toEqual(
      [],
    );
  });

  test('retains both named hotels without silently rewriting conflicting dates', () => {
    const proposal = expandAiPlannerProposal(
      withStays(
        [{ name: 'Hoshinoya Tokyo' }, { name: 'Park Hyatt Tokyo' }],
        [
          [0, 1, 1],
          [1, 0, 1],
        ],
      ),
      'Tokyo, first at the Park Hyatt, then Hoshinoya',
    );
    expect(stayedAt(proposal)).toStrictEqual([
      ['Hoshinoya Tokyo', null, null],
      ['Park Hyatt Tokyo', null, null],
    ]);
    expect(proposal.stays?.every((stay) => stay.assignmentIssue === 'dates_conflicting')).toBe(
      true,
    );
  });

  test('a stay is not also a stop, unless the traveller asked for one there', () => {
    const compact = withStays([{ name: 'Park Hyatt Tokyo' }], [[0, 0, 1]]);
    const hotel = compact.places.length - 1;
    const base = compact.items[1]!;
    compact.items.push(
      {
        ...base,
        candidatePlaceIndex: hotel,
        constraintIndices: [],
        dayIndex: 0,
        label: 'Check in at Park Hyatt Tokyo',
        origin: 'model',
        priority: null,
      },
      {
        ...base,
        candidatePlaceIndex: hotel,
        constraintIndices: [],
        dayIndex: 1,
        label: 'Dinner at the New York Grill',
        origin: 'user',
        priority: null,
      },
    );
    const log = new AiPlannerRepairLog();
    const proposal = expandAiPlannerProposal(
      compact,
      'Tokyo, staying at the Park Hyatt, with dinner at its New York Grill',
      log,
    );
    expect(proposal.items.map((item) => item.label)).toContain('Dinner at the New York Grill');
    expect(proposal.items.map((item) => item.label)).not.toContain('Check in at Park Hyatt Tokyo');
    expect(log.counts.stay_item_removed).toBe(1);
  });
});
