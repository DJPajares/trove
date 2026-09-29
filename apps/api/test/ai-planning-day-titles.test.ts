import { describe, expect, test } from 'vitest';
import { finalizeDraftDayTitles } from '../src/services/ai-planning-day-titles.js';
import { draftPlanScoreInputRevision } from '../src/services/ai-planning-plan-score.js';
import {
  compactModelProposal,
  explicitDraft,
  explicitModelProposal,
} from './fixtures/ai-planning.js';
import { expandAiPlannerProposal } from '../src/services/ai-planner-compact.js';

describe('AI day titles', () => {
  test('retains a specific title only when every supporting item survived on the day', () => {
    const draft = explicitDraft();
    const summaries = [
      { dayIndex: 1, name: 'Tokyo National Museum afternoon', itemIds: ['item:museum'] },
    ];
    finalizeDraftDayTitles(draft, summaries);
    expect(draft.days.map((day) => day.name)).toEqual([
      null,
      'Tokyo National Museum afternoon',
      null,
    ]);

    const moved = explicitDraft();
    moved.days[0]!.items.push(moved.days[1]!.items.pop()!);
    finalizeDraftDayTitles(moved, summaries);
    expect(moved.days[1]!.name).toBe('Team meeting');
    expect(moved.days[0]!.name).toBe('Tokyo National Museum');
  });

  test('rejects generic, unsupported, and overlong names without inventing a highlight', () => {
    for (const name of [
      'Day 2',
      'Ultimate Tokyo Adventure',
      'Kyoto temples',
      'Tokyo Museum and Kyoto temples',
      'A'.repeat(81),
    ]) {
      const draft = explicitDraft();
      finalizeDraftDayTitles(draft, [{ dayIndex: 1, name, itemIds: ['item:museum'] }]);
      expect(draft.days[1]!.name).toBe('Tokyo National Museum');
    }
    const work = explicitDraft();
    work.days[1]!.items = [work.days[1]!.items[0]!];
    finalizeDraftDayTitles(work, undefined);
    expect(work.days[1]!.name).toBe('Team meeting');
    expect(work.days[0]!.name).toBeNull();
  });

  test('cosmetic titles do not change the scoring input revision', () => {
    const draft = explicitDraft();
    const before = draftPlanScoreInputRevision(draft);
    finalizeDraftDayTitles(draft, [
      { dayIndex: 1, name: 'Tokyo National Museum afternoon', itemIds: ['item:museum'] },
    ]);
    expect(draftPlanScoreInputRevision(draft)).toBe(before);
  });

  test('compact title references map to stable item IDs; invalid hints fall back', () => {
    const proposal = explicitModelProposal();
    const compact = compactModelProposal(proposal);
    compact.daySummaries = [
      { dayIndex: 1, name: 'Tokyo National Museum afternoon', itemIndices: [0, 99] },
    ];
    const expanded = expandAiPlannerProposal(compact, 'Tokyo itinerary');
    expect(expanded.daySummaries?.[0]?.itemIds).toContain('item:missing:99');
  });
});
