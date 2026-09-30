// One shared PostgreSQL pool for the tracker store and the user store (Supabase / Railway / RDS / self-hosted).
const fs = require("fs");
const path = require("path");

let pool = null;

function sslOptions() {
  // hosted Postgres requires TLS; HR_DB_SSL=false only for a local database.
  if (process.env.HR_DB_SSL === "false") return false;
  // HR_DB_SSL_CA: the host's CA certificate (Supabase: Database settings → SSL → Download certificate),
  // as a file path (relative to server/) or the PEM text itself, so the server certificate is verified, not just encrypted.
  const caSetting = (process.env.HR_DB_SSL_CA || "").trim();
  const ca = !caSetting ? undefined
    : caSetting.startsWith("-----BEGIN") ? caSetting.replace(/\\n/g, "\n")
    : fs.readFileSync(path.resolve(__dirname, "..", caSetting), "utf8");
  return { ca, rejectUnauthorized: process.env.HR_DB_SSL_STRICT !== "false" };
}

function getPool() {
  if (pool) return pool;
  const url = process.env.HR_DATABASE_URL;
  if (!url) throw new Error("HR_DATABASE_URL must be set to use PostgreSQL");
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: url,
    ssl: sslOptions(),
    max: Number(process.env.HR_DB_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
  });
  // an idle connection dropped by the host (restart, failover, network) must not crash the API;
  // the pool discards it and the next query opens a fresh one
  pool.on("error", (err) => console.error("database connection lost:", err.message));
  return pool;
}

async function closePool() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

module.exports = { getPool, closePool };
