/** Manual HTTP integration check; start postman/simulations/multi-stay.sim.yaml first. */
import assert from 'node:assert/strict';
import { draftDayStay } from '@trove/types';
import { GooglePlacesProvider } from '../src/services/google-places.js';
import { AiPlaceGrounder } from '../src/services/ai-place-grounding.js';
import { ProviderCallBudget } from '../src/services/provider-usage.js';
import { expandAiPlannerProposal } from '../src/services/ai-planner-compact.js';
import {
  assembleAiPlanningDraft,
  applyGroundingToDraft,
} from '../src/services/ai-planning-pipeline.js';
import { groundableDraftPlaceIds } from '../src/services/ai-planning-draft-places.js';
import { compactModelProposal, explicitModelProposal } from '../test/fixtures/ai-planning.js';

const baseUrl = process.env.STAY_SIMULATION_URL ?? 'http://127.0.0.1:4900';
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'Only the local simulation is allowed.');
const clock = () => new Date('2026-09-01T00:00:00Z');
const budget = new ProviderCallBudget();
const provider = (allowance = budget) =>
  new GooglePlacesProvider({
    apiKey: 'synthetic-test-key',
    baseUrl,
    budget: allowance,
    source: 'test',
    fetcher: (url, init) =>
      fetch(url, { ...init, headers: { ...init?.headers, 'x-mock-slug': 'google-places' } }),
  });
const canonical = {
  async resolveProviderPlaceFromIdentity(identity: { externalPlaceId: string }) {
    return { id: `00000000-0000-4000-8000-00000000000${identity.externalPlaceId.at(-1)}` };
  },
};
const makeGrounder = (allowance = budget) =>
  new AiPlaceGrounder(provider(allowance), canonical, clock, null);
const proposal = explicitModelProposal();
const names = ['Example Main Hotel', 'Example Temporary Hotel', 'Example Undated Hotel'];
proposal.places.push(
  ...names.map((name, index) => ({
    id: `stay:${index}`,
    name,
    note: null,
    searchQuery: `${name} Singapore`,
    localityHint: 'Singapore',
  })),
);
proposal.stays = [
  { candidatePlaceId: 'stay:0', firstNightDayIndex: 0, lastNightDayIndex: 0, source: 'user' },
  { candidatePlaceId: 'stay:1', firstNightDayIndex: 1, lastNightDayIndex: 1, source: 'user' },
  { candidatePlaceId: 'stay:2', firstNightDayIndex: null, lastNightDayIndex: null, source: 'user' },
];
const expanded = expandAiPlannerProposal(compactModelProposal(proposal), names.join(', '));
const draft = assembleAiPlanningDraft(expanded, clock());
const stayIds = new Set(draft.stays!.map((stay) => stay.placeRefId));
const targets = expanded.places.filter((place) => stayIds.has(place.id));
assert(targets.every((place) => groundableDraftPlaceIds(draft).has(place.id)));
const grounder = makeGrounder();
const results = await grounder.groundCandidates(
  targets.map((place) => ({ ...place, preferLodging: true })),
);
assert(results.every((result) => result.place.resolution === 'verified'));
applyGroundingToDraft(draft, results);
assert.deepEqual(draft.days.map(draftDayStay), [
  { start: null, end: targets[0]!.id },
  { start: targets[0]!.id, end: targets[1]!.id },
  { start: targets[1]!.id, end: null },
]);
assert.equal(draft.stays!.find((stay) => stay.placeRefId === targets[2]!.id)!.arriveDate, null);
const unavailable = {
  id: 'unavailable',
  name: 'Unavailable Hotel',
  note: null,
  searchQuery: 'Unavailable Hotel Singapore',
  localityHint: 'Singapore',
  preferLodging: true,
};
assert.equal((await makeGrounder().groundCandidate(unavailable)).place.resolution, 'custom');
assert.equal(
  (await makeGrounder(new ProviderCallBudget(0)).groundCandidate(targets[0]!)).place.resolution,
  'custom',
);
console.log(
  'Verified three accommodations over local HTTP, unassigned-stay retention, transfer/checkout endpoints, provider failure, and exhausted allowance.',
);
