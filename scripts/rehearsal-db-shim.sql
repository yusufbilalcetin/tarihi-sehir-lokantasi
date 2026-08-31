-- Supabase-managed objects, recreated so the migration chain can be rehearsed
-- on a plain PostgreSQL.
--
-- FOR DISPOSABLE TEST DATABASES ONLY. Never run this against production or any
-- Supabase project: there these objects already exist and are owned by the
-- platform, and a hand-made `auth.users` would be a second, wrong source of
-- identity.
--
-- Why it is needed at all: migration 0000 declares a foreign key from
-- `staff_profiles.auth_user_id` to `auth.users(id)` and eighteen row-level
-- security policies that call `auth.uid()`. Supabase Auth owns both, so this
-- repository deliberately never creates them — which also means `npm run
-- db:migrate` cannot bootstrap a database that is not a Supabase project until
-- something puts that surface in place. Migration 0003 is already written to be
-- a no-op on plain PostgreSQL; 0000 is not, and closing that gap in 0000 would
-- mean editing a migration that production has already applied.
--
-- Recreating these here makes a rehearsal MORE production-like, not less: the
-- real database has all of them.
--
-- Usage, against a disposable cluster only:
--   psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rehearsal-db-shim.sql
--   DATABASE_URL="$REHEARSAL_DATABASE_URL" npx tsx db/migrate.ts

DO $guard$
BEGIN
  -- Fail closed rather than politely: this file must never touch a real project.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    RAISE EXCEPTION 'refusing to run the rehearsal shim against a Supabase project';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE
);

-- Supabase resolves this from the request JWT. Here it reads the session
-- setting, so a test can adopt an identity deliberately and exercise RLS.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$roles$;
