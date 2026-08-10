# Database package

`@trove/db` owns Prisma configuration and migrations for the `trove` PostgreSQL schema only. It must never manage Supabase-owned schemas such as `auth` or `storage`.

## Environment

Copy the root `.env.example` to `.env` and use the exact connection strings from the target project's Supabase **Connect** panel:

- `DATABASE_URL` uses Supavisor transaction mode (`6543`) at runtime. The client limits each warm serverless process to one connection.
- `DIRECT_URL` uses Supavisor session mode (`5432`) only for Prisma CLI commands.
- `SHADOW_DATABASE_URL` is optional for `prisma migrate dev` and must point to an isolated local or Supabase branch database, never the shared project.

## Workflow

1. Confirm the environment with `pnpm --filter @trove/db db:validate-env`.
2. Create a Trove-only migration with `pnpm --filter @trove/db db:migrate:dev --name <change>`.
3. Commit the generated files under `packages/db/prisma/migrations`.
4. Apply committed migrations in a deployment with `pnpm --filter @trove/db db:migrate:deploy`.
5. Regenerate the client with `pnpm --filter @trove/db db:generate` whenever the schema changes.

Do not run `prisma db pull` against Supabase-managed schemas or add `auth`/`storage` to the Prisma datasource.
