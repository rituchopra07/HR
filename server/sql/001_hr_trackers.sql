/* =====================================================================
   HR Portal — shared compliance trackers (POSH, Labour Codes, Payroll)
   Creates a dedicated database, a least-privilege app login, and the tables.
   Run by a DBA with approval. Replace <STRONG-PASSWORD> before running,
   and never commit the real value.
   ===================================================================== */

IF DB_ID('HRPortalDB') IS NULL CREATE DATABASE HRPortalDB;
GO
USE HRPortalDB;
GO

/* One document per tracker × entity; Version enables optimistic locking. */
IF OBJECT_ID('dbo.HRTrackerDoc') IS NULL
CREATE TABLE dbo.HRTrackerDoc (
    Tracker    VARCHAR(40)    NOT NULL,   -- labour | posh | payroll_processing | payroll_kpi
    Entity     VARCHAR(10)    NOT NULL,   -- PSPL | FSK | FSM | FALH | FWGS | FPV | FPA
    Doc        NVARCHAR(MAX)  NOT NULL CHECK (ISJSON(Doc) = 1),   -- { items, remarks }
    Version    INT            NOT NULL,
    UpdatedBy  NVARCHAR(200)  NOT NULL,
    UpdatedAt  DATETIME2(3)   NOT NULL,
    CONSTRAINT PK_HRTrackerDoc PRIMARY KEY (Tracker, Entity)
);
GO

/* Every save is kept — an audit trail of who changed what, and a way to roll back. */
IF OBJECT_ID('dbo.HRTrackerDocHistory') IS NULL
CREATE TABLE dbo.HRTrackerDocHistory (
    Id         BIGINT IDENTITY PRIMARY KEY,
    Tracker    VARCHAR(40)    NOT NULL,
    Entity     VARCHAR(10)    NOT NULL,
    Version    INT            NOT NULL,
    Doc        NVARCHAR(MAX)  NOT NULL,
    UpdatedBy  NVARCHAR(200)  NOT NULL,
    SavedAt    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* App login: can read/write these two tables only — no server roles, no other databases. */
IF SUSER_ID('hrportal_app') IS NULL
    CREATE LOGIN hrportal_app WITH PASSWORD = '<STRONG-PASSWORD>', CHECK_POLICY = ON;
GO
IF USER_ID('hrportal_app') IS NULL CREATE USER hrportal_app FOR LOGIN hrportal_app;
GO
GRANT SELECT, INSERT, UPDATE ON dbo.HRTrackerDoc        TO hrportal_app;
GRANT SELECT, INSERT         ON dbo.HRTrackerDocHistory TO hrportal_app;
GO
