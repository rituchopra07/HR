// Storage for tracker documents. One document per (tracker, entity), versioned for optimistic locking.
//   HR_TRACKER_STORE=file   (default) -> server/data/trackers/<tracker>/<entity>.json   (git-ignored)
//   HR_TRACKER_STORE=mssql            -> table dbo.HRTrackerDoc (see server/sql/001_hr_trackers.sql)
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

function createStore() {
  return (process.env.HR_TRACKER_STORE || "file") === "mssql" ? mssqlStore() : fileStore();
}

module.exports = { createStore, fileStore, Conflict };
