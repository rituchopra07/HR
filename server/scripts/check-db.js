#!/usr/bin/env node
/* Check the tracker API's database connection (read-only).
 *   cd server && node scripts/check-db.js
 * Uses server/.env like the server does. Prints no passwords or connection strings. */
const path = require("path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch (e) { if (e.code !== "ENOENT") throw e; }

const { createStore } = require("../lib/trackerStore");
const { closePool } = require("../lib/pg");

(async () => {
  const store = createStore();
  if (store.kind !== "postgres") {
    console.log(`HR_TRACKER_STORE is "${store.kind}" — set HR_TRACKER_STORE=postgres to check the database.`);
    return;
  }
  const client = await store.pool.connect();
  try {
    const who = await client.query(
      "select current_user as login, current_database() as db, split_part(version(), ' ', 2) as pg, " +
      "(select ssl from pg_stat_ssl where pid = pg_backend_pid()) as tls");
    const r = who.rows[0];
    console.log(`Connected as ${r.login} to ${r.db} (PostgreSQL ${r.pg}), TLS ${r.tls ? "on" : "OFF"}`);
    const ssl = store.pool.options.ssl;
    console.log(`Certificate check: ${!ssl ? "off (local database)" : ssl.rejectUnauthorized ? (ssl.ca ? "verified against HR_DB_SSL_CA" : "verified against Node's trusted CAs") : "SKIPPED (HR_DB_SSL_STRICT=false)"}`);
    const docs = await client.query("select tracker, count(*)::int as n from hr_tracker_doc group by tracker order by tracker");
    const hist = await client.query("select count(*)::int as n from hr_tracker_doc_history");
    console.log(`Tracker documents: ${docs.rows.length ? docs.rows.map((d) => `${d.tracker} ${d.n}`).join(", ") : "none yet"}; history rows: ${hist.rows[0].n}`);
    const tbl = await client.query("select to_regclass('public.hr_users') is not null as present");
    if (tbl.rows[0].present) {
      const u = await client.query("select count(*) filter (where active)::int as active, count(*) filter (where not active)::int as disabled from hr_users");
      console.log(`Sign-in users: ${u.rows[0].active} active, ${u.rows[0].disabled} disabled`);
    } else {
      console.log("Sign-in users: table hr_users missing — run sql/postgres/002_hr_users.sql in the Supabase SQL editor");
    }
    const priv = await client.query(
      "select has_table_privilege('hr_tracker_doc', 'DELETE') or coalesce(has_table_privilege(to_regclass('public.hr_users'), 'DELETE'), false) as can_delete, " +
      "(select rolsuper from pg_roles where rolname = current_user) as superuser");
    const p = priv.rows[0];
    console.log(p.can_delete || p.superuser
      ? "WARNING: this login has more rights than it needs — use the hrportal_app login."
      : "Least privilege: OK (read, insert, update only)");
    console.log("Database check passed.");
  } finally {
    client.release();
    await closePool();
  }
})().catch((err) => {
  const hint =
    err.code === "ENOENT" && /\.(crt|pem)/.test(err.message) ? " — save the certificate from Supabase (Database settings → SSL configuration → Download certificate) at that path" :
    /self-signed|unable to verify|certificate/i.test(err.message) ? " — download the CA certificate and set HR_DB_SSL_CA (see .env.example)" :
    /password authentication failed/i.test(err.message) ? " — check the app password and that the user is hrportal_app.<project-ref>" :
    /ENOTFOUND|ENETUNREACH|EHOSTUNREACH/i.test(err.message) ? " — use the Session pooler host from Supabase → Connect" :
    /Tenant or user not found/i.test(err.message) ? " — the user must be hrportal_app.<project-ref> (with the dot and project ref)" : "";
  console.error("Database check FAILED: " + err.message + hint);
  process.exit(1);
});
