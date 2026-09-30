#!/usr/bin/env python3
"""
Export AGGREGATE-ONLY HR data from Nucleus into design/data/hr-data.js.

Sources
  * Nucleus v1 (old Nucleus, DB "INVENTORY.MDF") -> campus FSK: staff, support
    staff, exits & reasons, recruitment, new joinees, HR tickets, students,
    PF/UAN and F&F compliance.
  * Nucleus EDU (one DB per campus)              -> FSM, FPV, FPA, FALH, FWGS:
    staff & support headcount, joins/exits, HR tickets, students.

Privacy
  The site is public (GitHub Pages). Per-person rows are read into memory to
  compute counts and are never written. The output holds only grouped counts;
  sensitive exit reasons are folded into broad buckets.

Usage
  python tools/export_hr_data.py                 # uses tools/sources.json
  python tools/export_hr_data.py --only v1       # skip Nucleus EDU
  HR_EDU_DB_PASSWORD=... python tools/export_hr_data.py
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

try:
    import pyodbc
except ImportError:  # pragma: no cover
    sys.exit("pyodbc is required:  pip install pyodbc")

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "tools" / "sources.json"
MANUAL_DIR = ROOT / "tools" / "manual"
TRACKER_DEFS = MANUAL_DIR / "trackers" / "definitions.json"
TRACKER_BACKUPS = ROOT / "tools" / "private" / "trackers"   # git-ignored: raw JSON backups from the tracker tabs
OUT_PATH = ROOT / "design" / "data" / "hr-data.js"

# Academic year runs June–May (Nucleus AcademicYear table; same basis as the Looker attrition report).
YEAR_START_MONTH = 6
FLOW_START = dt.date(2015, 6, 1)     # headcount / joins / exits series (attrition trend from AY 2015-16)
HISTORY_START = dt.date(2021, 6, 1)  # recruitment, tickets and joiner detail
TOP_AREAS = 40                       # recruitment "area of interest" values kept by name; the rest -> "Other positions"

CAMPUSES = [
    {"code": "FSK", "name": "Fountainhead School", "place": "Kunkni, Surat", "short": "Kunkni", "system": "Nucleus v1"},
    {"code": "FSM", "name": "Fountainhead School", "place": "Malgama", "short": "Malgama", "system": "Nucleus EDU"},
    {"code": "FPV", "name": "Fountainhead Preschool", "place": "Vesu, Surat", "short": "Vesu", "system": "Nucleus EDU"},
    {"code": "FPA", "name": "Fountainhead Preschool", "place": "Adajan, Surat", "short": "Adajan", "system": "Nucleus EDU"},
    {"code": "FALH", "name": "Fountainhead Avadh Learning Hub", "place": "Vapi", "short": "Vapi", "system": "Nucleus EDU"},
    {"code": "FWGS", "name": "Fountainhead-Wockhardt Global School", "place": "Chhatrapati Sambhajinagar", "short": "CSN", "system": "Nucleus EDU"},
]
EMPLOYERS = [
    {"code": "SCH", "name": "School entity (FS / campus school)"},
    {"code": "FET", "name": "Fountainhead Education Trust"},
    {"code": "PSPL", "name": "Protego Services Pvt. Ltd."},
    {"code": "USET", "name": "Ultimate Sports & Education Trust"},
    {"code": "VF", "name": "Visiting Faculty"},
    {"code": "OTH", "name": "Other / not set"},
]
GROUPS = ["Junior School", "Senior School", "Administration", "Support Staff"]

# Old-Nucleus company short names -> portal employer codes
V1_EMPLOYER = {"FS": "SCH", "FET": "FET", "FEP": "PSPL", "PSPL": "PSPL", "VFS": "VF", "USET": "USET"}

EXIT_FACTOR = {
    1: "Controllable", 2: "Uncontrollable", 3: "Mutual consent",
    4: "Absconded", 5: "Grey area", 6: "Internal transfer",
}
# (factor, reason) -> label. Health / death / maternity / family are folded into
# one bucket so a small campus-year count can't point at an individual.
PERSONAL = "Personal, family or health"
EXIT_REASON = {
    (1, 1): "Lack of growth opportunity", (1, 2): "Unsuited to assigned duties",
    (1, 3): "Performance review concerns", (1, 4): "Inadequate benefits",
    (1, 5): "Stress / workplace politics", (1, 6): "Unjust workload",
    (1, 7): "Better career opportunity", (1, 8): "Inadequate salary",
    (1, 9): "Dissatisfaction with supervisor",
    (2, 1): "Marriage", (2, 2): "Relocation / spouse transfer", (2, 3): "Further studies",
    (2, 4): PERSONAL, (2, 5): PERSONAL, (2, 6): PERSONAL, (2, 7): "Retirement",
    (2, 8): "Relocation / spouse transfer", (2, 9): "Contract ended", (2, 10): PERSONAL,
    (2, 11): "Other",
    (3, 1): "Conduct / performance", (3, 2): "Conduct / performance", (3, 3): "Cultural misfit",
    (4, 1): "Absconded",
    (5, 1): "Conduct / performance", (5, 2): "Cultural misfit", (5, 3): "Conduct / performance", (5, 4): "Other",
    (6, 1): "Internal transfer", (6, 2): "Internal transfer", (6, 3): "Internal transfer", (6, 4): "Internal transfer",
}


# Ticket types that could hint at a person's circumstances are shown under a neutral label.
SENSITIVE_TICKET_TYPES = {"Maternity pay not received": "Pay / allowance not received"}


# ----------------------------------------------------------------------------- helpers

def as_date(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None


def month_key(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_starts(start: dt.date, end: dt.date):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield dt.date(y, m, 1)
        m += 1
        if m == 13:
            y, m = y + 1, 1


def acad_year(d: dt.date) -> str:
    """Academic year label, June–May: 2025-06-01 -> '2025-26'."""
    y = d.year if d.month >= YEAR_START_MONTH else d.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def generation(dob):
    if not dob or dob.year < 1935 or dob.year > 2012:
        return "Unknown"
    y = dob.year
    if y >= 1997:
        return "Gen Z"
    if y >= 1981:
        return "Millennial"
    if y >= 1965:
        return "Gen X"
    return "Boomer"


def age_band(dob, on):
    if not dob or dob.year < 1935 or dob.year > 2012:
        return "Unknown"
    age = on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))
    for limit, label in ((25, "<25"), (35, "25–34"), (45, "35–44"), (55, "45–54"), (58, "55–57")):
        if age < limit:
            return label
    return "58+"


def tenure_band(doj, on):
    if not doj:
        return "Unknown"
    yrs = (on - doj).days / 365.25
    for limit, label in ((1, "<1 yr"), (3, "1–3 yrs"), (5, "3–5 yrs"), (10, "5–10 yrs")):
        if yrs < limit:
            return label
    return "10+ yrs"


def clean(s, default="Unspecified"):
    if s is None:
        return default
    s = " ".join(str(s).split())
    return s or default


def norm_group(g):
    g = clean(g, "")
    low = g.lower()
    if "junior" in low:
        return "Junior School"
    if "senior" in low:
        return "Senior School"
    if "support" in low:
        return "Support Staff"
    if low:
        return "Administration"
    return "Administration"


def connect(cfg, database, driver):
    parts = [f"DRIVER={{{driver}}}", f"SERVER={cfg['server']}", f"DATABASE={{{database}}}",
             "TrustServerCertificate=yes", "ApplicationIntent=ReadOnly"]
    if cfg.get("trusted_connection"):
        parts.append("Trusted_Connection=yes")
    else:
        pwd = os.environ.get(cfg.get("password_env", ""), cfg.get("password"))
        if not pwd:
            raise RuntimeError(f"Set the {cfg.get('password_env')} environment variable for {cfg['server']}")
        parts += [f"UID={cfg['user']}", f"PWD={pwd}"]
    conn = pyodbc.connect(";".join(parts), timeout=20, readonly=True)
    return conn


def rows(conn, sql, *params):
    cur = conn.cursor()
    cur.execute(sql, *params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


class Cube:
    """Counts keyed by a tuple of dimensions; emitted as a list of dicts."""

    def __init__(self, dims, measures=("n",)):
        self.dims, self.measures = dims, measures
        self.data = defaultdict(lambda: [0] * len(measures))

    def add(self, key, *vals):
        vals = vals or (1,)
        cell = self.data[tuple(key)]
        for i, v in enumerate(vals):
            cell[i] += v

    def out(self):
        """Columnar: {"k": [dims..., measures...], "r": [[...], ...]} — ~60% smaller than row objects."""
        res = []
        for key, vals in sorted(self.data.items(), key=lambda kv: tuple(str(k) for k in kv[0])):
            if not any(vals):
                continue
            res.append(list(key) + [round(v, 1) if isinstance(v, float) else v for v in vals])
        return {"k": list(self.dims) + list(self.measures), "r": res}


# ----------------------------------------------------------------------------- people model

class Person:
    __slots__ = ("src", "campus", "kind", "emp", "grp", "dept", "sex", "dob", "doj", "exit", "active",
                 "factor", "reason", "fnf", "uan", "pf_eligible", "induction", "intro_mail")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


def load_v1(conn, campus, as_of, notes):
    people = []
    staff = rows(conn, """
        SELECT s.StaffMasterID AS id, s.Sex AS sex, s.DateOfBirth AS dob, ISNULL(s.IsInvalid,0) AS inv,
               s.IsStaffInductionCompleted AS ind, s.IsIntroductoryMailSend AS mail,
               sod.DateOfJoin AS doj, sod.CompanyEntityName AS comp, sod.UANNo AS uan,
               og.GroupName AS grp, dep.DepartmentName AS dept,
               r.HRLastWorkingDate AS lwd, r.SeparationOrResignationDueTo AS due,
               r.SeparationOrResignationReason AS rsn, r.FinalSettlement AS fnf
        FROM Staff s
        CROSS APPLY (SELECT TOP 1 * FROM StaffOrganizationalDetails x WHERE x.StaffID = s.StaffMasterID) sod
        LEFT JOIN OrganizationGroup og ON og.OrganizationGroupID = sod.OrganizationaGroupID
        OUTER APPLY (SELECT TOP 1 od.DepartmentName FROM StaffDepartment sd
                     JOIN OrganizationDepartment od ON od.OrganizationDepartmentID = sd.OrganizationDepartmentID
                     WHERE sd.StaffId = s.StaffMasterID ORDER BY ISNULL(od.IsDeleted,0), sd.OrganizationDepartmentID) dep
        OUTER APPLY (SELECT TOP 1 * FROM StaffResignation rr
                     WHERE rr.StaffID = s.StaffMasterID AND rr.IsApproved = 1 AND ISNULL(rr.isWithdrawn,0) = 0
                     ORDER BY rr.HRLastWorkingDate DESC) r
        WHERE ISNULL(s.IsSystemAccount,0) = 0
    """)
    unknown_exit = 0
    for r in staff:
        active = r["inv"] == 0
        lwd = as_date(r["lwd"])
        exit_d = None
        if not active:
            if lwd:
                exit_d = lwd
            else:
                unknown_exit += 1
                continue  # inactive with no exit record: can't place in history
        elif lwd and lwd > as_of:
            exit_d = None  # serving notice; still active on the snapshot date
        people.append(Person(
            src="v1", campus=campus, kind="staff", emp=V1_EMPLOYER.get(clean(r["comp"], ""), "OTH"),
            grp=norm_group(r["grp"]), dept=clean(r["dept"]),
            sex="M" if r["sex"] else "F", dob=as_date(r["dob"]), doj=as_date(r["doj"]),
            exit=exit_d, active=active, factor=r["due"], reason=r["rsn"], fnf=r["fnf"],
            uan=bool(clean(r["uan"], "")), induction=r["ind"], intro_mail=r["mail"]))
    if unknown_exit:
        notes.append(f"{campus}: {unknown_exit} inactive staff records have no exit date and are left out of history.")

    support = rows(conn, """
        SELECT ss.SupportStaffID AS id, ss.Sex AS sex, ss.DateOfBirth AS dob, ss.DateOfJoin AS doj,
               ISNULL(ss.IsVoid,0) AS void, ss.DateOfResign AS dor, ss.CompanyEntityName AS comp,
               od.DepartmentName AS dept, so.PFEligibility AS pfe, so.UANNo AS uan
        FROM SupportStaffBasicInfo ss
        LEFT JOIN OrganizationDepartment od ON od.OrganizationDepartmentID = ss.OrganizationDepartmentID
        OUTER APPLY (SELECT TOP 1 * FROM SupportStaffOtherDetails o WHERE o.SupportStaffID = ss.SupportStaffID) so
    """)
    for r in support:
        dor = as_date(r["dor"])
        active = r["void"] == 0 or (dor is not None and dor > as_of)
        if not active and not dor:
            continue
        people.append(Person(
            src="v1", campus=campus, kind="support", emp=V1_EMPLOYER.get(clean(r["comp"], ""), "OTH"),
            grp="Support Staff", dept=clean(r["dept"]),
            sex="M" if r["sex"] else "F", dob=as_date(r["dob"]), doj=as_date(r["doj"]),
            exit=None if active else dor, active=active,
            uan=bool(clean(r["uan"], "")), pf_eligible=r["pfe"] == 1))
    return people


def edu_employer(code):
    c = clean(code, "").upper()
    if not c:
        return "OTH"
    if c in ("PSPL", "FEP") or "PROTEGO" in c:
        return "PSPL"
    if c == "FET":
        return "FET"
    if c == "USET":
        return "USET"
    if c.endswith("VF") or c.startswith("VF"):
        return "VF"
    return "SCH"


def load_edu(conn, campus, as_of, lookups):
    groups, depts = lookups
    people = []
    staff = rows(conn, """
        SELECT s.Gender AS sex, s.DateOfBirth AS dob, s.DateOfJoin AS doj, s.ResignationDate AS dor,
               s.GroupID AS gid, s.DepartmentID AS did, cm.CompanyShortName AS comp
        FROM Staff s LEFT JOIN CompanyMaster cm ON cm.CompanyMasterID = s.CompanyID
        WHERE ISNULL(s.IsTest,0) = 0
    """)
    support = rows(conn, """
        SELECT s.Gender AS sex, s.DateOfBirth AS dob, s.DateOfJoin AS doj, s.DateOfResign AS dor,
               s.GroupID AS gid, s.DepartmentID AS did, cm.CompanyShortName AS comp
        FROM SupportStaffDetails s LEFT JOIN CompanyMaster cm ON cm.CompanyMasterID = s.CompanyMasterID
    """)
    for kind, src in (("staff", staff), ("support", support)):
        for r in src:
            dor = as_date(r["dor"])
            active = dor is None or dor > as_of
            grp = "Support Staff" if kind == "support" else norm_group(groups.get(r["gid"]))
            people.append(Person(
                src="edu", campus=campus, kind=kind, emp=edu_employer(r["comp"]), grp=grp,
                dept=clean(depts.get(r["did"])), sex="M" if r["sex"] else "F",
                dob=as_date(r["dob"]), doj=as_date(r["doj"]), exit=None if active else dor, active=active))
    return people


# ----------------------------------------------------------------------------- non-people facts

def ticket_rows(raw, campus, as_of, cube):
    for r in raw:
        created = as_date(r["created"])
        if not created or created < HISTORY_START:
            continue
        done = as_date(r["done"])
        due = as_date(r["due"])
        if not r["status"] or done is None:
            sla = "Open · overdue" if due and due < as_of else "Open · on time"
            tat_sum, tat_n = 0.0, 0
        else:
            sla = "Closed · within SLA" if not due or done <= due else "Closed · late"
            tat_sum, tat_n = max((r["done"] - r["created"]).total_seconds() / 86400.0, 0.0), 1
        issue = clean(r["issue"])
        cube.add((month_key(created), campus, norm_group(r.get("grp")) if r.get("grp") else "Unspecified",
                  SENSITIVE_TICKET_TYPES.get(issue, issue), sla), 1, tat_sum, tat_n)


def load_v1_facts(conn, campus, as_of, out):
    status = {r["v"]: clean(r["t"]) for r in rows(conn, "SELECT RecruitmentStatusValue AS v, RecruitmentStatusText AS t FROM StaffRecruitmentStatus")}
    rec = rows(conn, """
        SELECT b.DateOfApplication AS d, b.Title AS grp, d.Status AS st, v.VacancyName AS area
        FROM StaffBuffer b
        LEFT JOIN StaffBasicDetails d ON d.StaffBufferID = b.EmployeeBufferID
        OUTER APPLY (SELECT TOP 1 ISNULL(a.ChangedVacanciesIdByHr, a.VacanciesId) AS vid
                     FROM StaffAdditionalDetails a WHERE a.StaffBufferID = b.EmployeeBufferID) ad
        LEFT JOIN StaffVacancies v ON v.VacanciesId = ad.vid
    """)
    apps = []  # (applied_on, row) within the reporting window
    for r in rec:
        d = as_date(r["d"])
        if d is not None and d >= HISTORY_START:
            apps.append((d, r))
    area_counts = defaultdict(int)
    for _, r in apps:
        area_counts[clean(r["area"], "Not specified")] += 1
    keep = set(sorted(area_counts, key=lambda a: area_counts[a], reverse=True)[:TOP_AREAS])
    for d, r in apps:
        g = clean(r["grp"], "Unspecified")
        g = "Academic (any)" if g.lower() == "academic" else (norm_group(g) if g != "Unspecified" else g)
        area = clean(r["area"], "Not specified")
        out["recruitment"].add((month_key(d), campus, g, area if area in keep else "Other positions",
                                status.get(r["st"], "Application Received" if r["st"] is None else "Other")))

    for r in rows(conn, """SELECT ProgramName AS prog, COUNT(*) AS n FROM StudentCurrentGradeSectionDetails
                           WHERE ISNULL(IsVoid,0) = 0 GROUP BY ProgramName"""):
        out["students_by_programme"].append({"c": campus, "prog": clean(r["prog"]), "n": r["n"]})

    tickets = rows(conn, """
        SELECT t.EntryDateTime AS created, t.CompletionDate AS done, t.DueDate AS due,
               t.CompletionStatus AS status, i.Issue AS issue, og.GroupName AS grp
        FROM TicketEntry t
        LEFT JOIN TicketIssue i ON i.TicketIssueID = t.TicketIssueID
        OUTER APPLY (SELECT TOP 1 x.OrganizationaGroupID FROM StaffOrganizationalDetails x
                     WHERE x.StaffID = t.EntryDoneBy AND ISNULL(t.EntityType,0) = 0) sod
        LEFT JOIN OrganizationGroup og ON og.OrganizationGroupID = sod.OrganizationaGroupID
        WHERE t.DepartmentID = 6
    """)
    ticket_rows(tickets, campus, as_of, out["tickets"])

    n = rows(conn, "SELECT COUNT(*) AS n FROM StudentCurrentGradeSectionDetails WHERE ISNULL(IsVoid,0) = 0")[0]["n"]
    out["students"].append({"c": campus, "n": n, "basis": "Current academic year, active enrolments"})


def load_edu_facts(conn, campus, as_of, out, default_ay):
    try:
        tickets = rows(conn, """
            SELECT t.CreatedDate AS created, t.CompletionDate AS done, t.DueDate AS due,
                   t.CompletionStatus AS status, i.Issue AS issue
            FROM TicketEntry t
            JOIN TicketDepartmentMaster dm ON dm.TicketDepartmentID = t.DepartmentID
            LEFT JOIN TicketIssue i ON i.TicketIssueId = t.TicketIssueID
            WHERE ISNULL(t.IsDelete,0) = 0 AND ISNULL(dm.IsDelete,0) = 0
              AND (dm.DepartmentName LIKE '%HR%' OR dm.DepartmentName LIKE '%Human%')
        """)
        ticket_rows(tickets, campus, as_of, out["tickets"])
    except pyodbc.Error as e:  # schema drift on a tenant DB shouldn't kill the export
        out["notes"].append(f"{campus}: HR tickets skipped ({e.args[0]}).")
    ay_id, ay_label = default_ay
    n = rows(conn, "SELECT COUNT(DISTINCT StudentID) AS n FROM StudentYearlyDetails WHERE AcademicYearID = ?", ay_id)[0]["n"]
    out["students"].append({"c": campus, "n": n, "basis": f"AY {ay_label} enrolments"})


# ----------------------------------------------------------------------------- aggregation

def build(people, as_of_by_campus, out):
    headcount = Cube(("c", "e", "g", "s", "x"))
    gen = Cube(("c", "e", "g", "gen"))
    age = Cube(("c", "e", "g", "ab"))
    ten = Cube(("c", "e", "g", "ten"))
    flow = Cube(("m", "c", "e", "g"), ("hc", "j", "x", "xt"))
    reasons = Cube(("ay", "c", "factor", "reason"))
    # elig = joiners whose induction is tracked (old-Nucleus teaching & admin staff)
    joiners = Cube(("m", "c", "e", "g", "s"), ("n", "elig", "ind", "mail"))
    comp = Cube(("c", "e", "kind", "metric"), ("num", "den"))
    fnf = Cube(("ay", "c"), ("num", "den"))

    by_campus = defaultdict(list)
    for p in people:
        by_campus[p.campus].append(p)

    for campus, plist in by_campus.items():
        on = as_of_by_campus[campus]
        months = list(month_starts(FLOW_START, on))
        for p in plist:
            if p.active:
                headcount.add((campus, p.emp, p.grp, p.dept, p.sex))
                gen.add((campus, p.emp, p.grp, generation(p.dob)))
                age.add((campus, p.emp, p.grp, age_band(p.dob, on)))
                ten.add((campus, p.emp, p.grp, tenure_band(p.doj, on)))
                comp.add((campus, p.emp, p.kind, "UAN captured"), 1 if p.uan else 0, 1)
                if p.kind == "support" and p.pf_eligible is not None:
                    if p.pf_eligible:
                        comp.add((campus, p.emp, p.kind, "PF-eligible with UAN"), 1 if p.uan else 0, 1)
            transfer = p.factor == 6
            for m in months:
                nxt = dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
                on_roll = p.doj and p.doj < m and (p.exit is None or p.exit >= m)
                joined = p.doj and m <= p.doj < nxt
                left = p.exit and m <= p.exit < nxt
                if on_roll or joined or left:
                    flow.add((month_key(m), campus, p.emp, p.grp),
                             1 if on_roll else 0, 1 if joined else 0,
                             1 if left and not transfer else 0, 1 if left and transfer else 0)
            if p.doj and p.doj >= HISTORY_START and p.doj <= on:
                tracked = p.src == "v1" and p.kind == "staff"
                joiners.add((month_key(p.doj), campus, p.emp, p.grp, p.dept), 1, 1 if tracked else 0,
                            1 if tracked and p.induction else 0, 1 if tracked and p.intro_mail else 0)
            # Exit reasons & F&F exist only for old-Nucleus teaching/admin staff.
            if p.src == "v1" and p.kind == "staff" and p.exit and p.exit >= FLOW_START:
                ay = acad_year(p.exit)
                factor = EXIT_FACTOR.get(p.factor or 0, "Not recorded")
                reason = EXIT_REASON.get((p.factor or 0, p.reason or 0), "Not recorded")
                reasons.add((ay, campus, factor, reason))
                fnf.add((ay, campus), 1 if p.fnf == 1 else 0, 1)

    out["headcount"] = headcount.out()
    out["generations"] = gen.out()
    out["age_bands"] = age.out()
    out["tenure_bands"] = ten.out()
    out["flow"] = flow.out()
    out["exit_reasons"] = reasons.out()
    out["joiners"] = joiners.out()
    out["compliance_nucleus"] = comp.out()
    out["fnf"] = fnf.out()


# ----------------------------------------------------------------------------- compliance trackers

def _latest(value, periods, rule):
    """Status of one checklist item: a plain string, or {period: status} -> latest non-blank period."""
    if not isinstance(value, dict):
        return value or ""
    order = periods if rule == "first" else list(reversed(periods))   # "first": list is already latest-first
    for p in order:
        if value.get(p):
            return value[p]
    return ""


def _cat_pct(statuses, st):
    yes = sum(1 for s in statuses if s == st["yes"])
    no = sum(1 for s in statuses if s == st["no"])
    na = sum(1 for s in statuses if s == st["na"])
    return {"yes": yes, "no": no, "na": na, "blank": len(statuses) - yes - no - na,
            "pct": round(yes / (yes + no) * 100) if yes + no else None}


def _api_bundle(api, tid):
    """Backup bundle for one tracker from the shared tracker API (server/), or None."""
    import urllib.request
    token = os.environ.get(api.get("token_env", "HR_TRACKER_API_TOKEN"), "")
    if not api.get("url") or not token:
        return None
    req = urllib.request.Request(api["url"].rstrip("/") + f"/trackers/{tid}/backup", headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def build_trackers(notes, publish_items=False, api=None):
    """Aggregate Ritu's tracker backups the way her dashboard does:
    category % = C / (C + NC) on each item's latest status; entity % = mean of category %s.
    Published: percentages and counts only — no remarks, no 'updated by', item statuses only if publish_items."""
    if not TRACKER_DEFS.exists():
        return None
    defs = json.loads(TRACKER_DEFS.read_text(encoding="utf-8"))
    keymap = defs.get("entity_keys", {})               # portal code -> key used inside the backup
    out = {"source": defs.get("source"), "entity_keys": keymap, "trackers": {}}
    for tid, t in defs["trackers"].items():
        cats = t["categories"]
        sizes = [len(c["items"]) if "items" in c else c["item_count"] for c in cats]
        pub = {"title": t["title"], "entities": t["entities"], "periods": t.get("periods"),
               # what the portal's editor needs to read/write the same documents as Ritu's tracker
               "statuses": t["statuses"], "latest": t.get("latest", "last"), "backup_prefix": t["backup_prefix"],
               "categories": [{"title": c["title"], "n": n, **({"items": c["items"]} if "items" in c else {})}
                              for c, n in zip(cats, sizes)],
               "status": "pending", "as_of": None, "rows": [], "overall": {}, "flagged": {}, "trend": []}
        # source: the shared tracker API when configured, else the newest backup file
        raw, label = None, None
        if api:
            try:
                raw, label = _api_bundle(api, tid), "shared database"
            except Exception as e:  # noqa: BLE001 — fall back to files, but say so
                notes.append(f"{t['title']}: tracker API unavailable ({e}); used backup files.")
        files = sorted(TRACKER_BACKUPS.glob(t["backup_prefix"] + "*.json")) if TRACKER_BACKUPS.exists() else []
        if raw is None and files:
            raw, label = json.loads(files[-1].read_text(encoding="utf-8")), files[-1].name
        if raw is not None:
            ents = raw.get("entities", {})
            stamps = []
            for e in t["entities"]:
                data = ents.get(keymap.get(e, e)) or ents.get(e)
                if not data:
                    continue
                items = data.get("items", {})
                if (data.get("meta") or {}).get("updatedAt"):
                    stamps.append(data["meta"]["updatedAt"][:10])
                cat_pcts = []
                for ci, n in enumerate(sizes):
                    sts = [_latest(items.get(f"{ci}-{ii}"), t.get("periods") or [], t.get("latest", "last")) for ii in range(n)]
                    s = _cat_pct(sts, t["statuses"])
                    pub["rows"].append({"e": e, "ci": ci, **s})
                    if s["pct"] is not None:
                        cat_pcts.append(s["pct"])
                    if publish_items:
                        pub.setdefault("items", []).append({"e": e, "ci": ci, "s": sts})
                pub["overall"][e] = round(sum(cat_pcts) / len(cat_pcts)) if cat_pcts else None
                pub["flagged"][e] = sum(r["no"] for r in pub["rows"] if r["e"] == e)
                for p in t.get("periods") or []:          # month-by-month entity % (monthly trackers)
                    per = []
                    for ci, n in enumerate(sizes):
                        sts = [(items.get(f"{ci}-{ii}") or {}).get(p, "") if isinstance(items.get(f"{ci}-{ii}"), dict) else "" for ii in range(n)]
                        pc = _cat_pct(sts, t["statuses"])["pct"]
                        if pc is not None:
                            per.append(pc)
                    if per:
                        pub["trend"].append({"e": e, "p": p, "pct": round(sum(per) / len(per))})
            pub["status"] = "ready" if pub["rows"] else "pending"
            pub["as_of"] = max(stamps) if stamps else (raw.get("exportedAt") or "")[:10] or None
            print(f"  tracker {tid}: {label} ({len(pub['overall'])} entities)")
        else:
            notes.append(f"{t['title']}: no backup yet — save the tab's JSON backup into tools/private/trackers/.")
        out["trackers"][tid] = pub
    return out


# ----------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(CONFIG_PATH))
    ap.add_argument("--only", choices=["v1", "edu"], help="export just one source")
    ap.add_argument("--as-of-v1", help="snapshot date for Nucleus v1 (YYYY-MM-DD); default: latest activity in the DB")
    args = ap.parse_args()

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        sys.exit(f"Missing {cfg_path}. Copy tools/sources.example.json and fill it in.")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    driver = cfg.get("odbc_driver", "ODBC Driver 17 for SQL Server")
    today = dt.date.today()

    facts = {"recruitment": Cube(("m", "c", "g", "area", "st")),
             "tickets": Cube(("m", "c", "g", "type", "sla"), ("n", "tat_sum", "tat_n")),
             "students": [], "students_by_programme": [], "notes": []}
    people, sources, as_of_by_campus = [], [], {}

    if args.only in (None, "v1") and cfg.get("nucleus_v1"):
        v1 = cfg["nucleus_v1"]
        campus = v1.get("campus", "FSK")
        with connect(v1, v1["database"], driver) as conn:
            if args.as_of_v1:
                as_of = dt.date.fromisoformat(args.as_of_v1)
            else:
                last = rows(conn, "SELECT MAX(EntryDateTime) AS d FROM TicketEntry")[0]["d"]
                as_of = min(as_date(last) or today, today)
            as_of_by_campus[campus] = as_of
            people += load_v1(conn, campus, as_of, facts["notes"])
            load_v1_facts(conn, campus, as_of, facts)
        sources.append({"campus": campus, "system": "Nucleus v1", "database": v1["database"], "as_of": as_of.isoformat()})
        print(f"  {campus}: Nucleus v1 as of {as_of}")

    if args.only in (None, "edu") and cfg.get("nucleus_edu"):
        edu = cfg["nucleus_edu"]
        with connect(edu, edu.get("admin_database", "SchoolERPAdminDB"), driver) as admin:
            groups = {r["id"]: r["name"] for r in rows(admin, "SELECT OrganizationGroupID AS id, GroupName AS name FROM OrganizationGroup")}
            depts = {r["id"]: r["name"] for r in rows(admin, "SELECT OrganizationDepartmentID AS id, DepartmentName AS name FROM OrganizationDepartment")}
            ay = rows(admin, "SELECT TOP 1 AcademicYearID AS id, AcademicYear AS label FROM AcademicYear "
                             "WHERE IsDefault = 1 AND ISNULL(IsDeleted,0) = 0 ORDER BY AcademicYearID DESC")
            default_ay = (ay[0]["id"], ay[0]["label"]) if ay else (None, "current")
        for campus, db in edu["campuses"].items():
            try:
                with connect(edu, db, driver) as conn:
                    as_of_by_campus[campus] = today
                    people += load_edu(conn, campus, today, (groups, depts))
                    load_edu_facts(conn, campus, today, facts, default_ay)
                sources.append({"campus": campus, "system": "Nucleus EDU", "database": db, "as_of": today.isoformat()})
                print(f"  {campus}: Nucleus EDU ({db}) as of {today}")
            except pyodbc.Error as e:
                facts["notes"].append(f"{campus}: not exported ({e.args[0]}).")
                print(f"  {campus}: FAILED — {e}", file=sys.stderr)

    out = {"recruitment": facts["recruitment"].out(), "tickets": facts["tickets"].out(),
           "students": facts["students"], "students_by_programme": facts["students_by_programme"]}
    build(people, as_of_by_campus, out)

    manual = {}
    for f in sorted(MANUAL_DIR.glob("*.json")):
        manual[f.stem] = json.loads(f.read_text(encoding="utf-8"))

    data = {
        "meta": {
            "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
            "sample": False,
            "flow_start": month_key(FLOW_START),
            "history_start": month_key(HISTORY_START),
            "year_start_month": YEAR_START_MONTH,
            "sources": sources,
            "notes": facts["notes"],
            "privacy": "Aggregate counts only. No names, IDs, contact details, dates of birth or pay.",
        },
        "campuses": CAMPUSES, "employers": EMPLOYERS, "groups": GROUPS,
        **out,
        "reference": manual.get("reference", {}).get("headcount_reference"),
        "compliance": build_trackers(facts["notes"], bool(cfg.get("publish_tracker_items")), cfg.get("tracker_api")),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)
    OUT_PATH.write_text(
        "/* Generated by tools/export_hr_data.py — aggregate HR counts only. Do not edit by hand. */\n"
        f"window.HR_DATA = {payload};\n", encoding="utf-8")
    active = sum(1 for p in people if p.active)
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} — {active} active people across {len(as_of_by_campus)} campuses, "
          f"{len(payload) // 1024} KB")


if __name__ == "__main__":
    main()
