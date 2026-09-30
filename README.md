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

**Global search** (Search button, <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd> or <kbd>/</kbd>) finds reports, policies and
their documents, every compliance checklist item (opens the editor on that exact row), campus / entity / section
filters and date presets (applied in one click), and ticket types, exit reasons and recruitment areas. Everyday words
work too ("turnover", "gen z", "helpdesk"). In the Employee view it searches policies only.

### Project structure

```
HR/
├── design/                        # HR Portal (static site)
│   ├── index.html                 # app shell (top nav + nested sidebar)
│   ├── assets/portal.css          # design system ("The Register")
│   ├── assets/portal.js           # router, filters, charts, report views, compliance editors
│   ├── assets/config.js           # trackerApi: "" = browser storage, URL = shared database
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
└── server/                        # Express API: employees (prototype) + tracker API (shared compliance data)
    ├── routes/trackers.js, routes/auth.js
    ├── lib/                       # auth (bcrypt + JWT), validation, file / Postgres / SQL Server store
    ├── sql/postgres/001_hr_trackers.sql  # Postgres: tables, least-privilege login, row-level security
    ├── sql/001_hr_trackers.sql    # SQL Server alternative
    └── scripts/add-user.js        # add an HR user
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

#### Compliance trackers (POSH, Labour Codes, Payroll)

Each tracker page has two views, mirroring Ritu's tracker (claude.ai artifact, tabs 6–8):

- **Overview** — entity cards (ring %, non-compliant / pending count; click to edit), category × entity heat table,
  month-by-month view.
- **Update entity report** — pick the entity; set a status per checklist item (per month for POSH, Payroll processing
  and Payroll KPIs; one status for Labour Codes); remarks / corrective action per category; auto-saves; **Download
  backup (.json)** and **Restore from backup** use the same file format as Ritu's tracker, so data moves both ways.

Where edits are saved is set in `design/assets/config.js`:

| `trackerApi` | Behaviour |
|--------------|-----------|
| `""` (today) | Saved in the browser of whoever edits. Hand over with Download backup. |
| API URL | Shared database: HR users sign in, everyone sees the same entries, every save is stamped with who/when and versioned (a stale save is refused, not overwritten). |

The editors are hidden in the Employee view.

#### Tracker API — shared database (`server/`)

The API stores tracker documents in **PostgreSQL** (recommended — the same database the Nucleus prototypes and
the websites project use). SQL Server is also supported.

1. Create a Postgres database. Recommended: **Supabase, Mumbai region** (managed Postgres with backups; keeps data
   in India). Railway (where the Nucleus prototypes run), AWS RDS or a self-hosted Postgres work the same way.
2. Run `server/sql/postgres/001_hr_trackers.sql` as the database owner (Supabase: SQL editor). It creates the
   tracker tables, a least-privilege `hrportal_app` login (set its password in the script first, then remove it
   from the saved query) and row-level security so Supabase's public REST API can't read the data.
   Then run `server/sql/postgres/002_hr_users.sql` (sign-in users; no passwords in it).
3. Configure `server/.env` from `server/.env.example` — `HR_JWT_SECRET`, `HR_ALLOWED_ORIGINS`,
   `HR_TRACKER_STORE=postgres`, `HR_DATABASE_URL` (Supabase → Connect → **Session pooler**, user
   `hrportal_app.<project-ref>`) and `HR_DB_SSL_CA` (Supabase's CA certificate, `server/certs/supabase-ca.crt`).
   Check it with `node scripts/check-db.js`.
4. Add HR users. Passwords are prompted and stored only as bcrypt hashes, in the database's `hr_users` table
   (or git-ignored `server/data/hr-users.json` without a database):
   ```bash
   cd server && npm install
   node scripts/add-user.js ritu.chopra@fountainheadschools.org "Ritu Chopra" admin
   node scripts/add-user.js --list                 # --disable <email> / --enable <email>; --import moves hr-users.json in
   ```
   Disabling someone stops their open session within a minute. People are disabled, never deleted.
5. Deploy the server over **HTTPS**. Railway: the repo root has `railway.json`, which builds `server/Dockerfile`
   (only the API, its CA certificate and the checklist definitions go in; `.railwayignore` keeps secrets and
   local data out). From the repo root:
   ```bash
   npm i -g @railway/cli
   railway login
   railway init --name hr-portal-api
   railway up
   railway domain
   ```
   Set the variables in Railway (service → Variables → Raw Editor): `NODE_ENV=production`, a **new**
   `HR_JWT_SECRET`, `HR_ALLOWED_ORIGINS=https://rituchopra07.github.io` and the database settings from step 3.
   Pick the Singapore region (nearest to Supabase Mumbai). In production the employee CRUD prototype is off.
   Then set `trackerApi` in `design/assets/config.js` to `https://<host>/api`.
6. Optional: set `tracker_api` in `tools/sources.json` so the exporter publishes % straight from the database.

SQL Server instead: run `server/sql/001_hr_trackers.sql` and set `HR_TRACKER_STORE=mssql` with the `HR_DB_*` settings.

Endpoints: `POST /api/auth/login`, `GET /api/trackers/:tracker`, `GET|PUT /api/trackers/:tracker/:entity`,
`GET /api/trackers/:tracker/backup`. Every tracker route needs a signed-in HR user. Hosting needs approval.

#### Publishing compliance % from backups

Without the shared database, the published figures come from backups:

1. In Ritu's tracker (or the portal's editor), open each tab and click its backup / export button:

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
- Published compliance figures are **percentages and counts per entity and category** — not which specific checks
  are non-compliant, and no remarks or "updated by" names. Raw backups stay in `tools/private/`. Item-level entries
  live only in the editor's storage (the editor's browser, or the signed-in shared database).
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
