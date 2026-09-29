# HR Management System

Two parts live in this repo:

- **Fountainhead HR Portal** (`design/`) — the group-wide HR site for Central HR: headcount, demographics,
  hiring & onboarding, attrition & exit reasons, HR tickets, statutory data and the employee-facing
  Policies & Guidelines library. Static site, published on GitHub Pages:
  https://rituchopra07.github.io/HR/design/index.html
- **HR Management app** (`client/` + `server/`) — an early React/Express employee CRUD prototype.

## Project structure

```
HR/
├── design/                 # HR Portal (static site)
│   ├── index.html          # app shell (top nav + nested sidebar)
│   ├── assets/portal.css   # design system ("The Register")
│   ├── assets/portal.js    # router, filters, charts, report views
│   └── data/hr-data.js     # GENERATED aggregate data (do not edit by hand)
├── tools/
│   ├── export_hr_data.py   # builds design/data/hr-data.js from Nucleus
│   ├── sources.example.json# connection template (copy to sources.json — git-ignored)
│   └── manual/             # hand-entered aggregates (reference headcount, compliance tracker)
├── client/                 # React (Vite) frontend (prototype)
└── server/                 # Express API server (prototype)
```

## HR Portal

### Refreshing the data

The portal reads `design/data/hr-data.js`, produced by `tools/export_hr_data.py` from:

| Campus | System | Database |
|--------|--------|----------|
| FSK | Nucleus v1 (old Nucleus) | `INVENTORY.MDF` |
| FSM, FPV, FPA, FALH, FWGS | Nucleus EDU | one tenant DB per campus + `SchoolERPAdminDB` |

```bash
pip install pyodbc
cp tools/sources.example.json tools/sources.json   # then fill in servers; never commit this file
HR_EDU_DB_PASSWORD=... python tools/export_hr_data.py
```

Commit the regenerated `design/data/hr-data.js` and bump the `?v=` numbers in `design/index.html`.

**Privacy:** the site is public. The exporter reads per-person rows in memory but writes **aggregate
counts only** — no names, IDs, contact details, dates of birth or pay. Sensitive exit reasons are grouped.
The "View as Employee" switch is a preview of what employees will see, not access control; real
role-based access needs a login-protected host.

### Definitions

- **Academic year** runs June–May (Nucleus `AcademicYear`), the same basis as the Looker attrition report.
- **Attrition** = exits ÷ average of opening and closing headcount (churn ratio). An exit is an approved,
  non-withdrawn resignation dated by HR's last working day (support staff: resignation date).
- **Payroll entity**: FS / campus school, FET, Protego (PSPL), USET, Visiting Faculty.

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
