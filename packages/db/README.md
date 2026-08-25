# Database package

`@trove/db` owns Prisma configuration and migrations for the `trove` PostgreSQL schema only. It must never manage Supabase-owned schemas such as `auth` or `storage`.

The Prisma schema contains a minimal `AuthUser` model only so Trove profiles can reference `auth.users.id`. Prisma's externally managed table configuration excludes `auth.users` from every migration; only Trove-owned objects are created or changed.

Core private records are addressable through a profile owner or trip, while canonical provider-backed Places remain separate from Saved and Trip Place relationships. Database constraints preserve same-trip itinerary references, minimum itinerary-item content, and nullable day assignment for Unscheduled items.

Keep the `trove` schema out of Supabase Data API exposure until task-scoped RLS policies are added; application access currently goes through the server-side database package.

## Environment

Copy the root `.env.example` to `.env` and use the exact connection strings from the target project's Supabase **Connect** panel:

- `DATABASE_URL` uses Supavisor transaction mode (`6543`) at runtime. The client limits each warm serverless process to one connection.
- `DIRECT_URL` uses Supavisor session mode (`5432`) only for Prisma CLI commands.
- `SHADOW_DATABASE_URL` is optional for `prisma migrate dev` and must point to an isolated local or Supabase branch database, never the shared project.

## Local Docker PostgreSQL

The repository includes a local PostgreSQL 17 container for development workflows that should not use the hosted Supabase database. It publishes PostgreSQL on port `54329` so it can coexist with other local database services:

```bash
docker compose up -d postgres
docker compose ps
docker compose exec -T postgres pg_isready -U trove -d trove
```

Copy `docker/local.env.example` to `docker/local.env`, then load it in the shell before Prisma or API commands so the local URLs override the hosted values from the root `.env`:

```bash
cp docker/local.env.example docker/local.env
set -a; source docker/local.env; set +a
pnpm --filter @trove/db db:migrate:deploy
```

The Docker init script creates only a minimal local `auth.users` compatibility table because the committed Trove migration references Supabase Auth's external table. It is not a local Auth service and must not be added to Prisma migrations. Hosted Supabase remains the source of truth for Auth, Storage, and production data.

If the API uses a hosted Supabase session while writing to this local database, insert that signed-in user's UUID into the compatibility table once so the profile foreign key can resolve it:

```sql
insert into auth.users (id, email)
values ('<supabase-user-uuid>', '<email>')
on conflict (id) do nothing;
```

Stop the container with `docker compose stop postgres`; remove its persisted local data only when intentionally resetting the database with `docker compose down -v`.

## Development seed

`pnpm db:seed` builds a complete, browsable Japan trip: Places, a ten-day itinerary, a flight and an accommodation, tasks, trip info, expenses in JPY against a non-JPY home currency, Memories with highlights, and day and trip Experience Ratings.

Trove profiles are keyed by the Supabase auth user id, so the seed writes against the account you actually sign in with:

```bash
TROVE_SEED_USER_ID="<your-supabase-user-uuid>" pnpm db:seed
```

Find the UUID in the Supabase dashboard under Authentication, or run `(await supabase.auth.getUser()).data.user.id` in the browser console while signed in. Against the local database the seed inserts the matching `auth.users` compatibility row itself.

The trip is dated to have finished two weeks ago, which is what puts Home, Trip Overview, and Trip Story into their completed states. Re-running shifts those dates forward; everything else is keyed by fixed ids and upserted. `pnpm db:seed -- --reset` removes the seeded rows first, scoped to the ids the seed owns so real trips and saved Places are untouched.

Memory photos are not seeded, because rows without matching objects in the private `memory-photos` bucket render as broken images. Add a few through the UI to exercise the Trip Story cover.

## Workflow

1. Confirm the environment with `pnpm --filter @trove/db db:validate-env`.
2. Create a Trove-only migration with `pnpm --filter @trove/db db:migrate:dev --name <change>`.
3. Commit the generated files under `packages/db/prisma/migrations`.
4. Apply committed migrations in a deployment with `pnpm --filter @trove/db db:migrate:deploy`.
5. Regenerate the client with `pnpm --filter @trove/db db:generate` whenever the schema changes.

For a production deployment from your terminal, copy `.env.production.example`
to the gitignored root `.env.production`, set `TROVE_ENVIRONMENT="production"`,
and provide the production session/direct `DIRECT_URL` on port `5432`. Run
`pnpm db:migrate:prod`; it validates the target before invoking
`prisma migrate deploy` and never prints the connection string.

Do not run `prisma db pull` against Supabase-managed schemas or add `auth`/`storage` to the Prisma datasource.
