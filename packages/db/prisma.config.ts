import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { defineConfig } from 'prisma/config';

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'),
});

/**
 * Supabase owns `auth.users`, so it never exists in the fresh shadow database
 * Prisma builds to replay migrations into. Without it the very first migration
 * fails on its `profiles.id` foreign key and `prisma migrate dev` cannot run at
 * all — for any migration, not just a new one.
 *
 * Only the primary key is needed: that column is the whole of the `AuthUser`
 * model and the only thing any migration references. Deliberately minimal, so
 * this stays a stand-in for the shadow database rather than a second opinion
 * about a table Trove does not own.
 *
 * The storage policies in `20260812070000` need no equivalent — they already
 * guard on `pg_namespace` and skip when the schema is absent.
 */
const SHADOW_DB_EXTERNAL_TABLES = `
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE TABLE IF NOT EXISTS "auth"."users" ("id" uuid PRIMARY KEY);
`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    initShadowDb: SHADOW_DB_EXTERNAL_TABLES,
    path: 'prisma/migrations',
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['auth.users'],
  },
  datasource: {
    url: process.env.DIRECT_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
