# Trove

**Plan it. Live it. Remember it.**

Trove is a personal travel companion for collecting places, planning trips,
following your itinerary while travelling, and keeping the memories afterward.

## What you can do

- **Plan it:** save places, build day-by-day itineraries manually or with AI,
  organise reservations and tasks, and assess your plans with Plan Score.
- **Live it:** follow your day in Trip Mode, check routes and maps, track expenses,
  and prepare trips for offline access.
- **Remember it:** capture photos, notes, and highlights, rate your experiences,
  and revisit your journey through Memories and Trip Story.

Trove is in active development. [PRD.md](PRD.md) defines the approved product;
Linear tracks implementation and known gaps.

## Get started

You need **Node.js 24+**, the pnpm version pinned in [package.json](package.json),
and access to a development Supabase project for authentication and storage.
Choose a development Supabase database or [local Docker PostgreSQL](packages/db/README.md#local-docker-postgresql).

1. Install dependencies and copy the environment templates, if you do not already
   have local configuration:

   ```bash
   pnpm install --frozen-lockfile
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env.local
   ```

2. Fill in your Supabase and database values in `.env`, and the matching browser
   values in `apps/web/.env.local`. Follow the
   [environment guide](docs/environment.md) for required app values and optional
   provider setup. Keep credentials out of Git.

3. [Prepare your development database](docs/development.md#database-setup), then start:

   ```bash
   pnpm dev
   ```

Open the web app at [localhost:3000](http://localhost:3000). The API runs at
[localhost:3001](http://localhost:3001).

See the [development guide](docs/development.md) for validation commands, seed
data, offline testing, and troubleshooting.

## Stack and layout

The Next.js web app calls a Fastify API, which accesses PostgreSQL through Prisma.
Supabase provides Auth and private Storage alongside the database.

| Area                | Location                                           | Main technologies                                                                 |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web app             | `apps/web`                                         | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui + Base UI, next-intl, Serwist |
| API                 | `apps/api`                                         | Fastify, TypeScript, Vertex AI                                                    |
| Shared packages     | `packages/db`, `packages/types`, `packages/config` | Prisma, shared contracts and configuration                                        |
| Tooling and hosting | Repository root, `ops/`                            | pnpm, Turborepo, Vercel, Supabase                                                 |

## Documentation

| Read about                                             | Guide                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Product requirements, feature behavior, and Plan Score | [PRD](PRD.md)                                                                                 |
| Contribution and AI delivery rules                     | [AGENTS.md](AGENTS.md)                                                                        |
| Local development, checks, and troubleshooting         | [Development](docs/development.md)                                                            |
| Environment variables and provider credentials         | [Environment setup](docs/environment.md)                                                      |
| Database, migrations, and sample data                  | [Database package](packages/db/README.md)                                                     |
| Deployment and maintenance                             | [Vercel operations](ops/vercel/README.md)                                                     |
| Private file storage setup                             | [Supabase operations](ops/supabase/README.md)                                                 |
| Authentication redirects, SMTP, and email templates    | [Email auth rollout](docs/auth/email-auth-rollout.md)                                         |
| AI launch checks and operator tools                    | [Launch runbook](docs/ai/launch-runbook.md) · [Entitlements](docs/ai/entitlements-runbook.md) |
| Background reminders and push notifications            | [Dispatch runbook](docs/notifications/dispatch-runbook.md)                                    |
| Brand assets and usage                                 | [Brand guide](docs/brand/README.md)                                                           |
