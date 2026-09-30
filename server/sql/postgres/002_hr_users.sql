-- =====================================================================
-- HR Portal — sign-in users for the tracker API (run after 001_hr_trackers.sql)
-- Run once as the database owner (Supabase: SQL editor). Safe to re-run. No passwords in here:
-- users are added with  node scripts/add-user.js  and stored only as bcrypt hashes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hr_users (
  email          text        PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name           text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  role           text        NOT NULL DEFAULT 'hr' CHECK (role IN ('admin', 'hr')),
  password_hash  text        NOT NULL CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'),   -- bcrypt only
  active         boolean     NOT NULL DEFAULT true,     -- disable instead of deleting, so history stays readable
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The API reads users at sign-in; add-user.js (same login) adds users, resets passwords and disables them.
-- No DELETE: people are disabled, never removed.
GRANT SELECT, INSERT, UPDATE ON hr_users TO hrportal_app;

-- Same protection as the tracker tables: RLS on, only the API's login gets through, Supabase's public roles get nothing.
ALTER TABLE hr_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrportal_app_rw ON hr_users;
CREATE POLICY hrportal_app_rw ON hr_users FOR ALL TO hrportal_app USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON hr_users FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON hr_users FROM authenticated';
  END IF;
END $$;

-- Check: expect one row — hr_users | rls on | hrportal_app: INSERT, SELECT, UPDATE (and nothing for anon/authenticated)
SELECT c.relname AS table_name,
       CASE WHEN c.relrowsecurity THEN 'rls on' ELSE 'RLS OFF' END AS security,
       (SELECT string_agg(grantee || ': ' || privs, ' / ')
          FROM (SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
                  FROM information_schema.role_table_grants
                 WHERE table_name = 'hr_users' AND grantee IN ('hrportal_app', 'anon', 'authenticated')
                 GROUP BY grantee) g) AS grants
  FROM pg_class c
 WHERE c.relname = 'hr_users';
