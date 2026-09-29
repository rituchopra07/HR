# HR Management System

**Live portal: https://rituchopra07.github.io/HR/design/index.html**

Two parts live in this repo:

- **Fountainhead HR Portal** (`design/`) — the group-wide HR site for Central HR. Static site on GitHub Pages
  (link above); the old `design/workforce-register.html` link redirects into it.
- **HR Management app** (`client/` + `server/`) — an early React/Express employee CRUD prototype.

## HR Portal

### What's in it

| Section | Reports |
|---------|---------|
| 00 · Overview | Director snapshot (with "what needs attention"), Headcount (section × programme × payroll entity, PSPL split by campus, Nucleus completeness, students per staff), Workforce demographics (generations, age, tenure) |
| 01 · Hiring & Onboarding | Recruitment (status, area of interest, position), New joiners & induction, Onboarding checklist *(planned)* |
| 02 · Exit & Attrition | Attrition & exits (by academic year, campus, section, payroll entity), Exit reasons, F&F settlement, Exit interviews *(planned)* |
| 03 · HR Compliance | Compliance overview, Labour Codes 2020, POSH, Payroll processing checklist, Payroll KPIs, Statutory data (PF/UAN), HR tickets (type × section) |
| 04 · Policies & Guidelines | Employee-facing policy library — the only section in the Employee view |

Filters (one bar above every report): Looker-style date range (quick / year / half-year / quarter / month /
custom), campus, payroll entity and section. Every chart has a Table view. The "View as" switch previews the
Employee view.

### Project structure

```
HR/
├── design/                        # HR Portal (static site)
│   ├── index.html                 # app shell (top nav + nested sidebar)
│   ├── assets/portal.css          # design system ("The Register")
│   ├── assets/portal.js           # router, filters, charts, report views
│   ├── data/hr-data.js            # GENERATED aggregate data — do not edit by hand
│   └── workforce-register.html    # redirect for old links
├── tools/
│   ├── export_hr_data.py          # builds design/data/hr-data.js
│   ├── sources.example.json       # connection template → copy to sources.json (git-ignored)
│   ├── manual/
│   │   ├── reference.json         # monthly headcount reference (for the completeness check)
│   │   └── trackers/definitions.json  # checklist structure of Ritu's compliance trackers
│   └── private/                   # git-ignored: raw tracker backups (never committed)
├── client/                        # React (Vite) frontend (prototype)
└── server/                        # Express API server (prototype)
```

### Data sources

| Data | Source |
|------|--------|
| FSK staff, support staff, exits & reasons, recruitment, induction, HR tickets, students, PF/UAN | Nucleus v1 (old Nucleus) — `INVENTORY.MDF` |
| FSM, FPV, FPA, FALH, FWGS staff, exits, HR tickets, students | Nucleus EDU — one tenant DB per campus + `SchoolERPAdminDB` |
| Labour Codes 2020, POSH, Payroll processing, Payroll KPIs | Ritu Chopra's HR compliance trackers (claude.ai artifact, tabs 6–8) via their JSON backups |
| Monthly headcount reference | `tools/manual/reference.json` (entered by hand) |

### Refreshing the data

```bash
pip install pyodbc
cp tools/sources.example.json tools/sources.json   # fill in servers; never commit this file
HR_EDU_DB_PASSWORD=... python tools/export_hr_data.py
```

Then commit `design/data/hr-data.js`, bump the `?v=` numbers in `design/index.html`, and push — GitHub Pages
republishes in about a minute.

#### Compliance trackers

The four compliance pages read Ritu's tracker backups:

1. In the tracker, open each tab and click its backup / export button:

   | Tab | Backup file |
   |-----|-------------|
   | Statutory Compliance (Labour Codes) | `compliance-backup-YYYY-MM-DD.json` |
   | POSH Compliance Ledger | `posh-compliance-backup-YYYY-MM-DD.json` |
   | Payroll → Processing Checklist | `payroll-processing-backup-YYYY-MM-DD.json` |
   | Payroll → Payroll KPIs | `payroll-kpi-backup-YYYY-MM-DD.json` |

2. Save the files in `tools/private/trackers/` (git-ignored; the newest file per tracker is used).
3. Run the exporter as above.

If the tracker's checklists change, regenerate `tools/manual/trackers/definitions.json` from the tracker.

### Definitions

- **Entities** — campuses FSK, FSM, FPV, FPA, FALH, FWGS; for compliance, **PSPL** (Protego Services Pvt. Ltd.) is a
  seventh entity. In headcount, Protego is a payroll entity across campuses ("PSPL bifurcation").
- **Academic year** runs June–May (Nucleus `AcademicYear`), the same basis as the Looker attrition report.
- **Attrition** = exits ÷ average of opening and closing headcount (churn ratio). An exit is an approved,
  non-withdrawn resignation dated by HR's last working day (support staff: resignation date).
- **Compliance %** (same as Ritu's tracker) = compliant ÷ (compliant + non-compliant) per category, using each
  check's latest status; an entity's % is the average of its category %s. Bands: 90%+ compliant, 70–89% in
  progress, below 70% needs attention.
- **Payroll entity** — FS / campus school, FET, Protego (PSPL), USET, Visiting Faculty.

### Privacy

The site and this repo are **public**.

- The exporter reads per-person rows in memory and writes **aggregate counts only** — no names, IDs, contact
  details, dates of birth or pay. Sensitive exit reasons and ticket types are grouped.
- Compliance pages show **percentages and counts per entity and category** — not which specific checks are
  non-compliant, and no remarks or "updated by" names. Raw backups stay in `tools/private/`.
- "View as Employee" is a preview, not access control. Real role-based access needs a login-protected host.

### Run locally

```bash
cd design
python -m http.server 8080
```

Open http://localhost:8080/index.html

## HR Management app (prototype)

### 1. Start the API server

```bash
cd server
npm install
npm run dev
```

The server runs at http://localhost:4000.

### 2. Start the frontend

In a separate terminal:

```bash
cd client
npm install
npm run dev
```

The app runs at http://localhost:5173 and talks to the API at http://localhost:4000.

### API endpoints

| Method | Endpoint              | Description            |
|--------|------------------------|-------------------------|
| GET    | /api/employees          | List all employees      |
| GET    | /api/employees/:id      | Get one employee        |
| POST   | /api/employees          | Create a new employee   |
| PUT    | /api/employees/:id      | Update an employee      |
| DELETE | /api/employees/:id      | Remove an employee      |

### Next steps

- Swap the JSON file store for a real database (e.g. PostgreSQL, MongoDB)
- Add authentication/login
- Add attendance, leave, and payroll modules
