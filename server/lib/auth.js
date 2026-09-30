// Minimal auth for the tracker API: HR users (bcrypt-hashed) in a git-ignored JSON file,
// signed JWTs for sessions. The portal is a public static site, so every write needs a token.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const USERS_FILE = process.env.HR_USERS_FILE || path.join(__dirname, "..", "data", "hr-users.json");
const SECRET = process.env.HR_JWT_SECRET;
const TTL = process.env.HR_JWT_TTL || "8h";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function requireSecret() {
  if (!SECRET || SECRET.length < 32) {
    throw new Error("HR_JWT_SECRET must be set (at least 32 characters) to use the tracker API");
  }
}

async function login(email, password) {
  requireSecret();
  const user = readUsers().find((u) => u.email.toLowerCase() === String(email || "").toLowerCase() && u.active !== false);
  // compare against a dummy hash when the user is unknown, so timing doesn't reveal which emails exist
  const hash = user ? user.passwordHash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ""), hash);
  if (!user || !ok) return null;
  const token = jwt.sign({ sub: user.email, name: user.name, role: user.role || "hr" }, SECRET, { expiresIn: TTL });
  return { token, user: { email: user.email, name: user.name, role: user.role || "hr" } };
}

function requireAuth(req, res, next) {
  try {
    requireSecret();
  } catch (e) {
    return res.status(503).json({ error: "Tracker API is not configured" });
  }
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return res.status(401).json({ error: "Sign in required" });
  try {
    req.user = jwt.verify(m[1], SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Session expired — sign in again" });
  }
}

module.exports = { login, requireAuth, readUsers, USERS_FILE };
