-- Local-only compatibility objects for Trove's Prisma migration.
-- Hosted Supabase owns auth.users; Prisma never migrates this schema.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Locally, real users only exist in hosted Supabase Auth's database, not this
-- one, so `trove.profiles.id`'s FK to auth.users would otherwise reject every
-- signed-in user. Auto-mirror the id here on first profile write so the FK
-- still holds without requiring a synced copy of hosted Supabase Auth data.
--
-- This script runs once, on a fresh volume, before `trove.profiles` exists
-- (Prisma migrations create it later). An event trigger lets the row-level
-- trigger attach itself the moment that table shows up, whenever that is.
CREATE OR REPLACE FUNCTION public.attach_auth_user_stub_trigger()
RETURNS event_trigger AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.object_type = 'table' AND obj.object_identity = 'trove.profiles' THEN
      EXECUTE $sql$
        CREATE OR REPLACE FUNCTION trove.ensure_auth_user_stub()
        RETURNS trigger AS $f$
        BEGIN
          INSERT INTO auth.users (id) VALUES (NEW.id)
          ON CONFLICT (id) DO NOTHING;
          RETURN NEW;
        END;
        $f$ LANGUAGE plpgsql;
      $sql$;
      EXECUTE 'DROP TRIGGER IF EXISTS ensure_auth_user_stub ON trove.profiles';
      EXECUTE 'CREATE TRIGGER ensure_auth_user_stub BEFORE INSERT ON trove.profiles '
        || 'FOR EACH ROW EXECUTE FUNCTION trove.ensure_auth_user_stub()';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

DROP EVENT TRIGGER IF EXISTS attach_auth_user_stub_trigger;
CREATE EVENT TRIGGER attach_auth_user_stub_trigger
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.attach_auth_user_stub_trigger();

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
