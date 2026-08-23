/**
 * Copies Chart.js and jsPDF out of node_modules into web/vendor/.
 *
 * The dashboard used to load both from cdnjs, which meant it simply did not
 * work on an offline lab PC. Runs automatically via `postinstall`, so after
 * `npm install` the app has no network dependency at all.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'web/vendor');

// Copied straight out of node_modules rather than via require.resolve: both
// packages restrict deep imports through their "exports" map, which blocks
// resolving the UMD bundles by specifier even though the files are present.
const ASSETS = [
  ['chart.js/dist/chart.umd.js', 'chart.umd.js'],
  ['jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const [pkgPath, outName] of ASSETS) {
  const dest = resolve(outDir, outName);
  const src = resolve(root, 'node_modules', pkgPath);
  try {
    if (!existsSync(src)) throw new Error(`not found at ${src}`);
    copyFileSync(src, dest);
    copied++;
  } catch (err) {
    if (!existsSync(dest)) console.warn(`[vendor] could not vendor ${pkgPath}: ${err.message}`);
    else copied++; // already vendored from a previous install
  }
}
console.log(`[vendor] ${copied}/${ASSETS.length} browser assets vendored to web/vendor/`);
