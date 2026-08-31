# Trove

**Plan it. Live it. Remember it.**

Trove is a personal travel companion for collecting places, planning trips, using those plans while travelling, and preserving the journey afterward.

## Project Status

Trove is in active implementation, with AI-assisted itinerary planning now part
of the Plan experience alongside manual trip creation.

The product definition and implementation workflow are already established. Development is managed through Linear and delivered through GitHub pull requests.

## Source of Truth

- `PRD.md` — approved product requirements and implementation direction
- `AGENTS.md` — AI execution and delivery rules
- `CLAUDE.md` — Claude Code adapter that follows `AGENTS.md`
- Linear — implementation tasks, dependencies, and acceptance criteria

## Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI
- next-intl
- Serwist

### Backend

- Fastify
- TypeScript
- Prisma
- Vertex AI (AI itinerary planning)

### Platform

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Vercel

### Tooling

- pnpm
- Turborepo

## Planned Repository Structure

```text
trove/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── db/
│   ├── types/
│   └── config/
├── AGENTS.md
├── CLAUDE.md
├── PRD.md
└── README.md
```

The application structure is implemented incrementally through the Foundation
and feature tasks tracked in Linear.

## Development Workflow

1. Select the next unblocked Linear task.
2. Read the task, `AGENTS.md`, and only the relevant `PRD.md` sections.
3. Implement only the approved scope.
4. Run the required validation.
5. Push a feature branch.
6. Open a GitHub Pull Request.
7. Stop for manual review and approval.
8. Merge only after human approval.
9. Continue with the next unblocked Linear task.

## Pull Request Quality Gates

Every pull request runs the root validation commands through GitHub Actions:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

These checks intentionally do not include unit-test or E2E jobs during the initial implementation phase. PR summaries should report each command and its result.

## Environment variables

Copy the relevant example file before starting a local service. The examples are
safe templates and contain no credentials:

| Runtime | File | Used by |
| --- | --- | --- |
| API, Prisma, and local shared services | [`.env.example`](.env.example) → `.env` | `apps/api` and `packages/db` |
| Next.js browser app | [`apps/web/.env.example`](apps/web/.env.example) → `apps/web/.env.local` | `apps/web` |
| Production database operations | [`.env.production.example`](.env.production.example) → `.env.production` | `pnpm db:migrate:prod` and production reconciliation |
| Local Docker PostgreSQL | [`docker/local.env.example`](docker/local.env.example) → `docker/local.env` | Prisma commands against Docker |

The API loads the repository-root `.env`. Next.js values belong in
`apps/web/.env.local`; do not assume a root value is available to the browser.
After changing environment variables, restart the affected dev server.

### Supabase

Create or select the project in the [Supabase Dashboard](https://supabase.com/dashboard),
then open the project's **Connect** dialog. The same values are also available
under **Project Settings → API Keys** (for API keys) and **Project Settings →
Database** (for connection strings). Supabase's [API key guide](https://supabase.com/docs/guides/getting-started/api-keys)
explains the current publishable/secret key model.

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` go in the root `.env` for the
  server API.
- `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` go in `apps/web/.env.local` for the
  browser. A publishable key is intended to be public; never put a secret or
  legacy `service_role` key in a `NEXT_PUBLIC_` variable.
- Add the local and production `/auth/callback` URLs in **Authentication → URL
  Configuration**. Keep existing entries for other applications; see
  [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).
- Copy the exact database strings from **Connect** rather than constructing
  them. `DATABASE_URL` is the Supavisor transaction pooler URL on port `6543`
  with `pgbouncer=true` for runtime access. `DIRECT_URL` is the session/direct
  URL on port `5432` for Prisma CLI commands. URL-encode special characters in
  passwords and keep `schema=trove` on both values.
- `SHADOW_DATABASE_URL` is only for an isolated `prisma migrate dev` shadow
  database. It must never point at the shared production database. For a fully
  local database, use `docker/local.env` instead.

The `trove` schema is private and is accessed through the server-side Prisma
client. Do not expose it through Supabase's Data API or add client grants.
For private Storage bucket and policy setup, see
[`ops/supabase/README.md`](ops/supabase/README.md).

### AI planning (Vertex AI)

AI planning runs only in the API. Set these values in the root `.env` or in the
API deployment's environment, never in `apps/web/.env.local`:

- `GOOGLE_VERTEX_PROJECT` is the Google Cloud project ID. Find it in the
  [Google Cloud project selector](https://console.cloud.google.com/projectselector/home/dashboard)
  or the Vertex AI console.
- `GOOGLE_VERTEX_LOCATION` is the Vertex AI region. `global` is the default in
  the example file; use a supported region for the selected model.
- `TROVE_AI_PROVIDER` remains `vertex`. `TROVE_AI_MODEL` is the approved model
  identifier from [Vertex AI Model Garden](https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models);
  keep the example default unless the task explicitly approves a change.
- `TROVE_AI_TIMEOUT_MS` and `TROVE_AI_MAX_OUTPUT_TOKENS` are bounded request
  limits. Adjust them only when the provider configuration and task require it.
- For local development, prefer [Google Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc):

  ```bash
  gcloud auth application-default login
  pnpm --filter @trove/api ai:verify
  ```

- For a server that cannot use ADC, obtain a dedicated service account from
  **Google Cloud Console → IAM & Admin → Service Accounts**, create a key under
  **Keys**, and set both `GOOGLE_VERTEX_CLIENT_EMAIL` and
  `GOOGLE_VERTEX_PRIVATE_KEY`. Preserve escaped newlines in the private key and
  never commit it.
- `TROVE_AI_DISABLED=1` is the emergency global AI stop. Use
  `TROVE_AI_BUDGET_DISABLED=1` when provider spend must be halted without
  changing the rest of the app.

### Google Maps Platform and Places

Create separate restricted keys in [Google Cloud Console → APIs & Services →
Credentials](https://console.cloud.google.com/apis/credentials), and enable the
APIs named in the example comments:

- `GOOGLE_PLACES_API_KEY` and `GOOGLE_ROUTES_API_KEY` are server-only keys for
  the API. Restrict each key to its API and the deployed API's server egress.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a separate browser key restricted by HTTP
  referrer and limited to Maps JavaScript API. It belongs in
  `apps/web/.env.local`.
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` comes from [Google Maps Platform → Map
  Management](https://console.cloud.google.com/google/maps-apis/studio/maps),
  where the JavaScript vector map ID is created. It is safe to expose with the
  browser key.

Set `TROVE_GOOGLE_PROVIDERS_DISABLED=1` in the API environment to stop outbound
Places and Routes requests while keeping manual planning available.

### Editorial imagery

Create `PEXELS_API_KEY` in the [Pexels API dashboard](https://www.pexels.com/api/)
and keep it server-only in the root `.env` or API deployment. It is used for
decorative editorial imagery, not Google Places data. Use
`TROVE_EDITORIAL_IMAGES_DISABLED=1` for an emergency stop or set
`TROVE_EDITORIAL_IMAGE_HOURLY_BUDGET` to a lower request ceiling.

### App and deployment values

- In Vercel, set deployment values under **Project Settings → Environment
  Variables**. Configure browser values on `trove` and server values on
  `trove-api`; choose Preview and Production explicitly rather than sharing a
  secret with the web project. See [`ops/vercel/README.md`](ops/vercel/README.md)
  for the deployment-specific list.
- `NEXT_PUBLIC_TROVE_API_URL` belongs in `apps/web/.env.local`. Use
  `http://localhost:3001` locally; for a deployment, copy the public API URL
  from the `trove-api` Vercel project. `NEXT_PUBLIC_` values are bundled into
  the browser and must not contain secrets.
- `TROVE_WEB_ORIGINS` belongs in the API environment and is a comma-separated
  allow list of web origins, including the local origin and the deployed web
  origin.
- `TROVE_ENVIRONMENT=production` belongs only in the gitignored
  `.env.production` used by production database operations.
- `TROVE_PLAN_SCORE_DISABLED=1` is the server-side Plan Score kill switch. Keep
  the API and web values aligned when disabling that feature.
- The API `PORT` is optional and defaults to `3001`.

Never commit `.env`, `.env.local`, `.env.production`, or any provider key. If a
secret is exposed, revoke or rotate it in the provider dashboard immediately.

## Authentication Configuration

Trove uses the existing Supabase Auth user pool with email/password as its initial sign-in method. Enable the Email provider, keep existing Auth redirect URLs for other applications, then add Trove's local and production `/auth/callback` URLs to the Supabase Auth allow list. Configure the environment values in [`.env.example`](.env.example) and [`apps/web/.env.example`](apps/web/.env.example); do not commit credentials.

Prepared offline trip data is reserved for the last authenticated Trove user on that device. Offline access never authorizes server operations. Future offline storage must register a local-data clearer with `signOutFromTrove`, and Settings must warn about unsynced changes before invoking it.

## Local PostgreSQL with Docker

For local Prisma and API development, start the repository's PostgreSQL container and load the local connection values before running database commands:

```bash
docker compose up -d postgres
cp docker/local.env.example docker/local.env
set -a; source docker/local.env; set +a
pnpm --filter @trove/db db:migrate:deploy
```

The database is available at `localhost:54329`. See [`packages/db/README.md`](packages/db/README.md) for health checks, shadow database setup, and reset behavior. This container provides PostgreSQL only; hosted Supabase remains the Auth, Storage, and production platform.

## Verify local Vertex AI

The API's AI gateway uses Vertex AI and Google Application Default Credentials
for local development. Follow the [AI planning environment guide](#ai-planning-vertex-ai),
authenticate once with the Google Cloud CLI, then run:

```bash
gcloud auth application-default login
pnpm --filter @trove/api ai:verify
```

The verification command makes one bounded structured-output request and prints
only its result classification, model/provider metadata, timing, and token
counts. It never prints the prompt or generated object.

## Production Database Migrations

Copy `.env.production.example` to the gitignored `.env.production` and fill in
the exact connection strings from Supabase Dashboard > Connect. Prisma uses
`DIRECT_URL` on port `5432`; runtime database access uses `DATABASE_URL` on port
`6543` with `pgbouncer=true`. Keep `TROVE_ENVIRONMENT="production"` in that file.

Deploy committed migrations after validating the production target:

```bash
pnpm db:migrate:prod
```

Never commit credentials or place a production connection string in shell history.

## Editorial Image Reconciliation

Editorial image maintenance is an operator utility, separate from trip and
itinerary requests. Its default mode only reports outdated image collections:

```bash
pnpm editorial-images:reconcile
pnpm editorial-images:reconcile:prod
```

Add `--apply` to invalidate selected collections without calling Pexels, or
explicitly add `--refresh --apply` for serial, paced, capped active refresh:

```bash
pnpm editorial-images:reconcile -- --apply
pnpm editorial-images:reconcile:prod -- --refresh --apply --limit 5
pnpm editorial-images:reconcile -- --help
```

Use `--category`, `--place-id`, `--cursor`, or `--all` to narrow or resume a run.
Production reconciliation loads `.env.production`; active refresh also requires
`PEXELS_API_KEY` in that file.

## PWA Foundation

Trove registers its Serwist service worker only in production. It precaches the static application shell and the `~offline` fallback page; it does not cache Trip Mode, maps, API responses, or queued travel data. During `next dev`, Trove removes a prior Trove service-worker registration and its `trove-pwa-*` caches for the current origin to avoid stale-cache confusion.

## Delivery Order

1. Foundation
2. Plan
3. Travel
4. Supporting
5. Polish
6. Plan Score
7. Memories

Plan Score and Memories are intentionally implemented late, after the core planning and travel flows are stable.

## Current Phase

**Foundation**

Implementation begins with the accepted Foundation tasks in the Trove Linear project.

## Repository

https://github.com/DJPajares/trove
