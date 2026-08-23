-- =============================================================================
--  XR Test Lab — local SQLite schema
--
--  The database file (data/xr-test-lab.db) is the permanent source of truth.
--  It survives browser restarts, server restarts, PC restarts and clearing
--  browser storage.
--
--  Deletion policy:
--    projects / students   -> archived (archivedAt) by default; permanent
--                             delete requires explicit confirmation
--    test_sessions         -> permanently deletable; ON DELETE CASCADE removes
--                             samples + checklist results, and the service
--                             layer removes the stored raw report file
--  Text timestamps are ISO-8601 UTC strings (SQLite has no native date type).
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- projects --
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  projectName    TEXT NOT NULL,
  -- lower-cased, whitespace-collapsed name: the deterministic key used to match
  -- an imported report to an existing project
  normalizedName TEXT NOT NULL UNIQUE,
  platform       TEXT NOT NULL CHECK (platform IN ('VR','AR')),
  targetFps      INTEGER NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  archivedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ---------------------------------------------------------------- students --
CREATE TABLE IF NOT EXISTS students (
  id             TEXT PRIMARY KEY,
  -- the profiler's `studentId`. NULL when blank: XRTestProfiler ships with
  -- studentId = "" so it can never be assumed present. SQLite treats NULLs as
  -- distinct, so UNIQUE gives "unique when present" for free.
  studentId      TEXT UNIQUE,
  studentName    TEXT NOT NULL,
  normalizedName TEXT NOT NULL,
  email          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  archivedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_norm ON students(normalizedName);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- --------------------------------------------------------- project_members --
CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  studentId TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role      TEXT,
  joinedAt  TEXT NOT NULL,
  PRIMARY KEY (projectId, studentId)
);
CREATE INDEX IF NOT EXISTS idx_members_student ON project_members(studentId);

-- ----------------------------------------------------------- test_sessions --
-- Append-only history: importing a new report NEVER overwrites an older one.
CREATE TABLE IF NOT EXISTS test_sessions (
  id               TEXT PRIMARY KEY,
  projectId        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  studentId        TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- provenance
  schemaVersion    TEXT NOT NULL,
  contentHash      TEXT NOT NULL UNIQUE,   -- SHA-256 of the original file bytes
  originalFilename TEXT,
  reportFile       TEXT,                   -- path under data/reports/, relative
  rawReport        TEXT NOT NULL,          -- the original JSON document, verbatim
  fileSizeBytes    INTEGER NOT NULL DEFAULT 0,
  importedAt       TEXT NOT NULL,

  -- capture context
  capturedAt       TEXT NOT NULL,
  durationSec      REAL,
  targetFps        INTEGER NOT NULL,
  platform         TEXT NOT NULL CHECK (platform IN ('VR','AR')),
  device           TEXT,
  gpu              TEXT,
  os               TEXT,
  batteryLevel     REAL,                   -- NULL when profiler reported -1
  batteryStatus    TEXT,

  -- metrics
  avgFps           REAL,
  minFps           REAL,
  onePercentLowFps REAL,
  avgFrameMs       REAL,
  droppedFrames    INTEGER,
  totalFrames      INTEGER,
  memoryMB         REAL,
  drawCalls        INTEGER,                -- NULL when profiler reported -1
  triangles        INTEGER,

  -- derived (recomputed whenever checklist/bugs change)
  captureStatus     TEXT NOT NULL CHECK (captureStatus IN ('valid','invalid')),
  performanceStatus TEXT NOT NULL CHECK (performanceStatus IN ('pass','warn','fail','neutral')),
  gradeLetter      TEXT,
  gradeScore       INTEGER,

  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON test_sessions(projectId, capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON test_sessions(studentId, capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_captured ON test_sessions(capturedAt DESC);

-- ------------------------------------------------------ performance_samples --
CREATE TABLE IF NOT EXISTS performance_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId     TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  sampleIndex   INTEGER NOT NULL,   -- position in the original series[]
  tSeconds      REAL,
  fps           REAL,
  frameMs       REAL,
  memMB         REAL,
  UNIQUE (sessionId, sampleIndex)
);
CREATE INDEX IF NOT EXISTS idx_samples_session ON performance_samples(sessionId, sampleIndex);

-- --------------------------------------------------------- checklist_items --
CREATE TABLE IF NOT EXISTS checklist_items (
  id          TEXT PRIMARY KEY,      -- 'launch', 'fps', ...
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  sortOrder   INTEGER NOT NULL,
  isActive    INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------------- checklist_results --
-- Belongs to a SESSION, so Test 1 and Test 2 have independent QA results.
CREATE TABLE IF NOT EXISTS checklist_results (
  sessionId  TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  itemId     TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  result     TEXT NOT NULL CHECK (result IN ('pass','warn','fail')),
  note       TEXT,
  assessedAt TEXT NOT NULL,
  PRIMARY KEY (sessionId, itemId)
);

-- -------------------------------------------------------------------- bugs --
-- A defect belongs to the PROJECT (it outlives a single build) with an optional
-- link to the session that surfaced it.
CREATE TABLE IF NOT EXISTS bugs (
  id             TEXT PRIMARY KEY,
  projectId      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId      TEXT REFERENCES test_sessions(id) ON DELETE SET NULL,
  studentId      TEXT REFERENCES students(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  -- 'critical' is load-bearing: shared/xr-metrics deducts grade points for
  -- critical defects. Renaming it would silently change every grade.
  severity       TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','closed')),
  resolutionNote TEXT,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  resolvedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(projectId, status);
CREATE INDEX IF NOT EXISTS idx_bugs_session ON bugs(sessionId);

-- ------------------------------------------------------------- app_meta ----
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
