import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';

import { AiPlanningSessionError } from '../src/services/ai-planning-sessions.js';
import {
  recordAiPlanningApplyCompleted,
  recordAiPlanningDispatchRejected,
  recordAiPlanningDraftAssembled,
  setAiPlanningTelemetrySink,
  summarizeAiPlanningDraft,
  type AiPlanningTelemetryEvent,
} from '../src/services/ai-planning-telemetry.js';
import { assembleAiPlanningDraft } from '../src/services/ai-planning-pipeline.js';
import { explicitModelProposal } from './fixtures/ai-planning.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const NOW = new Date('2026-08-31T12:00:00.000Z');

/**
 * Names that must never leave the API. `TROVE_WEB_ORIGINS` and the rest of the
 * server environment are equally server-only, but these are the ones whose
 * exposure would hand a stranger a billable Vertex project.
 */
const serverOnlyAiSecrets = [
  'GOOGLE_VERTEX_CLIENT_EMAIL',
  'GOOGLE_VERTEX_PRIVATE_KEY',
  'GOOGLE_VERTEX_PROJECT',
];

function sourceFiles(root: string, extensions: string[]): string[] {
  const skip = new Set(['.next', '.turbo', 'dist', 'node_modules']);
  return readdirSync(root).flatMap((entry) => {
    if (skip.has(entry)) return [];
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);
    return extensions.some((extension) => entry.endsWith(extension)) ? [path] : [];
  });
}

function capturePlanningTelemetry(run: () => void) {
  const events: AiPlanningTelemetryEvent[] = [];
  setAiPlanningTelemetrySink((event) => events.push(event));
  try {
    run();
  } finally {
    setAiPlanningTelemetrySink(null);
  }
  return events;
}

test('planner telemetry reports counts and codes, never planned content', () => {
  const proposal = explicitModelProposal();
  const draft = assembleAiPlanningDraft(proposal, NOW);

  const events = capturePlanningTelemetry(() => {
    recordAiPlanningDraftAssembled(draft, NOW);
    recordAiPlanningDispatchRejected('quota_exceeded', NOW);
    recordAiPlanningApplyCompleted('rejected', 'warnings_not_acknowledged', NOW);
  });

  expect(events).toHaveLength(3);

  const serialized = JSON.stringify(events);
  const plannedText = [
    ...draft.places.map((place) => place.name),
    ...draft.days.flatMap((day) => day.items.map((item) => item.label)),
    draft.trip.name,
  ].filter((value) => value.length > 3);

  expect(plannedText.length, 'the draft must actually contain text worth leaking').toBeGreaterThan(
    0,
  );
  for (const text of plannedText) {
    expect(serialized, `planner telemetry leaked ${text}`).not.toContain(text);
  }

  // A count field can only ever hold a number, so the shape itself is the
  // guarantee. Asserting the exact key set makes adding a content-carrying
  // field a failing test rather than a silent widening.
  expect(Object.keys(events[0] ?? {}).sort()).toStrictEqual([
    'customPlaces',
    'days',
    'items',
    'kind',
    'materialWarnings',
    'occurredAt',
    'realPlaceItems',
    'unscheduledItems',
    'unverifiedPlaces',
    'verifiedPlaces',
    'warningCounts',
  ]);
  expect(events[1]).toStrictEqual({
    code: 'quota_exceeded',
    kind: 'dispatch_rejected',
    occurredAt: NOW.toISOString(),
  });
  expect(events[2]).toStrictEqual({
    code: 'warnings_not_acknowledged',
    kind: 'apply_completed',
    occurredAt: NOW.toISOString(),
    outcome: 'rejected',
  });
});

test('an unrecognized warning code degrades to a bucket instead of widening telemetry', () => {
  const proposal = explicitModelProposal();
  const draft = assembleAiPlanningDraft(proposal, NOW);

  const summary = summarizeAiPlanningDraft({
    ...draft,
    warnings: [
      {
        code: 'outside_opening_hours',
        evidenceIds: [],
        id: 'warning:known',
        itemIds: [],
        material: true,
      },
      {
        code: 'a code nobody has added to the telemetry vocabulary yet',
        evidenceIds: [],
        id: 'warning:unknown',
        itemIds: [],
        material: false,
      },
    ],
  });

  expect(summary.warningCounts).toStrictEqual({ other: 1, outside_opening_hours: 1 });
  expect(summary.materialWarnings).toBe(1);
});

test('planning errors carry a code rather than a message a log could leak', () => {
  const error = new AiPlanningSessionError('warnings_not_acknowledged', 409);

  expect(error.message).toBe('warnings_not_acknowledged');
  expect(error.code).toBe('warnings_not_acknowledged');
  expect(error.message, 'a planning error message must be a bare code').toMatch(/^[a-z_]+$/);
});

test('the telemetry sink is a single process-wide boundary that can be removed', () => {
  const sink = vi.fn();
  setAiPlanningTelemetrySink(sink);
  recordAiPlanningDispatchRejected('ai_disabled', NOW);
  setAiPlanningTelemetrySink(null);
  recordAiPlanningDispatchRejected('ai_disabled', NOW);

  expect(sink).toHaveBeenCalledOnce();
});

test('Vertex credentials never reach the web application or a public variable name', () => {
  const webSources = sourceFiles(join(repoRoot, 'apps/web'), ['.ts', '.tsx', '.mjs', '.json']);
  expect(webSources.length, 'the web app must actually have been scanned').toBeGreaterThan(50);

  for (const path of webSources) {
    const contents = readFileSync(path, 'utf8');
    for (const secret of serverOnlyAiSecrets) {
      expect(contents, `${path} references the server-only ${secret}`).not.toContain(secret);
    }
    expect(contents, `${path} imports the API's AI environment`).not.toContain(
      'getAiGenerationEnvironment',
    );
  }

  // A `NEXT_PUBLIC_` prefix is what makes a value browser-visible, so no AI
  // variable may ever carry one - not in source, and not in the examples people
  // copy when setting an environment up.
  const configured = [
    ...sourceFiles(join(repoRoot, 'apps/api/src'), ['.ts']),
    join(repoRoot, '.env.example'),
    join(repoRoot, 'apps/web/.env.example'),
    join(repoRoot, 'README.md'),
    join(repoRoot, 'ops/vercel/README.md'),
  ];
  for (const path of configured) {
    const contents = readFileSync(path, 'utf8');
    expect(contents, `${path} declares a browser-visible AI variable`).not.toMatch(
      /NEXT_PUBLIC_[A-Z_]*(AI|VERTEX)/,
    );
  }
});
