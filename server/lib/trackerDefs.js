// Tracker definitions (POSH, Labour Codes, Payroll) shared with the portal and the exporter,
// plus validation of a tracker document before it is stored.
const fs = require("fs");
const path = require("path");

const DEFS_PATH = path.join(__dirname, "..", "..", "tools", "manual", "trackers", "definitions.json");
const defs = JSON.parse(fs.readFileSync(DEFS_PATH, "utf-8"));

const MAX_REMARK = 4000;
const KEY_RE = /^\d{1,3}-\d{1,3}$/;

function tracker(id) {
  return Object.prototype.hasOwnProperty.call(defs.trackers, id) ? defs.trackers[id] : null;
}

// entity key used inside documents/backups (FPV -> FP_Vesu), matching Ritu's tracker
function docEntityKey(code) {
  return (defs.entity_keys && defs.entity_keys[code]) || code;
}

/** Returns { ok: true, doc } with a normalised document, or { ok: false, error }. */
function validateDoc(trackerId, entity, doc) {
  const t = tracker(trackerId);
  if (!t) return { ok: false, error: "Unknown tracker" };
  if (!t.entities.includes(entity)) return { ok: false, error: "Unknown entity for this tracker" };
  if (!doc || typeof doc !== "object" || typeof doc.items !== "object") return { ok: false, error: "Document must have items" };

  const allowed = new Set(["", t.statuses.yes, t.statuses.no, t.statuses.na]);
  const periods = t.periods || null;
  const items = {};
  t.categories.forEach((cat, ci) => {
    cat.items.forEach((_, ii) => {
      const key = `${ci}-${ii}`;
      const v = doc.items[key];
      if (periods) {
        const months = {};
        periods.forEach((p) => {
          const s = v && typeof v === "object" ? v[p] || "" : "";
          months[p] = allowed.has(s) ? s : "";
        });
        items[key] = months;
      } else {
        items[key] = typeof v === "string" && allowed.has(v) ? v : "";
      }
    });
  });
  for (const k of Object.keys(doc.items)) {
    if (!KEY_RE.test(k)) return { ok: false, error: `Bad item key ${k}` };
  }

  const remarks = {};
  t.categories.forEach((_, ci) => {
    const r = doc.remarks && doc.remarks[ci];
    remarks[ci] = typeof r === "string" ? r.slice(0, MAX_REMARK) : "";
  });
  return { ok: true, doc: { items, remarks, meta: {} } };
}

module.exports = { defs, tracker, docEntityKey, validateDoc };
