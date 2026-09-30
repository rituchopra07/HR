-- =====================================================================
-- HR Portal — shared compliance trackers (POSH, Labour Codes, Payroll)
-- PostgreSQL 14+ · works on Supabase, Railway, AWS RDS or self-hosted.
--
-- Run once as the database owner (Supabase: SQL editor; others: psql).
-- Then create the app login below and give its URL to the API as HR_DATABASE_URL.
-- =====================================================================

-- One document per tracker × entity; version enables optimistic locking.
CREATE TABLE IF NOT EXISTS hr_tracker_doc (
    tracker     text        NOT NULL CHECK (tracker IN ('labour', 'posh', 'payroll_processing', 'payroll_kpi')),
    entity      text        NOT NULL CHECK (entity IN ('PSPL', 'FSK', 'FSM', 'FALH', 'FWGS', 'FPV', 'FPA')),
    doc         jsonb       NOT NULL CHECK (jsonb_typeof(doc -> 'items') = 'object'),   -- { items, remarks }
    version     integer     NOT NULL CHECK (version > 0),
    updated_by  text        NOT NULL,
    updated_at  timestamptz NOT NULL,
    PRIMARY KEY (tracker, entity)
);

-- Every save is kept: who changed what, and a way to roll back.
CREATE TABLE IF NOT EXISTS hr_tracker_doc_history (
    id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tracker           text        NOT NULL,
    entity            text        NOT NULL,
    version           integer     NOT NULL,
    doc               jsonb       NOT NULL,
    updated_by        text        NOT NULL,
    updated_by_email  text,
    saved_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_tracker_doc_history_key ON hr_tracker_doc_history (tracker, entity, version DESC);

-- ---------------------------------------------------------------------
-- App login for the API: read/write these two tables, nothing else.
-- Replace the password (generate a long random one; never commit it).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrportal_app') THEN
    CREATE ROLE hrportal_app LOGIN PASSWORD '<STRONG-PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO hrportal_app;
GRANT SELECT, INSERT, UPDATE ON hr_tracker_doc         TO hrportal_app;
GRANT SELECT, INSERT         ON hr_tracker_doc_history TO hrportal_app;

-- ---------------------------------------------------------------------
-- Row-level security. On Supabase this is essential: tables in `public`
-- are otherwise reachable through its auto-generated REST API with the
-- public anon key. RLS on + no policy for anon/authenticated = no access;
-- the explicit policies let only the API's own login through.
-- ---------------------------------------------------------------------
ALTER TABLE hr_tracker_doc         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_tracker_doc_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hrportal_app_rw ON hr_tracker_doc;
CREATE POLICY hrportal_app_rw ON hr_tracker_doc FOR ALL TO hrportal_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hrportal_app_rw ON hr_tracker_doc_history;
CREATE POLICY hrportal_app_rw ON hr_tracker_doc_history FOR ALL TO hrportal_app USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON hr_tracker_doc, hr_tracker_doc_history FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON hr_tracker_doc, hr_tracker_doc_history FROM authenticated';
  END IF;
END $$;
