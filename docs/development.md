# Development guide

[Back to README](../README.md) · [Environment and provider setup](environment.md)

Run commands from the repository root. For delivery and contribution rules, follow
[AGENTS.md](../AGENTS.md); product requirements live in [PRD.md](../PRD.md).

## Database setup

Use a development Supabase project for the hosted database path. After configuring
the root `.env`, validate the target and apply committed migrations:

```bash
pnpm db:validate-env
pnpm db:migrate:deploy
```

For a local database, follow the [Docker PostgreSQL instructions](../packages/db/README.md#local-docker-postgresql).
Load `docker/local.env` in the same shell before migrations and `pnpm dev`, so
local connection values override the root `.env`. Docker provides PostgreSQL
only; Supabase still supplies Auth and Storage. The database guide also explains
how to link a hosted sign-in to the local compatibility table.

For sample trips, use the [development seed](../packages/db/README.md#development-seed).
Schema changes, shadow databases, and production migrations are covered in the
[database workflow](../packages/db/README.md#workflow).

## Everyday commands

| Command                                    | Purpose                                                             |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `pnpm dev`                                 | Start web and API development servers and build shared dependencies |
| `pnpm build`                               | Build all workspaces, including the production web app and worker   |
| `pnpm lint`                                | Check code quality                                                  |
| `pnpm typecheck`                           | Check TypeScript types                                              |
| `pnpm format:check`                        | Check repository formatting                                         |
| `pnpm --filter @trove/web test`            | Run web unit tests                                                  |
| `pnpm --filter @trove/api test`            | Run API unit tests                                                  |
| `pnpm --filter @trove/web changelog:check` | Validate user-facing changelog entries                              |

The PR [quality workflow](../.github/workflows/quality.yml) defines the shared
checks. Run focused tests for the behavior you change, following
[AGENTS.md](../AGENTS.md#testing).

## Offline development

Service-worker behavior needs a production build. During `pnpm dev`, Trove removes
prior Trove service-worker registrations and `trove-pwa-*` caches for the current
origin to avoid stale content. Build first, then run the built API and web app in
separate terminals:

```bash
pnpm build
pnpm --filter @trove/api start
# In another terminal:
pnpm --filter @trove/web start
```

Offline readiness is per user and device; visiting one screen does not prepare
an entire trip. Use [PRD §28](../PRD.md#28-offline-requirements) for the full
readiness and sync contract. Offline access does not authorize server operations.
When adding offline storage, register its local-data clearer with
`signOutFromTrove`; Settings must warn about unsynced changes before invoking it.

## Troubleshooting the dev cache

If the web dev server fails with a Turbopack cache panic such as
`inner_of_upper_lost_followers`, stop it, clear the cache, then restart:

```bash
pnpm --filter @trove/web dev:reset
pnpm dev
```

The reset clears only `apps/web/.next/dev/cache/turbopack`.
