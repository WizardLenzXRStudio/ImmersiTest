/**
 * One-time localStorage -> SQLite migration.
 *
 * Accepts the legacy dashboard's `{projects:[...]}` blob (localStorage key
 * `xrtestlab.v1`). Note this shape is NOT a profiler report — the old
 * dashboard's own JSON export was never re-importable through its report
 * importer, so it needs this dedicated parser.
 *
 * Legacy sessions are marked schemaVersion 'legacy-localstorage-v1' so they
 * remain distinguishable from genuine profiler captures.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { getDb, newId, nowIso, normalizeName, transaction } from '../db/index.js';
import { badRequest, wrap } from '../lib/errors.js';
import { recomputeSession } from '../services/grading.js';

const router = Router();

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const sentinel = (v) => {
  const n = num(v);
  return n == null || n < 0 ? null : n;
};

router.get(
  '/status',
  wrap((req, res) => {
    const db = getDb();
    res.json({
      alreadyMigrated:
        db.prepare("SELECT value FROM app_meta WHERE key = 'localStorageMigratedAt'").get()?.value ?? null,
      hasData: db.prepare('SELECT COUNT(*) AS n FROM test_sessions').get().n > 0,
    });
  }),
);

router.post(
  '/localstorage',
  wrap((req, res) => {
    const projects = req.body?.projects;
    if (!Array.isArray(projects)) throw badRequest('Expected { projects: [...] } from localStorage');

    const db = getDb();
    const summary = { projects: 0, students: 0, sessions: 0, bugs: 0, checklistResults: 0, skipped: [] };

    transaction(() => {
      for (const lp of projects) {
        if (!lp?.projectName) { summary.skipped.push('project without a name'); continue; }

        const platform = lp.platform === 'AR' ? 'AR' : 'VR';
        const targetFps = Math.max(1, Math.round(num(lp.targetFps) ?? 72));
        const norm = normalizeName(lp.projectName);
        const now = nowIso();

        let project = db.prepare('SELECT * FROM projects WHERE normalizedName = ?').get(norm);
        if (!project) {
          const pid = newId('prj');
          db.prepare(
            `INSERT INTO projects (id, projectName, normalizedName, platform, targetFps, status, createdAt, updatedAt)
             VALUES (?,?,?,?,?, 'active', ?, ?)`,
          ).run(pid, lp.projectName, norm, platform, targetFps, now, now);
          project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
          summary.projects++;
        }

        // Student
        let student = null;
        const code = (lp.studentId ?? '').toString().trim() || null;
        const sName = (lp.studentName ?? '').toString().trim() || 'Unassigned Tester';
        if (code) student = db.prepare('SELECT * FROM students WHERE studentId = ?').get(code);
        if (!student) {
          student = db
            .prepare('SELECT * FROM students WHERE normalizedName = ? AND studentId IS NULL')
            .get(normalizeName(sName));
        }
        if (!student) {
          const sid = newId('stu');
          db.prepare(
            `INSERT INTO students (id, studentId, studentName, normalizedName, status, createdAt, updatedAt)
             VALUES (?,?,?,?, 'active', ?, ?)`,
          ).run(sid, code, sName, normalizeName(sName), now, now);
          student = db.prepare('SELECT * FROM students WHERE id = ?').get(sid);
          summary.students++;
        }
        db.prepare(
          `INSERT INTO project_members (projectId, studentId, joinedAt) VALUES (?,?,?)
           ON CONFLICT(projectId, studentId) DO NOTHING`,
        ).run(project.id, student.id, now);

        // Sessions — preserved in order, never overwritten.
        const sessions = Array.isArray(lp.sessions) ? lp.sessions : [];
        const importedSessionIds = [];
        for (const ls of sessions) {
          const raw = JSON.stringify(ls);
          const hash = createHash('sha256').update(`legacy:${project.id}:${raw}`).digest('hex');
          if (db.prepare('SELECT id FROM test_sessions WHERE contentHash = ?').get(hash)) continue;

          const total = Math.round(num(ls.totalFrames) ?? 0);
          const sesId = newId('ses');
          const capturedAt = ls.capturedAt && !Number.isNaN(Date.parse(ls.capturedAt))
            ? new Date(ls.capturedAt).toISOString()
            : now;

          db.prepare(
            `INSERT INTO test_sessions (
               id, projectId, studentId, schemaVersion, contentHash, originalFilename, reportFile,
               rawReport, fileSizeBytes, importedAt, capturedAt, durationSec, targetFps, platform,
               device, gpu, os, batteryLevel, batteryStatus, avgFps, minFps, onePercentLowFps,
               avgFrameMs, droppedFrames, totalFrames, memoryMB, drawCalls, triangles,
               captureStatus, performanceStatus
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            sesId, project.id, student.id, 'legacy-localstorage-v1', hash, null, null,
            raw, Buffer.byteLength(raw, 'utf8'), now, capturedAt, num(ls.durationSec),
            Math.max(1, Math.round(num(ls.targetFps) ?? targetFps)),
            ls.platform === 'AR' ? 'AR' : platform,
            ls.device ?? null, ls.gpu ?? null, ls.os ?? null,
            sentinel(ls.batteryLevel), ls.batteryStatus ?? null,
            num(ls.avgFps), num(ls.minFps), num(ls.onePercentLowFps), num(ls.avgFrameMs),
            Math.round(num(ls.droppedFrames) ?? 0), total, num(ls.memoryMB),
            sentinel(ls.drawCalls), sentinel(ls.triangles),
            total > 0 ? 'valid' : 'invalid', 'neutral',
          );

          if (Array.isArray(ls.series)) {
            const ins = db.prepare(
              `INSERT INTO performance_samples (sessionId, sampleIndex, tSeconds, fps, frameMs, memMB)
               VALUES (?,?,?,?,?,?)`,
            );
            ls.series.forEach((p, i) => {
              if (p && typeof p === 'object') ins.run(sesId, i, num(p.t), num(p.fps), num(p.frameMs), num(p.memMB));
            });
          }
          importedSessionIds.push(sesId);
          summary.sessions++;
        }

        // The legacy checklist was per-PROJECT; the new model is per-SESSION.
        // Attach it to the most recent session so the assessment is not lost.
        const latest = importedSessionIds[importedSessionIds.length - 1];
        if (latest && lp.checklist && typeof lp.checklist === 'object') {
          const ins = db.prepare(
            `INSERT INTO checklist_results (sessionId, itemId, result, assessedAt) VALUES (?,?,?,?)
             ON CONFLICT(sessionId, itemId) DO UPDATE SET result = excluded.result`,
          );
          for (const [itemId, result] of Object.entries(lp.checklist)) {
            if (!['pass', 'warn', 'fail'].includes(result)) continue;
            if (!db.prepare('SELECT id FROM checklist_items WHERE id = ?').get(itemId)) continue;
            ins.run(latest, itemId, result, now);
            summary.checklistResults++;
          }
        }

        for (const b of Array.isArray(lp.bugs) ? lp.bugs : []) {
          if (!b?.text) continue;
          // The legacy dashboard used critical/major/minor. Map onto the current
          // vocabulary — writing the old values would violate the CHECK
          // constraint and abort the whole migration.
          const sev = { critical: 'critical', major: 'high', minor: 'medium' }[b.sev] ?? 'medium';
          db.prepare(
            `INSERT INTO bugs (id, projectId, studentId, title, severity, status, createdAt, updatedAt)
             VALUES (?,?,?,?,?, 'open', ?, ?)`,
          ).run(newId('bug'), project.id, student.id, String(b.text).slice(0, 300), sev, now, now);
          summary.bugs++;
        }
      }

      db.prepare(
        `INSERT INTO app_meta (key, value) VALUES ('localStorageMigratedAt', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(nowIso());
    });

    // Grade after commit so checklist + bugs are all in place.
    for (const { id } of db.prepare('SELECT id FROM test_sessions').all()) recomputeSession(id);

    res.status(201).json({ migrated: summary });
  }),
);

export default router;
