# AI Planner entitlements and operator operations

The API owns plan assignments, allowances, reservations and settlement. Browser
limits are advisory. No subscription or payment provider is involved yet.

## Configuration

Product plans are defined in the readonly, type-checked `SUBSCRIPTION_PLANS`
registry in `apps/api/src/services/plan-entitlements.ts`. They are grouped by
feature and independent of subscription and AI providers. Changing them requires
an API deployment; the former Free/Paid tier environment variables are ignored
and should be removed from deployment settings.

| Plan | AI Planner credits | Maximum itinerary days | Renewal  |
| ---- | ------------------ | ---------------------- | -------- |
| Free | 10                 | 10                     | Lifetime |
| Paid | 50                 | 20                     | Monthly  |

`resolveUserEntitlements` is the central server-side boundary for subscription
assignment and applicable plan definitions. Plan definitions currently require no
database queries. `UserEntitlement` stores the assigned plan, `active`/`inactive`
subscription status and renewal anchor in Supabase PostgreSQL. Existing and new
assignments default to active. Inactive assignments use Free entitlements and the
account's existing Free lifetime balance, while retaining their assigned plan,
Paid usage and monthly anchor. Unknown plans or statuses fail closed. The API
reports the effective tier; its response fields are unchanged. Subscription
status is internal; no status-management endpoint is introduced.

Operational settings remain API environment variables. In particular,
`AI_PLANNER_STARTS_PER_MINUTE` defaults to five accepted starts per account
per minute across API instances and accepts integers from 1–1,000. Kill switches,
provider settings and credentials remain environment-owned.

Allowance and renewal boundaries are snapshotted at allocation. Plan changes
apply to new periods or explicit resets, not previously granted balances. Day
limits apply to new dispatches; completed drafts retain their run limit. Changing
renewal policy is an operational migration decision: existing period snapshots
stay intact, and new boundary allocations use the new policy. Mutable assignments
and balances are resolved under the existing owner transaction lock rather than
cached across requests; frontend availability caching remains advisory.

Paid activation establishes a stable UTC monthly anchor. January 31 renews on
February 28/29, then March 31 at the same UTC time. A later Paid reassignment
retains that anchor and any current-period balance. Missed months are skipped;
unused credits do not roll over. Returning to Free retains its existing lifetime
usage. Plan assignment activates the assigned plan without resetting its balance.
Assigning the same active tier is an audited no-op, never a reset. Reactivation
retains the existing monthly anchor and current-period Paid balance. Resets act
on the effective tier, so an inactive Paid assignment resets only Free usage.
Audit records retain the assigned plan and subscription status before each
operation alongside the existing effective entitlement snapshot.

## Operator credentials

Keep `ADMIN_CREDENTIALS` in API server secrets. Leave it empty to disable
admin operations. Each operator gets an independently revocable credential:

```json
[
  {
    "id": "support-alice-1",
    "actorId": "support:alice",
    "sha256": "<64 lowercase hex characters>",
    "expiresAt": "2026-12-01T00:00:00Z",
    "scopes": ["ai_planner:reset", "entitlements:write"]
  }
]
```

Generate a token locally with Node and store it in an operator password manager:

```js
const { randomBytes, createHash } = require('node:crypto');
const token = `support-alice-1.${randomBytes(32).toString('base64url')}`;
console.log({ token, sha256: createHash('sha256').update(token).digest('hex') });
```

The server receives only the full token's SHA-256 digest. Send the token in the
Authorization header over HTTPS, never a URL/query parameter. Grant only the
required scopes; use a short expiration and separate credentials for each
environment. Rotate by issuing a new credential ID and removing the old entry.
Never place credentials in frontend variables, source control, tickets or logs.
Normal Supabase user JWTs and `CRON_SECRET` are not accepted. Authorization
headers are redacted by the API logger.

## Postman operations

Reset one user's current allocation:

```http
POST /admin/users/<profile-uuid>/ai-planner/reset
Authorization: Bearer <operator-token>
Idempotency-Key: <new-uuid>
Content-Type: application/json

{"reason":"Support case 123: restore test allowance"}
```

Assign a tier for testing or support:

```http
PUT /admin/users/<profile-uuid>/plan
Authorization: Bearer <operator-token>
Idempotency-Key: <new-uuid>
Content-Type: application/json

{"planKey":"paid","reason":"Support case 123: test monthly entitlement"}
```

Reset requires `ai_planner:reset`; assignment requires `entitlements:write`.
Targets must be existing profile UUIDs. Bodies reject unknown fields, and reasons
must contain 1–500 nonblank characters. No bulk reset exists. Routes are also
rate limited. Successful responses contain `auditId`, `changed`, and the complete
entitlement snapshot (tier, allowance, used/reserved/available, period, next
renewal, and day limit).

Reuse the same key and body when retrying an uncertain response: it returns the
original result without repeating the operation. Reusing a key for a changed
target/body returns 409. The audit records operator, credential ID, target,
reason, request ID, timestamp, previous snapshot and result. Keep reasons free
of prompt/trip content. An active generation returns `ai_generation_active`
(409); wait for completion or cancel it before retrying. Missing configuration
returns 503, invalid/expired credentials 401, insufficient scope 403, malformed
input 400, and unknown users 404.

A reset restores the configured allowance using a new allocation sequence,
preserves the current renewal date, and retains prior periods/actions/events.
It does not delete telemetry, trip content, or durable idempotency records.
The existing `pnpm ai:reset-quota <uuid> "<reason>"`
command wraps this endpoint; set `ADMIN_TOKEN` locally and
`ADMIN_API_URL` to the intended API. It no longer edits the database directly.

## Beginner walkthrough: one user or all users

These are dummy examples, not real user IDs or credentials. Replace them before
sending requests. Creating or reading this guide does not execute a reset.

Choose what “reset” means:

| Goal                                       | Operation                 | Result                                                      |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------- |
| Restore credits, keep the user's plan      | Reset endpoint            | Free receives 10 available credits; active Paid receives 50 |
| Move a user to Free or Paid                | Assign endpoint           | Activates the chosen plan and keeps its existing balance    |
| Move a user to Free with a fresh allowance | Assign `free`, then reset | Active Free with 10 available credits and a 10-day limit    |

Resetting does not restart a Paid billing month, delete trips, erase usage
history, or change subscription status. Inactive Paid users have effective Free
entitlements, so resetting them restores Free credits only. To reactivate Paid,
assign `paid` first; reset separately if a fresh Paid allowance is intended.

### Set up Postman once

1. Obtain an operator token using **Operator credentials** above. For credit
   resets it needs `ai_planner:reset`; changing plans also needs
   `entitlements:write`. Put the credential's hash/configuration in API-only
   `ADMIN_CREDENTIALS`, then restart locally or use the approved deployment
   process. A normal user's login token will not work.
2. Create a private Postman environment with `baseUrl` set to the intended API
   (`http://localhost:3001` locally, HTTPS otherwise) and `adminToken` set to the
   operator token. Keep the token local/private; omit it from exports.
3. Find the target in `trove.profiles` using trusted database access. Use its
   `id`, not an email, trip ID, or credential ID. Accounts without an entitlement
   row are still valid targets: their Free assignment is created lazily.
4. Generate a UUID for each new operation and save it before sending:
   `node -p "require('node:crypto').randomUUID()"`. Reuse that UUID and the exact
   target/body for retries. Do not use `{{$guid}}` in the header: it changes on
   retries. Assignment and reset must have different keys.

### Example A: restore one user's credits

Set these Postman environment variables:

```text
userId = 11111111-1111-4111-8111-111111111111
resetKey = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
reason = Sandbox walkthrough: restore allowance
```

Save a request named **Reset AI credits** with method **POST**:

```http
{{baseUrl}}/admin/users/{{userId}}/ai-planner/reset
Authorization: Bearer {{adminToken}}
Idempotency-Key: {{resetKey}}
Content-Type: application/json
```

Choose **Body → raw → JSON**:

```json
{ "reason": "{{reason}}" }
```

Send once. A successful Free reset returns HTTP 200, an `auditId`,
`changed: true`, and an `entitlements` object with `tier: "free"`,
`allowance: 10`, `usedCredits: 0`, `reservedCredits: 0`,
`availableCredits: 10`, and `maxItineraryDays: 10`. Free has no next renewal;
Paid keeps its current renewal boundary. Keep the audit ID with the support
record. Refresh/reopen the planner once its availability query refetches.

To change this user to Free first, create a separate **PUT** request to
`{{baseUrl}}/admin/users/{{userId}}/plan`, using the same Authorization and
Content-Type headers but a different saved UUID as `Idempotency-Key`. Send
`{"planKey":"free","reason":"Sandbox walkthrough: restore Free plan"}`.
Only after HTTP 200 should you send the reset. Use `"paid"` instead to activate
Paid (50 credits, 20-day limit, monthly renewal). Assignment by itself does not
replenish previously used credits. A same-active-plan assignment can correctly
return `changed: false`.

### Example B: restore credits for all existing users

There is no `/admin/users/all` operation. “All users” means one audited reset per
profile in a reviewed, fixed list; the batch is not atomic. Users created after
the list is exported are not included. Some users can succeed while others fail.

1. In the intended Supabase project's SQL editor, use this **read-only** query
   to prepare the list. It includes profiles without entitlement rows. Export
   the result to a local CSV and review its project, row count, and targets.
   Never directly update/delete the credit tables to perform a reset.

   ```sql
   SELECT id AS "userId",
          gen_random_uuid() AS "resetKey",
          'Sandbox batch: restore allowance' AS reason
   FROM trove.profiles
   ORDER BY id;
   ```

   A dummy two-user CSV looks like this:

   ```csv
   userId,resetKey,reason
   11111111-1111-4111-8111-111111111111,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,Sandbox batch: restore allowance
   22222222-2222-4222-8222-222222222222,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb,Sandbox batch: restore allowance
   ```

2. Put **only Reset AI credits** in a collection/folder. Test one intended
   sandbox user first, then open a **Functional → Local** collection run. Select
   the correct environment and the local CSV as iteration data. Preview it and
   set iterations to its row count and delay to **7,000 ms**. Data-file columns
   supply `userId`, `resetKey`, and `reason` for each request. Current Postman
   versions require a paid Postman plan for custom data files; if unavailable,
   send each row manually using the same saved keys. See Postman's
   [data-file guide](https://learning.postman.com/docs/tests-and-scripts/running-collections/test-data/working-with-data-files/)
   and [runner settings](https://learning.postman.com/docs/tests-and-scripts/running-collections/intro-to-collection-runs).
3. Run sequentially and review **every HTTP status**, not just whether the run
   completed. Each route is limited to 10 requests/minute; other requests from
   the same source can still cause 429. Save the per-user results/audit IDs and
   reconcile successes against the original row count.
4. Retry failed or uncertain rows using the **same exported keys, bodies, and
   operator actor identity**. Replaying successful rows returns their original
   result without replenishing again. Do not re-export the SQL list for retries:
   it generates new keys and would create new resets.

To move **all users to Free and replenish them**, first run a separate
assignment-only collection over the reviewed list with `planKey: "free"` and a
unique saved assignment key per user. Then reset only the users whose assignment
returned HTTP 200, with their separate reset keys. Resolve failed assignments
before adding those users to the reset batch. Two requests per user are two
separate transactions; this is not a single global rollback-capable operation.

### If a request fails

| HTTP / code                      | Action                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 400                              | Check profile UUID, saved UUID key, and JSON body; reason is required, 1–500 nonblank characters, with no extra fields                    |
| 401 / 403                        | Check operator token, expiry, and the scope for this operation                                                                            |
| 404                              | Verify the profile exists in the same environment as `baseUrl`                                                                            |
| 409 `ai_generation_active`       | Wait for generation to settle, then retry the same request; cancelling a dispatched generation consumes its credit before the later reset |
| 409 `admin_idempotency_conflict` | The key already belongs to a different target/body; inspect the original operation before making a genuinely new request with a new key   |
| 429                              | Wait for the rate limit to clear and retry with the same key                                                                              |
| 503                              | Check API `ADMIN_CREDENTIALS` configuration                                                                                               |
| Timeout / connection error / 5xx | Keep the key; investigate and retry the same request because the first attempt may have committed                                         |

Use a new key only for an intentional new operation. The CLI convenience
command generates a new key on every invocation, so use the saved-key Postman
requests above when retrying an uncertain outcome. Resetting cannot restore the
previous balance automatically: history remains available for audit, but there
is no undo endpoint.

## Migration and verification

For the code-defined plan refactor, apply `20261010053353_subscription_status`
before deploying the updated API. It adds only an active-by-default status column
and its constraint; existing balances, periods, ledger history and RLS remain
unchanged. Remove the obsolete tier variables from deployment configuration after
the refactor is deployed. Subscription status must only be changed through
trusted server-side operations using the existing owner transaction lock;
browser tokens cannot modify it. Provider-driven lifecycle management remains
future work.

Deploy through the normal human-reviewed release process. Before applying
`20261010010000_plan_entitlements`, disable new AI dispatches with
`AI_DISABLED=1` and let old in-flight requests finish. Apply the migration,
deploy the new API/web code, verify configuration, then re-enable generation.
Existing users lazily receive fresh Free credits, without retrospective charges.
Existing valid drafts remain reviewable/applicable under their original 14-day
contract. Do not roll back to an API that bypasses credit enforcement; keep the
kill switch enabled if rollback is necessary.

The five accounting/audit tables have RLS enabled with no browser policies, and
explicitly revoke privileges from `anon`/`authenticated`. The server connection
must own or have appropriate private-table privileges. Accounting records are
content-free, survive telemetry pruning, and cascade on account deletion.

Availability reconciles overdue reservations on access; scheduled retention
also reconciles them before pruning. A provider/system failure, invalid draft,
timeout or expiry refunds a reservation. Valid completion consumes it, as does
explicit cancellation after dispatch. Cancellation before dispatch is free.
Late and repeated callbacks cannot change a terminal settlement.

Focused tests cover plan rules, preflight, settlement, auth and lifecycle. An
opt-in PostgreSQL test verifies locks, last-credit races, constraints, durable
idempotency, reset replay and RLS. Set `ENTITLEMENTS_TEST_DATABASE_URL` to
an isolated localhost database whose name contains `entitlements`, with the
repository migrations applied, then run the API tests. It refuses remote URLs.
Browser verification should inspect Free/Paid meters, renewal text, exhaustion
and over-limit errors; avoid billable generation solely to verify display copy.
