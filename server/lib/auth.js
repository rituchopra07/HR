// Minimal auth for the tracker API: HR users (bcrypt-hashed, see lib/users.js), signed JWTs for sessions.
// The portal is a public static site, so every write needs a token.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getUsers } = require("./users");

const SECRET = process.env.HR_JWT_SECRET;
const TTL = process.env.HR_JWT_TTL || "8h";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);
// a signed-in session is re-checked against the user list this often, so disabling someone takes effect
// within a minute instead of when their token expires
const RECHECK_MS = Number(process.env.HR_USER_RECHECK_SECONDS || 60) * 1000;
const recheck = new Map();   // email -> { at, user }

function requireSecret() {
  if (!SECRET || SECRET.length < 32) {
    throw new Error("HR_JWT_SECRET must be set (at least 32 characters) to use the tracker API");
  }
}

async function login(email, password) {
  requireSecret();
  const found = await getUsers().find(email);
  const user = found && found.active ? found : null;
  // compare against a dummy hash when the user is unknown, so timing doesn't reveal which emails exist
  const ok = await bcrypt.compare(String(password || ""), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return null;
  recheck.delete(user.email);
  const token = jwt.sign({ sub: user.email, name: user.name, role: user.role }, SECRET, { expiresIn: TTL });
  return { token, user: { email: user.email, name: user.name, role: user.role } };
}

async function currentUser(email) {
  const hit = recheck.get(email);
  if (hit && Date.now() - hit.at < RECHECK_MS) return hit.user;
  const u = await getUsers().find(email);
  const user = u && u.active ? { email: u.email, name: u.name, role: u.role } : null;
  recheck.set(email, { at: Date.now(), user });
  return user;
}

async function requireAuth(req, res, next) {
  try {
    requireSecret();
  } catch (e) {
    return res.status(503).json({ error: "Tracker API is not configured" });
  }
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return res.status(401).json({ error: "Sign in required" });
  let claims;
  try {
    claims = jwt.verify(m[1], SECRET);
  } catch {
    return res.status(401).json({ error: "Session expired — sign in again" });
  }
  let user;
  try {
    user = await currentUser(claims.sub);
  } catch (e) {
    console.error("user check failed:", e.message || e.code || String(e));
    return res.status(503).json({ error: "Sign-in service is unavailable — try again shortly" });   // fail closed
  }
  if (!user) return res.status(401).json({ error: "Your access has been removed — contact HR" });
  req.user = { ...claims, name: user.name, role: user.role };
  return next();
}

module.exports = { login, requireAuth };
