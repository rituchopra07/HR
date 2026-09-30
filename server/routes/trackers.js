// Shared compliance trackers (POSH, Labour Codes, Payroll processing, Payroll KPIs).
//   GET  /api/trackers                      -> definitions summary
//   GET  /api/trackers/:tracker             -> { entities: { <code>: doc } }
//   GET  /api/trackers/:tracker/:entity     -> doc | 404
//   PUT  /api/trackers/:tracker/:entity     -> body { doc, baseVersion } -> saved doc | 409 { current }
//   GET  /api/trackers/:tracker/backup      -> backup bundle in the same format as Ritu's tracker
// Every route requires a signed-in HR user.
const express = require("express");
const { defs, tracker, docEntityKey, validateDoc } = require("../lib/trackerDefs");
const { requireAuth } = require("../lib/auth");
const { createStore, Conflict } = require("../lib/trackerStore");

const router = express.Router();
const store = createStore();

router.use(requireAuth);

router.get("/", (req, res) => {
  res.json({
    store: store.kind,
    trackers: Object.fromEntries(Object.entries(defs.trackers).map(([id, t]) => [id, { title: t.title, entities: t.entities }])),
  });
});

router.get("/:tracker/backup", async (req, res, next) => {
  try {
    const t = tracker(req.params.tracker);
    if (!t) return res.status(404).json({ error: "Unknown tracker" });
    const docs = await store.list(req.params.tracker);
    const entities = {};
    for (const [code, doc] of Object.entries(docs)) entities[docEntityKey(code)] = doc;
    res.setHeader("Content-Disposition", `attachment; filename="${t.backup_prefix}${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), entities });
  } catch (e) { next(e); }
});

router.get("/:tracker", async (req, res, next) => {
  try {
    if (!tracker(req.params.tracker)) return res.status(404).json({ error: "Unknown tracker" });
    res.json({ entities: await store.list(req.params.tracker) });
  } catch (e) { next(e); }
});

router.get("/:tracker/:entity", async (req, res, next) => {
  try {
    const t = tracker(req.params.tracker);
    if (!t || !t.entities.includes(req.params.entity)) return res.status(404).json({ error: "Unknown tracker or entity" });
    const doc = await store.get(req.params.tracker, req.params.entity);
    if (!doc) return res.status(404).json({ error: "No entries yet" });
    res.json(doc);
  } catch (e) { next(e); }
});

router.put("/:tracker/:entity", async (req, res, next) => {
  try {
    const { tracker: tid, entity } = req.params;
    const v = validateDoc(tid, entity, req.body && req.body.doc);
    if (!v.ok) return res.status(400).json({ error: v.error });
    // who/when come from the session, never from the browser
    v.doc.meta = { updatedBy: req.user.name || req.user.sub, updatedByEmail: req.user.sub, updatedAt: new Date().toISOString() };
    const base = req.body.baseVersion == null ? null : Number(req.body.baseVersion);
    const saved = await store.put(tid, entity, v.doc, base);
    res.json(saved);
  } catch (e) {
    if (e instanceof Conflict) return res.status(409).json({ error: "Someone else saved this entity first", current: e.current });
    next(e);
  }
});

module.exports = router;
