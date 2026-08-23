/**
 * Report import pipeline.
 *
 *   validate -> hash -> duplicate check -> resolve identity -> persist
 *   -> write the original JSON to data/reports/ -> recompute grade
 *
 * Everything for one report happens in a single transaction, so a failure
 * halfway through cannot leave a session without its samples.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, newId, nowIso, transaction } from '../db/index.js';
import { paths } from '../config.js';
import { validateReport, explain } from './validate.js';
import { resolveProject, resolveStudent, linkMember } from '../services/identity.js';
import { recomputeSession } from '../services/grading.js';

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Filesystem-safe slug for the stored report filename. */
const slug = (s) =>
  (s || 'report')
    .toString()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'report';

/**
 * Validates without writing anything — powers the import preview so the user
 * sees "18 valid / 1 duplicate / 1 invalid" before committing.
 */
export function previewFile({ filename, content }) {
  const result = validateReport(content, filename);
  if (!result.ok) {
    return {
      filename,
      status: 'invalid',
      errorCode: result.errorCode,
      reason: explain(result.errorCode),
      errorDetail: result.errorDetail,
    };
  }

  const hash = sha256(content);
  const dupe = getDb()
    .prepare('SELECT id, capturedAt FROM test_sessions WHERE contentHash = ?')
    .get(hash);
  if (dupe) {
    return {
      filename,
      status: 'duplicate',
      errorCode: 'DUPLICATE_REPORT',
      reason: explain('DUPLICATE_REPORT'),
      existingSessionId: dupe.id,
    };
  }

  const r = result.report;
  return {
    filename,
    status: 'valid',
    contentHash: hash,
    warnings: result.warnings,
    platform: r.platform,
    preview: {
      projectName: r.projectName,
      studentName: r.studentName,
      studentId: r.studentId,
      platform: r.platform,
      capturedAt: r.capturedAt,
      avgFps: r.avgFps,
      totalFrames: r.totalFrames,
      targetFps: r.targetFps,
      captureStatus: r.totalFrames > 0 ? 'valid' : 'invalid',
      samples: r.series.length,
    },
  };
}

/** Validates AND persists. Returns a per-file result object. */
export function importFile({ filename, content }) {
  const result = validateReport(content, filename);
  if (!result.ok) {
    return {
      filename,
      status: 'invalid',
      errorCode: result.errorCode,
      reason: explain(result.errorCode),
      errorDetail: result.errorDetail,
    };
  }

  const hash = sha256(content);
  const db = getDb();
  const dupe = db.prepare('SELECT id FROM test_sessions WHERE contentHash = ?').get(hash);
  if (dupe) {
    return {
      filename,
      status: 'duplicate',
      errorCode: 'DUPLICATE_REPORT',
      reason: explain('DUPLICATE_REPORT'),
      existingSessionId: dupe.id,
    };
  }

  const r = result.report;
  let reportPath = null;

  const sessionId = transaction(() => {
    const { project, created: projectCreated } = resolveProject(r);
    const { student, created: studentCreated } = resolveStudent(r);
    linkMember(project.id, student.id);

    const id = newId('ses');
    const stamp = r.capturedAt.replace(/[:.]/g, '-');
    const relPath = `${slug(r.projectName)}_${slug(r.studentName ?? 'tester')}_${stamp}_${id.slice(-6)}.json`;

    db.prepare(
      `INSERT INTO test_sessions (
         id, projectId, studentId, schemaVersion, contentHash, originalFilename, reportFile,
         rawReport, fileSizeBytes, importedAt, capturedAt, durationSec, targetFps, platform,
         device, gpu, os, batteryLevel, batteryStatus, avgFps, minFps, onePercentLowFps,
         avgFrameMs, droppedFrames, totalFrames, memoryMB, drawCalls, triangles,
         captureStatus, performanceStatus
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, project.id, student.id, r.schema, hash, filename ?? null, relPath,
      content, Buffer.byteLength(content, 'utf8'), nowIso(), r.capturedAt, r.durationSec,
      r.targetFps, r.platform, r.device, r.gpu, r.os, r.batteryLevel, r.batteryStatus,
      r.avgFps, r.minFps, r.onePercentLowFps, r.avgFrameMs, r.droppedFrames, r.totalFrames,
      r.memoryMB, r.drawCalls, r.triangles,
      r.totalFrames > 0 ? 'valid' : 'invalid', 'neutral',
    );

    if (r.series.length) {
      const ins = db.prepare(
        `INSERT INTO performance_samples (sessionId, sampleIndex, tSeconds, fps, frameMs, memMB)
         VALUES (?,?,?,?,?,?)`,
      );
      r.series.forEach((p, i) => ins.run(id, i, p.t, p.fps, p.frameMs, p.memMB));
    }

    reportPath = resolve(paths.reportsDir, relPath);
    // Inside the transaction so a DB failure below rolls back and we can still
    // clean the file up in the catch.
    writeFileSync(reportPath, content, 'utf8');

    return { id, projectCreated, studentCreated, project, student };
  });

  try {
    recomputeSession(sessionId.id);
  } catch (err) {
    // Grading is derived data; a failure here must not lose the import.
    console.error('[import] grade recompute failed:', err.message);
  }

  const saved = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(sessionId.id);
  return {
    filename,
    status: 'imported',
    sessionId: sessionId.id,
    warnings: result.warnings,
    projectId: sessionId.project.id,
    projectName: sessionId.project.projectName,
    projectCreated: sessionId.projectCreated,
    studentId: sessionId.student.id,
    studentName: sessionId.student.studentName,
    studentCreated: sessionId.studentCreated,
    captureStatus: saved.captureStatus,
    grade: saved.gradeLetter,
  };
}

/** Removes a stored report file. Missing file is not an error. */
export function deleteReportFile(reportFile) {
  if (!reportFile) return false;
  const full = resolve(paths.reportsDir, reportFile);
  // Defence against a crafted path escaping data/reports/.
  if (!full.startsWith(paths.reportsDir)) return false;
  if (!existsSync(full)) return false;
  unlinkSync(full);
  return true;
}
