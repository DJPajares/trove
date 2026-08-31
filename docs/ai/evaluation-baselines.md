# AI planning evaluation baselines

The suite lives in [`apps/api/test/ai-planning-evaluation.test.ts`](../../apps/api/test/ai-planning-evaluation.test.ts).
Every scenario runs offline against a stubbed model and stubbed providers, so it
costs nothing, reaches neither Vertex nor Google, and gives the same answer on
every machine.

These are the behaviours AI-assisted trip creation is allowed to launch with. A
changed number here is either a deliberate product decision recorded in this file
or a regression.

## Pipeline scenarios

Each runs the full path from model output to reviewed draft.

| Scenario               | Baseline                                                                                                                 | Why this is the right answer                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit details       | 3 days, 0 Custom Places, 0 material warnings, every hard commitment kept at its stated time, `opening_hours_not_checked` | A traveller who supplied dates, party size, and a fixed meeting gets exactly those back. With no Places service configured the draft says hours were not checked rather than implying they were fine. |
| Missing details        | Draft produced, 0 verified places, every place Custom, deterministic date/party/pace defaults disclosed as assumptions   | Missing input is filled by rule, never by the model inventing specifics, and every fill is visible to the traveller.                                                                                  |
| Ambiguous identity     | 0 verified places, `place_ambiguous` warning, no failure                                                                 | Two plausible matches is not a match. The place degrades to an unverified Custom Place instead of Trove guessing which one the traveller meant.                                                       |
| Provider outage        | No draft, `provider_unavailable`, 0 items                                                                                | A failed generation leaves nothing half-planned behind. Manual trip creation stays available throughout.                                                                                              |
| Hours conflict         | Material `outside_opening_hours` warning, hard commitments still kept                                                    | Trove reports the conflict and makes the traveller acknowledge it rather than quietly moving a commitment they made to another person.                                                                |
| Impossible route       | Draft produced with a `route_*` warning, no failure                                                                      | A route the provider cannot return is surfaced, not assumed travellable.                                                                                                                              |
| Injection-shaped input | Outcome identical to the benign prompt in every field except the prompt envelope                                         | The traveller's words are data the model reads. They are not an input to grounding, validation, caps, or authorization, so they cannot change the plan.                                               |

## Contract scenarios

Draft-level rules, evaluated without a model in the loop.

| Scenario                       | Baseline                                                                                | Why                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Multi-destination              | Valid draft spanning multiple days, carrying `activity`, `transport`, and `work` blocks | Work blocks and the train between cities are ordinary itinerary items, not a parallel entity type.               |
| Contradictory hard commitments | Rejected with `conflicting_hard_constraints`                                            | Two commitments that cannot both be honoured are refused deterministically rather than reconciled by preference. |

## Related coverage

These gates are enforced in their own suites rather than duplicated here:

- Cross-user access — `apps/api/test/authorization.test.ts`
- Injection-shaped prompts and malformed model output — `apps/api/test/ai-planning-hardening.test.ts`
- Content-free telemetry and secret handling — `apps/api/test/ai-telemetry-redaction.test.ts`
- Kill switches — `apps/api/test/ai-kill-switch.test.ts`
- Retention windows — `apps/api/test/ai-planning-retention.test.ts`
- Provider spend caps — `apps/api/test/ai-provider-budget.test.ts`
