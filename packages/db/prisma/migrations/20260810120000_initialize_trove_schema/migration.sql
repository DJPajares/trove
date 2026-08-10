-- Prisma cannot represent a schema-only namespace without a model.
-- Keep the bootstrap idempotent and isolated from Supabase-managed schemas.
CREATE SCHEMA IF NOT EXISTS "trove";
