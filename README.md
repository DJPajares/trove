# Trove

**Plan it. Live it. Remember it.**

Trove is a personal travel companion for collecting places, planning trips, using those plans while travelling, and preserving the journey afterward.

## Project Status

Trove is currently in the initial implementation phase.

The product definition and implementation workflow are already established. Development is managed through Linear and delivered through GitHub pull requests.

## Source of Truth

- `PRD.md` — approved product requirements and implementation direction
- `AGENTS.md` — AI execution and delivery rules
- `CLAUDE.md` — Claude Code adapter that follows `AGENTS.md`
- Linear — implementation tasks, dependencies, and acceptance criteria

## Planned Stack

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

The actual application structure will be created through the Foundation implementation tasks.

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

## Local Vertex AI configuration

The API's AI gateway uses Vertex AI and Google Application Default Credentials
for local development. Authenticate once with the Google Cloud CLI, then set
`GOOGLE_VERTEX_PROJECT` in the root `.env` file:

```bash
gcloud auth application-default login
pnpm --filter @trove/api ai:verify
```

The verification command makes one bounded structured-output request and prints
only its result classification, model/provider metadata, timing, and token
counts. It never prints the prompt or generated object. Use the optional
`GOOGLE_VERTEX_CLIENT_EMAIL` and `GOOGLE_VERTEX_PRIVATE_KEY` pair only in a
server environment that cannot use ADC; never commit either value.

Set `TROVE_AI_DISABLED=1` for an emergency global stop or
`TROVE_AI_BUDGET_DISABLED=1` to halt provider spend. Both switches prevent the
provider from being constructed or called while manual trip planning remains
available.

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
