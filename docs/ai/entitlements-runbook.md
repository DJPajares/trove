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
`TROVE_AI_PLANNER_STARTS_PER_MINUTE` defaults to five accepted starts per account
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

Keep `TROVE_ADMIN_CREDENTIALS` in API server secrets. Leave it empty to disable
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
command wraps this endpoint; set `TROVE_ADMIN_TOKEN` locally and
`TROVE_ADMIN_API_URL` to the intended API. It no longer edits the database directly.

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
`TROVE_AI_DISABLED=1` and let old in-flight requests finish. Apply the migration,
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
idempotency, reset replay and RLS. Set `TROVE_ENTITLEMENTS_TEST_DATABASE_URL` to
an isolated localhost database whose name contains `entitlements`, with the
repository migrations applied, then run the API tests. It refuses remote URLs.
Browser verification should inspect Free/Paid meters, renewal text, exhaustion
and over-limit errors; avoid billable generation solely to verify display copy.
