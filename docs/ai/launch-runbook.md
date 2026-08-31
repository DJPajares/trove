# AI-assisted trip creation: launch runbook

The gates that are code are enforced by tests and named below. The gates that
are operations are the checklists in this document, and they need a human with
access to Google Cloud, Vercel, and the log drain.

Nothing here launches the feature on its own. The last section is the only step
that changes what travellers see.

## 1. Production Vertex credentials

1. In Google Cloud, create a service account dedicated to Trove production with
   the narrowest role that can call Vertex AI (`roles/aiplatform.user`). Do not
   reuse the development account.
2. Create a JSON key, then set on the `trove-api` Vercel project, Production
   scope only:
   - `GOOGLE_VERTEX_PROJECT`
   - `GOOGLE_VERTEX_LOCATION`
   - `GOOGLE_VERTEX_CLIENT_EMAIL`
   - `GOOGLE_VERTEX_PRIVATE_KEY` (escaped `\n` is accepted)
   - `TROVE_AI_MODEL`, `TROVE_AI_TIMEOUT_MS`, `TROVE_AI_MAX_OUTPUT_TOKENS`
3. Set a Google Cloud **budget with alerts** on the project before the first
   production generation, not after.
4. Confirm no development or trial credential is present in Production, and that
   none of these names appears on the `trove` web project. `apps/api/test/ai-telemetry-redaction.test.ts`
   enforces the source-level half of this; the Vercel dashboard is the other half.

## 2. Retention

`apps/api/vercel.json` schedules `GET /maintenance/ai-planning-retention` daily
at 03:00 UTC. The route authenticates with `CRON_SECRET` and **refuses every
caller when that variable is unset**, so retention silently stops if it is
missing.

1. Set `CRON_SECRET` on `trove-api` (Production, and Preview if you want the job
   exercised there).
2. After the first scheduled run, confirm the log line `ai planning retention`
   with its three counts.
3. Windows enforced: 7-day session content, 30-day generation runs. Both are
   pinned in `apps/api/test/ai-planning-retention.test.ts`.

## 3. Dashboards

Every panel below reads a field the API already emits. Two structured log
sources feed them, both content-free by construction:

| Log message               | Emitted by                   | Fields                                                                                                                                                                                          |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai generation`           | `ai-generation-telemetry.ts` | `provider`, `model`, `result`, `errorCode`, `latencyMs`, `inputTokens`, `outputTokens`, `totalTokens`                                                                                           |
| `ai planning`             | `ai-planning-telemetry.ts`   | `kind`, plus per kind: `code`; or `days`/`items`/`realPlaceItems`/`verifiedPlaces`/`customPlaces`/`unverifiedPlaces`/`unscheduledItems`/`materialWarnings`/`warningCounts`; or `outcome`/`code` |
| `google provider request` | `provider-usage.ts`          | source, SKU, and cache disposition per outbound Google call                                                                                                                                     |

Build:

1. **Model spend and volume** — count and token sums from `ai generation`, split
   by `model`.
2. **Latency** — p50/p95 of `ai generation.latencyMs`.
3. **Failure classes** — `ai generation` where `result != succeeded`, split by
   `errorCode`.
4. **Quota and kill-switch pressure** — `ai planning` where
   `kind = dispatch_rejected`, split by `code`.
5. **Google spend attributable to the planner** — `google provider request`
   filtered to sources `ai-planner` and `ai-planner-review`, split by SKU.
6. **Grounding quality** — ratio of `customPlaces` to `verifiedPlaces` from
   `kind = draft_assembled`, and the `warningCounts` breakdown.
7. **Apply integrity** — `kind = apply_completed` split by `outcome`; `replayed`
   is the idempotency path and is healthy, `rejected` split by `code` is not.
8. **Cleanup health** — presence and counts of the daily
   `ai planning retention` line.

## 4. Alerts

| Alert              | Condition                                                                       | First response                                                                                       |
| ------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Provider failing   | `errorCode` in `provider_unavailable`/`timeout` above baseline over 15 min      | Check Vertex status; if sustained, set `TROVE_AI_DISABLED=1`                                         |
| Latency regression | p95 `latencyMs` above the agreed ceiling over 15 min                            | Check model and region; consider a smaller model                                                     |
| Model spend        | Google Cloud budget threshold crossed                                           | Set `TROVE_AI_BUDGET_DISABLED=1`                                                                     |
| Google spend       | planner-sourced `google provider request` volume above the agreed daily ceiling | Set `TROVE_GOOGLE_PROVIDERS_DISABLED=1`; the planner degrades to Custom Places                       |
| Cap violations     | `warningCounts.provider_cap_reached` rising                                     | Investigate fan-out before raising any cap                                                           |
| Cleanup failure    | No `ai planning retention` line in 26 h                                         | Check `CRON_SECRET` and the cron run in Vercel                                                       |
| Apply integrity    | `kind = apply_completed, outcome = rejected` above baseline                     | Read the `code` split; `draft_conflict` and `warnings_not_acknowledged` are expected, others are not |

## 5. Kill-switch drill

Run this **before** launch, on Production, and confirm each step:

1. Set `TROVE_AI_DISABLED=1` on `trove-api` and redeploy.
2. Composer reports AI unavailable; **manual trip creation still works**;
   **editing an existing trip still works**.
3. Confirm `ai planning` `dispatch_rejected` with `code = ai_disabled`.
4. Unset it, redeploy, confirm generation works again.
5. Repeat steps 1-4 with `TROVE_AI_BUDGET_DISABLED=1` and
   `code = ai_budget_disabled`.

That the switches cannot reach anything but AI is enforced in
`apps/api/test/ai-kill-switch.test.ts`: exactly one module may read them.

## 6. Browser validation

Record the result of the pass described in
[`docs/ai/browser-validation.md`](browser-validation.md) at both mobile and
desktop widths.

## 7. Launch

Only after 1-6 pass:

1. Confirm both kill switches are unset and both were proven working in step 5.
2. Confirm the Google Cloud budget alert is active.
3. Enable the feature for all signed-in users.
4. Watch the dashboards in section 3 for the first day.

Rollback is `TROVE_AI_DISABLED=1`. It leaves manual trip creation and all
existing trip editing untouched.
