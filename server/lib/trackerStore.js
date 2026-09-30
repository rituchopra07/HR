// Storage for tracker documents. One document per (tracker, entity), versioned for optimistic locking.
//   HR_TRACKER_STORE=file     (default) -> server/data/trackers/<tracker>/<entity>.json   (git-ignored)
//   HR_TRACKER_STORE=postgres           -> hr_tracker_doc (server/sql/postgres/001_hr_trackers.sql)
//                                          any Postgres: Supabase, Railway, AWS RDS, self-hosted
//   HR_TRACKER_STORE=mssql              -> dbo.HRTrackerDoc (server/sql/001_hr_trackers.sql)
const fs = require("fs");
const path = require("path");

class Conflict extends Error {
  constructor(current) {
    super("Document changed since it was loaded");
    this.current = current;
  }
}

/* ---------- file store (development / single server) ---------- */
function fileStore(root = process.env.HR_TRACKER_DIR || path.join(__dirname, "..", "data", "trackers")) {
  const file = (t, e) => path.join(root, t, `${e}.json`);
  return {
    kind: "file",
    async get(t, e) {
      try {
        return JSON.parse(fs.readFileSync(file(t, e), "utf-8"));
      } catch {
        return null;
      }
    },
    async list(t) {
      const dir = path.join(root, t);
      if (!fs.existsSync(dir)) return {};
      const out = {};
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      }
      return out;
    },
    async put(t, e, doc, baseVersion) {
      const cur = await this.get(t, e);
      const curVersion = cur ? cur.meta.version || 0 : 0;
      if (baseVersion != null && baseVersion !== curVersion) throw new Conflict(cur);
      doc.meta.version = curVersion + 1;
      fs.mkdirSync(path.dirname(file(t, e)), { recursive: true });
      const tmp = file(t, e) + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(doc));
      fs.renameSync(tmp, file(t, e)); // atomic replace
      return doc;
    },
  };
}

/* ---------- SQL Server store (shared production database) ---------- */
function mssqlStore() {
  const sql = require("mssql");
  const pool = new sql.ConnectionPool({
    server: process.env.HR_DB_SERVER,
    database: process.env.HR_DB_NAME || "HRPortalDB",
    user: process.env.HR_DB_USER,
    password: process.env.HR_DB_PASSWORD,
    options: { encrypt: process.env.HR_DB_ENCRYPT !== "false", trustServerCertificate: process.env.HR_DB_TRUST_CERT === "true" },
  }).connect();
  const parse = (row) => {
    const doc = JSON.parse(row.Doc);
    doc.meta = { ...(doc.meta || {}), version: row.Version, updatedAt: row.UpdatedAt.toISOString(), updatedBy: row.UpdatedBy };
    return doc;
  };
  return {
    kind: "mssql",
    async get(t, e) {
      const r = await (await pool).request().input("t", t).input("e", e)
        .query("SELECT Doc, Version, UpdatedAt, UpdatedBy FROM dbo.HRTrackerDoc WHERE Tracker=@t AND Entity=@e");
      return r.recordset[0] ? parse(r.recordset[0]) : null;
    },
    async list(t) {
      const r = await (await pool).request().input("t", t)
        .query("SELECT Entity, Doc, Version, UpdatedAt, UpdatedBy FROM dbo.HRTrackerDoc WHERE Tracker=@t");
      return Object.fromEntries(r.recordset.map((row) => [row.Entity, parse(row)]));
    },
    async put(t, e, doc, baseVersion) {
      const p = await pool;
      const tx = new sql.Transaction(p);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const cur = await new sql.Request(tx).input("t", t).input("e", e)
          .query("SELECT Doc, Version, UpdatedAt, UpdatedBy FROM dbo.HRTrackerDoc WITH (UPDLOCK, HOLDLOCK) WHERE Tracker=@t AND Entity=@e");
        const row = cur.recordset[0];
        const curVersion = row ? row.Version : 0;
        if (baseVersion != null && baseVersion !== curVersion) {
          await tx.rollback();
          throw new Conflict(row ? parse(row) : null);
        }
        const next = curVersion + 1;
        const body = JSON.stringify({ items: doc.items, remarks: doc.remarks });
        const req = new sql.Request(tx).input("t", t).input("e", e).input("d", sql.NVarChar(sql.MAX), body)
          .input("v", next).input("by", doc.meta.updatedBy).input("at", new Date(doc.meta.updatedAt));
        await req.query(row
          ? "UPDATE dbo.HRTrackerDoc SET Doc=@d, Version=@v, UpdatedBy=@by, UpdatedAt=@at WHERE Tracker=@t AND Entity=@e"
          : "INSERT dbo.HRTrackerDoc (Tracker, Entity, Doc, Version, UpdatedBy, UpdatedAt) VALUES (@t, @e, @d, @v, @by, @at)");
        await new sql.Request(tx).input("t", t).input("e", e).input("v", next).input("by", doc.meta.updatedBy).input("d", sql.NVarChar(sql.MAX), body)
          .query("INSERT dbo.HRTrackerDocHistory (Tracker, Entity, Version, Doc, UpdatedBy) VALUES (@t, @e, @v, @d, @by)");
        await tx.commit();
        doc.meta.version = next;
        return doc;
      } catch (err) {
        if (!(err instanceof Conflict)) { try { await tx.rollback(); } catch { /* already rolled back */ } }
        throw err;
      }
    },
  };
}

/* ---------- PostgreSQL store (Supabase / Railway / RDS / self-hosted) ---------- */
function postgresStore() {
  const pool = require("./pg").getPool();
  const parse = (row) => {
    const doc = row.doc;
    doc.meta = { ...(doc.meta || {}), version: row.version, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
    return doc;
  };
  return {
    kind: "postgres",
    pool,
    async get(t, e) {
      const r = await pool.query("SELECT doc, version, updated_at, updated_by FROM hr_tracker_doc WHERE tracker = $1 AND entity = $2", [t, e]);
      return r.rows[0] ? parse(r.rows[0]) : null;
    },
    async list(t) {
      const r = await pool.query("SELECT entity, doc, version, updated_at, updated_by FROM hr_tracker_doc WHERE tracker = $1", [t]);
      return Object.fromEntries(r.rows.map((row) => [row.entity, parse(row)]));
    },
    async put(t, e, doc, baseVersion) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        // lock the row (or the key, via the insert below) so two saves can't both win
        const cur = await c.query("SELECT doc, version, updated_at, updated_by FROM hr_tracker_doc WHERE tracker = $1 AND entity = $2 FOR UPDATE", [t, e]);
        const row = cur.rows[0];
        const curVersion = row ? row.version : 0;
        if (baseVersion != null && baseVersion !== curVersion) {
          await c.query("ROLLBACK");
          throw new Conflict(row ? parse(row) : null);
        }
        const next = curVersion + 1;
        const body = { items: doc.items, remarks: doc.remarks };
        const at = new Date(doc.meta.updatedAt);
        if (row) {
          await c.query("UPDATE hr_tracker_doc SET doc = $3, version = $4, updated_by = $5, updated_at = $6 WHERE tracker = $1 AND entity = $2",
            [t, e, body, next, doc.meta.updatedBy, at]);
        } else {
          // ON CONFLICT: a concurrent first save for the same key loses cleanly instead of erroring
          const ins = await c.query("INSERT INTO hr_tracker_doc (tracker, entity, doc, version, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tracker, entity) DO NOTHING",
            [t, e, body, next, doc.meta.updatedBy, at]);
          if (ins.rowCount === 0) {
            await c.query("ROLLBACK");
            throw new Conflict(await this.get(t, e));
          }
        }
        await c.query("INSERT INTO hr_tracker_doc_history (tracker, entity, version, doc, updated_by, updated_by_email) VALUES ($1, $2, $3, $4, $5, $6)",
          [t, e, next, body, doc.meta.updatedBy, doc.meta.updatedByEmail || null]);
        await c.query("COMMIT");
        doc.meta.version = next;
        return doc;
      } catch (err) {
        if (!(err instanceof Conflict)) { try { await c.query("ROLLBACK"); } catch { /* connection already failed */ } }
        throw err;
      } finally {
        c.release();
      }
    },
  };
}

function createStore() {
  const kind = process.env.HR_TRACKER_STORE || "file";
  if (kind === "postgres") return postgresStore();
  if (kind === "mssql") return mssqlStore();
  return fileStore();
}

module.exports = { createStore, fileStore, Conflict };
