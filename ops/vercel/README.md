# Vercel deployment setup

Trove deploys as two Vercel projects connected to the same GitHub repository:

| Project     | Root directory | Purpose                 |
| ----------- | -------------- | ----------------------- |
| `trove`     | `apps/web`     | Next.js web application |
| `trove-api` | `apps/api`     | Fastify API             |

Use the `wonderBots` Vercel team and Git integration. The `main` branch deploys to production; pull requests receive preview deployments. Do not configure GitHub auto-merge or bypass deployment protections.

## Web environment variables

Set these in `trove` for Preview and Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_API_URL`
- `AUTH_RECOVERY_SECRET` — server-only recovery receipt signing key; preserve
  separate Preview and Production values.
- `SIGN_UP_DISABLED` and `PLAN_SCORE_DISABLED` — server-only feature switches.
  Keep Plan Score's setting aligned with the API project.

`NEXT_PUBLIC_API_URL` must point to the production API domain (`https://api.trove.wndrhive.com`). This variable belongs to the `trove` web project; it is not consumed by `trove-api`. Values using `NEXT_PUBLIC_` are intentionally browser-visible and must not contain secrets.

## API environment variables

Set these in `trove-api` for Preview and Production:

- `DATABASE_URL` — Supavisor transaction-pooler URL with `schema=trove`.
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` — API-only key with broad Storage access, used only for
  retryable removal of private trip covers, Memory photos, and reservation
  documents after a trip is deleted. Never configure it on the web project.
- `WEB_ORIGINS` — comma-separated web origins allowed to call the API. Include
  `https://trove.wndrhive.com` and the narrowly scoped
  preview pattern `https://trove-git-*-djpajares-projects.vercel.app`.
- `AI_PROVIDER` — `vertex`.
- `AI_MODEL` — the approved Vertex model identifier.
- `AI_THINKING_LEVEL` — `low`, `medium` (default), or `high` for Gemini 3.8 Flash.
- `AI_TIMEOUT_MS` and `AI_MAX_OUTPUT_TOKENS` — bounded request limits (defaults `120000` and `16384`).
- `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`.
- `GOOGLE_VERTEX_CLIENT_EMAIL` and `GOOGLE_VERTEX_PRIVATE_KEY` — server-only
  service-account credentials; set both or neither. Preserve private-key
  newlines (escaped `\\n` values are accepted).
- `AI_DISABLED` and `AI_BUDGET_DISABLED` — leave unset normally;
  set either to `1` to stop all AI provider construction and requests.
- `AI_PLANNER_STARTS_PER_MINUTE` — operational burst guard, independent of
  code-defined subscription credits.
- `GOOGLE_PROVIDERS_DISABLED`, `PLAN_SCORE_DISABLED`, and
  `EDITORIAL_IMAGES_DISABLED` — independent provider/feature kill switches.
- `EDITORIAL_IMAGE_HOURLY_BUDGET` — optional editorial-provider request ceiling.
- `ADMIN_CREDENTIALS` — optional scoped operator credential registry; leave unset
  to keep admin operations disabled. See the
  [entitlement runbook](../../docs/ai/entitlements-runbook.md).
- `CRON_SECRET` — shared secret for scheduled maintenance. Vercel Cron presents
  it as `Authorization: Bearer <value>` to
  `/maintenance/ai-planning-retention` (daily at 03:00 UTC) and
  `/maintenance/trip-media-cleanup` (daily at 03:10 UTC). The latter reports
  attempted, removed, pending, and oldest-pending-age counts without file paths.
  Both routes refuse callers while the secret is unset. Cron schedules are not
  exact execution-time guarantees.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
  `VAPID_SUBJECT` — API-only Web Push credentials. The public key is
  returned by an authenticated API endpoint; the private key stays on the API.
- `NOTIFICATION_DISPATCH_SECRET` — separate secret for Supabase Cron's
  one-minute `POST /maintenance/notification-dispatch`. Do not reuse
  `CRON_SECRET` or expose it to the web project. See
  [`docs/notifications/dispatch-runbook.md`](../../docs/notifications/dispatch-runbook.md).

Before launching AI-assisted trip creation to signed-in users, work through
[`docs/ai/launch-runbook.md`](../../docs/ai/launch-runbook.md): production Vertex
credentials and budget, the retention secret, dashboards, alerts, the kill-switch
drill, and the browser pass.

Do not add `SHADOW_DATABASE_URL` to Vercel. It is reserved for isolated migration development and must never point at the shared database.
`DIRECT_URL` is likewise only for Prisma commands and is not required by the deployed API.
AI credentials belong only to `trove-api`; never add them to the web project or
prefix them with `NEXT_PUBLIC_`. The gateway logs only content-free generation
metadata and never logs prompts, generated objects, credentials, or raw provider
responses.

## Environment-name cutover

Application environment names no longer include the `TROVE_` prefix. Remove
only that segment when migrating existing keys; retain `NEXT_PUBLIC_` on the
browser-visible API URL. Defaults, parsing, and scopes are unchanged, and the
updated code does not read legacy names. Editable entries retain their values.
The approved Sensitive-entry replacements below are the only value changes.

1. Update code and rename local dotenv keys together. Preserve values, quoting,
   multiline secrets, and existing file precedence. Restart local API/web
   processes so they load the renamed keys.
2. Validate locally before changing hosted settings. Inspect each project's
   keys and reject destination-name collisions. Rename editable Vercel entries
   in place by ID, sending only the new key, so values, types, environment
   targets, and branch/custom-environment scopes remain intact. Vercel rejects
   key changes for entries marked Sensitive. Create replacements with the exact
   values from their secure source when available, preserving Sensitive type
   and scope. If the originals are unavailable, obtain explicit approval for
   replacement values before proceeding. For this cutover, the owner approved
   independent 256-bit `AUTH_RECOVERY_SECRET` replacements for Preview and
   Production on `trove`, plus a `WEB_ORIGINS` replacement for API
   Preview/Production containing exactly
   `https://trove.wndrhive.com,https://trove-git-*-djpajares-projects.vercel.app`.
   Keep the old Sensitive entries until replacements are verified, then remove
   them. Correct stale configuration comments without changing their values.
3. Verify hosted key names and scopes without exposing values, then push the
   updated task branch for its Git-triggered preview. Subsequent builds must
   use the updated code. Keep older branches from rebuilding during the
   cutover; coordinate the reviewed merge and production release with a human.
   Settings changes affect subsequent deployments, not running deployments.
4. Rebuild the web project to inline `NEXT_PUBLIC_API_URL`, and rebuild the API
   with its renamed settings during the approved release. Verify authenticated
   requests, allowance display, recovery configuration, and feature switches.

For rollback, reuse a previous deployment with its original configuration.
Before rebuilding older code, restore its expected environment names and
configuration first; do not rebuild an older revision with only the new keys.
Unavailable Sensitive values cannot be reconstructed, so reuse the existing
previous deployment rather than rebuilding it. Never copy credentials into a
PR, command argument, build log, or public variable.

Recovery-key rotation takes effect when the updated web deployment is released.
Receipts signed with the old key then fail verification, including any recovery
flow started within the previous one-hour receipt window. Those users must
request a fresh recovery link. This does not rotate Supabase credentials or
normal session tokens. Local development keeps its independent signing key.

`ENVIRONMENT=production` remains a separate safety confirmation for local
production-operation scripts, not a replacement for `NODE_ENV`. Keep
`POSTGRES_PORT` in Docker configuration, `SEED_USER_ID` in the seed environment,
`ENTITLEMENTS_TEST_DATABASE_URL` in isolated tests, and `ADMIN_API_URL` /
`ADMIN_TOKEN` in operator tooling. These are not browser configuration.
Supabase Vault identifiers and application/database resource names are not
environment keys and retain their existing names.

## Supabase Auth URLs

In Supabase Auth URL Configuration, preserve all existing entries and add:

- `https://trove.wndrhive.com/auth/callback`
- `https://*-djpajares-projects.vercel.app/**`

Set the production Site URL to `https://trove.wndrhive.com`. Do not add API URLs as Auth callback URLs.
