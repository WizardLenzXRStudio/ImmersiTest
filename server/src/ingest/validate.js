/**
 * Profiler report validation.
 *
 * The input contract is XRTestProfiler's JSON and is NOT modified by this app.
 * A strict schema registry keeps unknown/future versions out rather than
 * guessing at them.
 */
import { isInvalidCapture } from '../../../shared/xr-metrics/index.js';

export const SUPPORTED_SCHEMAS = ['xr-test-profile-v1'];

/**
 * Plain-English explanation for every rejection code. The UI shows this;
 * the code itself is kept for logs and tests.
 */
export const REASON_TEXT = {
  INVALID_JSON: 'This file is not valid JSON. It may be incomplete, edited by hand, or not a profiler report.',
  NOT_A_REPORT: 'This file does not contain a single test report. Export one report per file from Unity.',
  MISSING_SCHEMA: 'This file has no "schema" field, so it was not produced by XRTestProfiler.',
  UNSUPPORTED_SCHEMA: 'This report was written by a newer or unknown profiler version that this app cannot read yet.',
  MISSING_REQUIRED_FIELD: 'The report is missing information the dashboard needs (project name and frame statistics).',
  DUPLICATE_REPORT: 'This exact report has already been imported.',
  DUPLICATE_IN_SELECTION: 'The same file appears more than once in this selection.',
  IMPORT_FAILED: 'Something went wrong while saving this report. It was not imported.',
};

export const explain = (code, detail) => REASON_TEXT[code] ?? detail ?? 'This report could not be imported.';

/** Fields that must be present and numeric for a report to be usable at all. */
const REQUIRED_NUMBERS = ['targetFps', 'avgFps', 'droppedFrames', 'totalFrames'];
const REQUIRED_STRINGS = ['projectName'];

const num = (v) => (v == null || v === '' ? null : Number(v));
/** The profiler writes -1 to mean "unavailable"; store that as NULL. */
const sentinel = (v) => {
  const n = num(v);
  return n == null || Number.isNaN(n) || n < 0 ? null : n;
};

/**
 * @returns {{ok:true, report, warnings}|{ok:false, errorCode, errorDetail}}
 */
export function validateReport(text, filename) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errorCode: 'INVALID_JSON', errorDetail: `Not valid JSON: ${err.message}` };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errorCode: 'NOT_A_REPORT', errorDetail: 'Expected a single JSON object' };
  }

  const schema = raw.schema;
  if (!schema) {
    return { ok: false, errorCode: 'MISSING_SCHEMA', errorDetail: 'Report has no "schema" field' };
  }
  if (!SUPPORTED_SCHEMAS.includes(schema)) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_SCHEMA',
      errorDetail: `Schema "${schema}" is not supported (expected: ${SUPPORTED_SCHEMAS.join(', ')})`,
    };
  }

  const missing = [];
  for (const f of REQUIRED_STRINGS) {
    if (typeof raw[f] !== 'string' || raw[f].trim() === '') missing.push(f);
  }
  for (const f of REQUIRED_NUMBERS) {
    const n = num(raw[f]);
    if (n == null || Number.isNaN(n)) missing.push(f);
  }
  if (missing.length) {
    return {
      ok: false,
      errorCode: 'MISSING_REQUIRED_FIELD',
      errorDetail: `Missing or non-numeric required field(s): ${missing.join(', ')}`,
      fields: missing,
    };
  }

  const warnings = [];

  // capturedAt: keep the profiler's value when parseable, else fall back so the
  // report is still importable rather than rejected on a cosmetic field.
  let capturedAt = raw.capturedAt;
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    warnings.push('capturedAt missing or unparseable — using import time');
    capturedAt = new Date().toISOString();
  } else {
    capturedAt = new Date(capturedAt).toISOString();
  }

  let platform = (raw.platform ?? 'VR').toString().toUpperCase();
  if (platform !== 'VR' && platform !== 'AR') {
    warnings.push(`Unknown platform "${raw.platform}" — defaulting to VR`);
    platform = 'VR';
  }

  // A malformed series must not cost us an otherwise valid capture: drop the
  // bad points, keep the session, and tell the user.
  let series = [];
  if (raw.series != null) {
    if (!Array.isArray(raw.series)) {
      warnings.push('series is not an array — charts unavailable for this session');
    } else {
      const before = raw.series.length;
      series = raw.series
        .filter((p) => p && typeof p === 'object' && !Array.isArray(p))
        .map((p) => ({
          t: num(p.t),
          fps: num(p.fps),
          frameMs: num(p.frameMs),
          memMB: num(p.memMB),
        }))
        .filter((p) => p.t != null && !Number.isNaN(p.t) && p.fps != null && !Number.isNaN(p.fps));
      if (series.length !== before) {
        warnings.push(`Dropped ${before - series.length} malformed series point(s)`);
      }
    }
  }

  const totalFrames = num(raw.totalFrames);
  const report = {
    schema,
    projectName: String(raw.projectName).trim(),
    // Tester identity is OPTIONAL metadata: the profiler ships both fields
    // blank, and a test is perfectly valid without them. Blank becomes null so
    // consumers can omit the field rather than invent a placeholder person.
    studentName: (raw.studentName ?? '').toString().trim() || null,
    studentId: (raw.studentId ?? '').toString().trim() || null,
    platform,
    capturedAt,
    durationSec: num(raw.durationSec),
    targetFps: Math.max(1, Math.round(num(raw.targetFps))),
    avgFps: num(raw.avgFps),
    minFps: num(raw.minFps),
    onePercentLowFps: num(raw.onePercentLowFps),
    avgFrameMs: num(raw.avgFrameMs),
    droppedFrames: Math.round(num(raw.droppedFrames) ?? 0),
    totalFrames: Math.round(totalFrames ?? 0),
    memoryMB: num(raw.memoryMB),
    drawCalls: sentinel(raw.drawCalls),
    triangles: sentinel(raw.triangles),
    batteryLevel: sentinel(raw.batteryLevel),
    batteryStatus: raw.batteryStatus ?? null,
    device: raw.device ?? null,
    gpu: raw.gpu ?? null,
    os: raw.os ?? null,
    series,
  };

  // Not an error: a zero-frame capture is stored as evidence a test was
  // attempted, flagged INVALID, and never graded.
  if (isInvalidCapture(report)) {
    warnings.push('Zero frames recorded — will be stored as INVALID CAPTURE and left ungraded');
  }

  return { ok: true, report, warnings, filename };
}
