-- Local-only compatibility objects for Trove's Prisma migration.
-- Hosted Supabase owns auth.users; Prisma never migrates this schema.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Keep a separate shadow database available for `prisma migrate dev`.
SELECT 'CREATE DATABASE trove_shadow OWNER trove'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'trove_shadow')\gexec

\connect trove_shadow

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
