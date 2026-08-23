/**
 * Excel export — one worksheet, one row per test session.
 *
 * This is an overall XR testing report, not a database dump: every useful fact
 * about a session (its application, tester metadata, metrics, XR validation
 * results and — locally — the defect summary) is flattened onto a single row so
 * a QA lead can filter and sort a whole test campaign in one place.
 *
 * Two row sources feed the same builder:
 *   rowsFromDb()               local mode, straight from SQLite
 *   rowsFromAnalysisSession()  hosted mode, from a temporary analysis session
 *
 * Tester name / ID / email are OPTIONAL metadata. They are exported when the
 * profiler supplied them and left blank otherwise; nothing requires them.
 */
import ExcelJS from 'exceljs';
import { getDb } from '../db/index.js';
import { CHECKLIST, computeGrade, badFramePct } from '../../../shared/xr-metrics/index.js';

export const SHEET_NAME = 'ImmersiTest - Overall Report';

const RESULT_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
const STATUS_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: '—' };

/** Column titles for the eight XR validation items, in rubric order. */
const CHECK_COLUMNS = {
  launch: 'Application Stability',
  fps: 'Performance Stability',
  track: 'Tracking & Input',
  interact: 'Core Interaction',
  comfort: 'Comfort & Motion',
  ui: 'UI Readability',
  audio: 'Spatial Audio',
  exit: 'Exit / Reset',
};

const DATE_FMT = 'dd-mmm-yyyy hh:mm';
const asDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const round = (v, dp) => (v == null ? null : Number(Number(v).toFixed(dp)));

/* ------------------------------------------------------------ row sources -- */

/**
 * Normalised row consumed by buildWorkbook().
 * @typedef {object} ExportRow
 * @property {object} metrics    shape accepted by computeGrade()
 * @property {object} checklist  { itemId: 'pass'|'warn'|'fail' }
 * @property {object} [defects]  severity/status counts, local mode only
 */

/** Every stored session, oldest first within each application. */
export function rowsFromDb() {
  const db = getDb();
  const all = (sql) => db.prepare(sql).all();

  const sessions = all(`
    SELECT s.*, p.projectName, p.platform AS projectPlatform, p.targetFps AS projectTargetFps,
           p.status AS projectStatus,
           st.studentName, st.studentId AS studentCode, st.email AS studentEmail
    FROM test_sessions s
    JOIN projects p ON p.id = s.projectId
    JOIN students st ON st.id = s.studentId
    ORDER BY p.projectName COLLATE NOCASE, s.capturedAt ASC, s.importedAt ASC
  `);

  const checklistBySession = new Map();
  for (const r of all('SELECT sessionId, itemId, result FROM checklist_results')) {
    if (!checklistBySession.has(r.sessionId)) checklistBySession.set(r.sessionId, {});
    checklistBySession.get(r.sessionId)[r.itemId] = r.result;
  }

  // Defects belong to the application (they outlive any single build), so every
  // row of an application reports the same totals.
  const bugsByProject = new Map();
  for (const b of all('SELECT projectId, severity, status FROM bugs')) {
    if (!bugsByProject.has(b.projectId)) {
      bugsByProject.set(b.projectId, {
        total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0, resolved: 0,
      });
    }
    const t = bugsByProject.get(b.projectId);
    t.total += 1;
    if (t[b.severity] !== undefined) t[b.severity] += 1;
    if (b.status === 'open' || b.status === 'in_progress') t.open += 1;
    if (b.status === 'resolved') t.resolved += 1;
  }

  const totalByApp = new Map();
  for (const s of sessions) totalByApp.set(s.projectId, (totalByApp.get(s.projectId) ?? 0) + 1);
  const seqByApp = new Map();
  const NO_DEFECTS = { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0, resolved: 0 };

  return sessions.map((s) => {
    const n = (seqByApp.get(s.projectId) ?? 0) + 1;
    seqByApp.set(s.projectId, n);
    return {
      applicationName: s.projectName,
      applicationPlatform: s.projectPlatform,
      applicationTargetFps: s.projectTargetFps,
      applicationStatus: s.projectStatus === 'archived' ? 'Archived' : 'Active',
      totalSessions: totalByApp.get(s.projectId) ?? 0,

      testerName: s.studentName ?? '',
      testerEmail: s.studentEmail ?? '',

      sessionNumber: n,
      capturedAt: s.capturedAt,
      durationSec: s.durationSec,
      device: s.device,
      gpu: s.gpu,
      os: s.os,

      metrics: {
        platform: s.platform,
        targetFps: s.targetFps,
        avgFps: s.avgFps,
        avgFrameMs: s.avgFrameMs,
        droppedFrames: s.droppedFrames,
        totalFrames: s.totalFrames,
        memoryMB: s.memoryMB,
      },
      diagnostics: {
        minFps: s.minFps,
        onePercentLowFps: s.onePercentLowFps,
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        batteryLevel: s.batteryLevel,
        batteryStatus: s.batteryStatus,
      },
      checklist: checklistBySession.get(s.id) ?? {},
      defects: bugsByProject.get(s.projectId) ?? NO_DEFECTS,
    };
  });
}

/** The reports held in one temporary analysis session. */
export function rowsFromAnalysisSession(session) {
  // Grouped by application name so Session Number means the same thing it does
  // in the local export.
  const seqByApp = new Map();
  const totalByApp = new Map();
  for (const r of session.reports) {
    const key = r.data.projectName;
    totalByApp.set(key, (totalByApp.get(key) ?? 0) + 1);
  }

  const ordered = [...session.reports].sort((a, b) => {
    const byName = String(a.data.projectName).localeCompare(String(b.data.projectName));
    if (byName !== 0) return byName;
    return String(a.data.capturedAt).localeCompare(String(b.data.capturedAt));
  });

  return ordered.map((r) => {
    const d = r.data;
    const n = (seqByApp.get(d.projectName) ?? 0) + 1;
    seqByApp.set(d.projectName, n);
    return {
      applicationName: d.projectName,
      applicationPlatform: d.platform,
      applicationTargetFps: d.targetFps,
      applicationStatus: 'Active',
      totalSessions: totalByApp.get(d.projectName) ?? 0,

      testerName: d.studentName ?? '',
      testerEmail: '',

      sessionNumber: n,
      capturedAt: d.capturedAt,
      durationSec: d.durationSec,
      device: d.device,
      gpu: d.gpu,
      os: d.os,

      metrics: {
        platform: d.platform,
        targetFps: d.targetFps,
        avgFps: d.avgFps,
        avgFrameMs: d.avgFrameMs,
        droppedFrames: d.droppedFrames,
        totalFrames: d.totalFrames,
        memoryMB: d.memoryMB,
      },
      diagnostics: {
        minFps: d.minFps,
        onePercentLowFps: d.onePercentLowFps,
        drawCalls: d.drawCalls,
        triangles: d.triangles,
        batteryLevel: d.batteryLevel,
        batteryStatus: d.batteryStatus,
      },
      checklist: r.checklist ?? {},
      // Hosted analysis has no defect tracker, so the columns are omitted
      // rather than exported as a misleading row of zeros.
      defects: null,
    };
  });
}

/* --------------------------------------------------------------- workbook -- */

/**
 * @param {ExportRow[]} rows
 * @param {{includeDefects?: boolean}} [opts]
 */
export async function buildWorkbook(rows, opts = {}) {
  const includeDefects = opts.includeDefects ?? rows.some((r) => r.defects);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ImmersiTest — Wizardlenz XR Studio';
  wb.created = new Date();

  const sheet = wb.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });

  const checklistCols = CHECKLIST.map((c) => ({
    header: CHECK_COLUMNS[c.id] ?? c.t,
    key: `chk_${c.id}`,
    width: 22,
  }));

  sheet.columns = [
    // ---- application ----
    { header: 'Application Name', key: 'applicationName', width: 30 },
    { header: 'Application Platform', key: 'applicationPlatform', width: 18 },
    { header: 'Target FPS', key: 'targetFps', width: 11 },
    { header: 'Application Status', key: 'applicationStatus', width: 17 },
    { header: 'Total Test Sessions', key: 'totalSessions', width: 19 },
    // ---- tester (optional metadata) ----
    { header: 'Tester Name', key: 'testerName', width: 24 },
    { header: 'Tester Email', key: 'testerEmail', width: 26 },
    // ---- test session ----
    { header: 'Session Number', key: 'sessionNumber', width: 14 },
    { header: 'Test Date', key: 'testDate', width: 21, style: { numFmt: DATE_FMT } },
    { header: 'Test Duration (s)', key: 'duration', width: 15, style: { numFmt: '0.0' } },
    { header: 'Device', key: 'device', width: 26 },
    { header: 'GPU', key: 'gpu', width: 26 },
    { header: 'OS', key: 'os', width: 26 },
    { header: 'Platform', key: 'platform', width: 10 },
    // ---- performance (scored) ----
    { header: 'Average FPS', key: 'avgFps', width: 13, style: { numFmt: '0.0' } },
    { header: 'Bad Frames %', key: 'badFrames', width: 13, style: { numFmt: '0.00"%"' } },
    { header: 'Average Frame Time (ms)', key: 'avgFrameMs', width: 20, style: { numFmt: '0.00' } },
    { header: 'Memory (MB)', key: 'memoryMB', width: 13, style: { numFmt: '0.0' } },
    // ---- diagnostics (never scored) ----
    { header: 'Draw Calls', key: 'drawCalls', width: 12 },
    { header: 'Triangles', key: 'triangles', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Battery Level', key: 'batteryLevel', width: 13, style: { numFmt: '0"%"' } },
    { header: 'Battery Status', key: 'batteryStatus', width: 15 },
    { header: 'Minimum FPS (diagnostic)', key: 'minFps', width: 22, style: { numFmt: '0.0' } },
    { header: '1% Low FPS (diagnostic)', key: 'onePctLow', width: 22, style: { numFmt: '0.0' } },
    // ---- XR validation ----
    ...checklistCols,
    { header: 'XR Validation Score / 40', key: 'checklistScore', width: 22 },
    // ---- result ----
    { header: 'Performance Score / 60', key: 'performanceScore', width: 20 },
    { header: 'Final Score / 100', key: 'finalScore', width: 16 },
    { header: 'Grade', key: 'grade', width: 8 },
    { header: 'Overall Status', key: 'overallStatus', width: 16 },
    // ---- defects (application level, local mode only) ----
    ...(includeDefects
      ? [
          { header: 'Total Defects', key: 'defectTotal', width: 13 },
          { header: 'Critical Defects', key: 'defectCritical', width: 15 },
          { header: 'High Defects', key: 'defectHigh', width: 13 },
          { header: 'Medium Defects', key: 'defectMedium', width: 14 },
          { header: 'Low Defects', key: 'defectLow', width: 12 },
          { header: 'Open Defects', key: 'defectOpen', width: 13 },
          { header: 'Resolved Defects', key: 'defectResolved', width: 16 },
        ]
      : []),
  ];

  const NO_DEFECTS = { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0, resolved: 0 };

  for (const src of rows) {
    const m = src.metrics;
    const dx = src.diagnostics ?? {};
    const invalid = !(m.totalFrames > 0);

    // The score breakdown comes from the shared metrics module — the same one
    // the server, dashboard and PDF use — so this can never drift from them.
    // An invalid capture has no score and must never read as a numeric zero.
    const g = computeGrade(m, { checklist: src.checklist });
    const drop = badFramePct(m);

    const row = {
      applicationName: src.applicationName,
      applicationPlatform: src.applicationPlatform,
      targetFps: src.applicationTargetFps,
      applicationStatus: src.applicationStatus,
      totalSessions: src.totalSessions,

      testerName: src.testerName ?? '',
      testerEmail: src.testerEmail ?? '',

      sessionNumber: src.sessionNumber,
      testDate: asDate(src.capturedAt),
      duration: round(src.durationSec, 1),
      device: src.device ?? '',
      gpu: src.gpu ?? '',
      os: src.os ?? '',
      platform: m.platform,

      avgFps: invalid ? 'N/A' : round(m.avgFps, 1),
      badFrames: drop == null ? 'N/A' : round(drop, 2),
      avgFrameMs: invalid ? 'N/A' : round(m.avgFrameMs, 2),
      memoryMB: round(m.memoryMB, 1) ?? '',

      drawCalls: dx.drawCalls ?? '',
      triangles: dx.triangles ?? '',
      batteryLevel: dx.batteryLevel == null ? '' : Math.round(dx.batteryLevel * 100),
      batteryStatus: dx.batteryStatus ?? '',
      minFps: invalid ? 'N/A' : round(dx.minFps, 1),
      onePctLow: invalid ? 'N/A' : round(dx.onePercentLowFps, 1),

      checklistScore: g ? g.checklistScore : 0,
      performanceScore: g ? g.performanceScore : 'N/A',
      finalScore: g ? g.score : 'N/A',
      grade: g ? g.grade : 'N/A',
      overallStatus: invalid ? 'INVALID CAPTURE' : (STATUS_LABEL[g.status] ?? '—'),
    };

    for (const c of CHECKLIST) {
      row[`chk_${c.id}`] = RESULT_LABEL[src.checklist?.[c.id]] ?? 'NOT ASSESSED';
    }

    if (includeDefects) {
      const d = src.defects ?? NO_DEFECTS;
      row.defectTotal = d.total;
      row.defectCritical = d.critical;
      row.defectHigh = d.high;
      row.defectMedium = d.medium;
      row.defectLow = d.low;
      row.defectOpen = d.open;
      row.defectResolved = d.resolved;
    }

    sheet.addRow(row);
  }

  /* ------------------------------------------------------------ styling -- */
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF1A2028' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  header.height = 32;

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  for (const key of ['applicationName', 'device', 'gpu', 'os', 'testerEmail']) {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }

  return wb;
}

export const workbookFilename = () =>
  `XR_Test_Lab_Overall_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
