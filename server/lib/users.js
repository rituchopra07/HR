// HR users who can sign in to the tracker API (password stored only as a bcrypt hash).
// With HR_TRACKER_STORE=postgres they live in the database (hr_users, sql/postgres/002_hr_users.sql), so the hosted
// API and scripts/add-user.js share one list. Otherwise a git-ignored JSON file (development, SQL Server setups).
const fs = require("fs");
const path = require("path");

const ROLES = ["admin", "hr"];
const USERS_FILE = process.env.HR_USERS_FILE || path.join(__dirname, "..", "data", "hr-users.json");
const BCRYPT = /^\$2[aby]\$\d{2}\$.{53}$/;

const clean = (email) => String(email || "").trim().toLowerCase();

function check(u) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) throw new Error("Not a valid email: " + u.email);
  if (!u.name || u.name.length > 200) throw new Error("Name is required (up to 200 characters)");
  if (!ROLES.includes(u.role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  if (!BCRYPT.test(u.passwordHash || "")) throw new Error("Password hash is not a bcrypt hash");
}

/* ---------- JSON file ---------- */
function fileUsers(file = USERS_FILE) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return []; } };
  const write = (list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); };
  return {
    kind: "file",
    where: file,
    async find(email) {
      const u = read().find((x) => clean(x.email) === clean(email));
      return u ? { email: clean(u.email), name: u.name, role: u.role || "hr", active: u.active !== false, passwordHash: u.passwordHash } : null;
    },
    async list() {
      return read().map((u) => ({ email: clean(u.email), name: u.name, role: u.role || "hr", active: u.active !== false, passwordHash: u.passwordHash }));
    },
    async upsert(u, { keepExisting = false } = {}) {
      const user = { email: clean(u.email), name: String(u.name || "").trim(), role: u.role || "hr", active: u.active !== false, passwordHash: u.passwordHash };
      check(user);
      const list = read(), i = list.findIndex((x) => clean(x.email) === user.email);
      if (i >= 0 && keepExisting) return false;
      const row = { ...user, createdAt: i >= 0 ? list[i].createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (i >= 0) list[i] = row; else list.push(row);
      write(list);
      return true;
    },
    async setActive(email, active) {
      const list = read(), u = list.find((x) => clean(x.email) === clean(email));
      if (!u) return false;
      u.active = !!active; u.updatedAt = new Date().toISOString();
      write(list);
      return true;
    },
  };
}

/* ---------- PostgreSQL ---------- */
function postgresUsers() {
  const pool = require("./pg").getPool();
  const row = (r) => r && { email: r.email, name: r.name, role: r.role, active: r.active, passwordHash: r.password_hash };
  return {
    kind: "postgres",
    where: "PostgreSQL table hr_users",
    async find(email) {
      const r = await pool.query("SELECT email, name, role, active, password_hash FROM hr_users WHERE email = $1", [clean(email)]);
      return row(r.rows[0]) || null;
    },
    async list() {
      const r = await pool.query("SELECT email, name, role, active, password_hash FROM hr_users ORDER BY name");
      return r.rows.map(row);
    },
    async upsert(u, { keepExisting = false } = {}) {
      const user = { email: clean(u.email), name: String(u.name || "").trim(), role: u.role || "hr", active: u.active !== false, passwordHash: u.passwordHash };
      check(user);
      const r = await pool.query(
        "INSERT INTO hr_users (email, name, role, active, password_hash) VALUES ($1, $2, $3, $4, $5) " +
        (keepExisting ? "ON CONFLICT (email) DO NOTHING"
          : "ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active, password_hash = EXCLUDED.password_hash, updated_at = now()"),
        [user.email, user.name, user.role, user.active, user.passwordHash]);
      return r.rowCount > 0;
    },
    async setActive(email, active) {
      const r = await pool.query("UPDATE hr_users SET active = $2, updated_at = now() WHERE email = $1", [clean(email), !!active]);
      return r.rowCount > 0;
    },
  };
}

let users = null;
function getUsers() {
  if (users) return users;
  const kind = process.env.HR_USERS_STORE || (process.env.HR_TRACKER_STORE === "postgres" ? "postgres" : "file");
  users = kind === "postgres" ? postgresUsers() : fileUsers();
  return users;
}

module.exports = { getUsers, fileUsers, ROLES, USERS_FILE };
