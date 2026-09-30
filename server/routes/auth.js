// POST /api/auth/login { email, password } -> { token, user }
// GET  /api/auth/me                         -> { user }
const express = require("express");
const { login, requireAuth } = require("../lib/auth");

const router = express.Router();

// small in-memory throttle: 10 attempts / 15 min per IP
const attempts = new Map();
function throttled(ip) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const a = (attempts.get(ip) || []).filter((t) => now - t < win);
  attempts.set(ip, a);
  return a.length >= 10;
}

router.post("/login", async (req, res, next) => {
  try {
    if (throttled(req.ip)) return res.status(429).json({ error: "Too many attempts — try again in 15 minutes" });
    attempts.get(req.ip).push(Date.now());
    const result = await login(req.body && req.body.email, req.body && req.body.password);
    if (!result) return res.status(401).json({ error: "Email or password is incorrect" });
    res.json(result);
  } catch (e) {
    if (/HR_JWT_SECRET/.test(e.message)) return res.status(503).json({ error: "Tracker API is not configured" });
    next(e);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { email: req.user.sub, name: req.user.name, role: req.user.role } });
});

module.exports = router;
