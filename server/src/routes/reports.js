/**
 * Report import.
 *
 * Files arrive as JSON text read by the browser's FileReader — no multipart
 * parser dependency, and the frontend already knows how to read files.
 */
import { Router } from 'express';
import { badRequest, wrap } from '../lib/errors.js';
import { previewFile, importFile } from '../ingest/import.js';
import { SUPPORTED_SCHEMAS, explain } from '../ingest/validate.js';

const router = Router();

function readFiles(req) {
  const files = req.body?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw badRequest('Expected { files: [{ filename, content }] }');
  }
  if (files.length > 200) throw badRequest('Too many files in one request (max 200)');
  return files.map((f) => ({
    filename: typeof f?.filename === 'string' ? f.filename : null,
    content: typeof f?.content === 'string' ? f.content : '',
  }));
}

const summarise = (results) => ({
  total: results.length,
  valid: results.filter((r) => r.status === 'valid').length,
  imported: results.filter((r) => r.status === 'imported').length,
  duplicate: results.filter((r) => r.status === 'duplicate').length,
  invalid: results.filter((r) => r.status === 'invalid').length,
});

/** Dry run — validates and reports duplicates without writing anything. */
router.post(
  '/preview',
  wrap((req, res) => {
    // Two passes: previewFile only knows about already-stored sessions, so the
    // same file selected twice in one batch would both read as "valid" and the
    // second would only fail at commit. Track hashes across the batch too.
    const seen = new Set();
    const results = readFiles(req).map((f) => {
      const r = previewFile(f);
      if (r.status === 'valid') {
        if (seen.has(r.contentHash)) {
          return {
            filename: r.filename,
            status: 'duplicate',
            errorCode: 'DUPLICATE_IN_SELECTION',
            reason: explain('DUPLICATE_IN_SELECTION'),
          };
        }
        seen.add(r.contentHash);
      }
      return r;
    });
    res.json({ summary: summarise(results), results, supportedSchemas: SUPPORTED_SCHEMAS });
  }),
);

/**
 * Commits. Each file is independent: one bad file never blocks the rest, which
 * is what makes a 20-report bulk import usable.
 */
router.post(
  '/import',
  wrap((req, res) => {
    const results = readFiles(req).map((f) => {
      try {
        return importFile(f);
      } catch (err) {
        // Technical detail goes to the server log; the user gets plain English.
        console.error('[import] failed for', f.filename, err);
        return {
          filename: f.filename,
          status: 'invalid',
          errorCode: 'IMPORT_FAILED',
          reason: explain('IMPORT_FAILED'),
          errorDetail: err.message,
        };
      }
    });
    res.status(201).json({ summary: summarise(results), results });
  }),
);

export default router;
