/**
 * Builds the distributable ImmersiTest UPM package (internal use).
 *
 * The package we ship contains COMPILED ASSEMBLIES, not source. This script
 * assembles dist/com.wizardlenz.xrtestlab/ from:
 *
 *   - unity/src/com.wizardlenz.xrtestlab/   package.json, README, CHANGELOG, LICENSE
 *   - <Unity project>/Library/ScriptAssemblies/   the two compiled DLLs
 *
 * It refuses to produce a package that would leak source: no .cs, no .asmdef,
 * no source maps, no repository metadata, no development files, no test data.
 * Every emitted path is checked against that list before the build is declared
 * successful.
 *
 * HOW TO GET THE DLLs
 *   Unity compiles each assembly definition into Library/ScriptAssemblies of
 *   whatever project has the sources open. So:
 *     1. Open (or create) a Unity project.
 *     2. Copy unity/src/com.wizardlenz.xrtestlab into its Packages/ folder,
 *        or add it via Package Manager > Install package from disk.
 *     3. Let Unity compile. Confirm no console errors.
 *     4. Run this script pointing at that project's Library/ScriptAssemblies.
 *
 * USAGE
 *   node scripts/build-unity-package.js --assemblies "C:/path/MyProj/Library/ScriptAssemblies"
 *   XRLAB_UNITY_ASSEMBLIES=... node scripts/build-unity-package.js
 *
 * NOTE ON SOURCE PROTECTION
 *   Shipping IL assemblies keeps the source out of the package and out of the
 *   user's project. It is NOT absolute protection: .NET assemblies can be
 *   decompiled. Treat this as "source is not distributed", not "source cannot
 *   be recovered".
 */
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'unity/src/com.wizardlenz.xrtestlab');
const outDir = resolve(root, 'dist/com.wizardlenz.xrtestlab');

const ASSEMBLIES = [
  { dll: 'Wizardlenz.ImmersiTest.dll', target: 'Runtime', editorOnly: false },
  { dll: 'Wizardlenz.ImmersiTest.Editor.dll', target: 'Editor', editorOnly: true },
];

/** Copied verbatim from the source package. Documentation only. */
const DOC_FILES = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE.md'];

/** Nothing matching these may appear in the output. */
const FORBIDDEN_EXT = ['.cs', '.asmdef', '.asmref', '.map', '.pdb', '.mdb', '.csproj', '.sln', '.unity', '.prefab'];
const FORBIDDEN_NAME = [/^\./, /^node_modules$/i, /^\.git/i, /^tests?$/i, /^testdata$/i];

/* ------------------------------------------------------------------ args -- */

function assembliesDir() {
  const idx = process.argv.indexOf('--assemblies');
  const fromArg = idx !== -1 ? process.argv[idx + 1] : null;
  return fromArg ?? process.env.XRLAB_UNITY_ASSEMBLIES ?? null;
}

/* ------------------------------------------------------------------ meta -- */

/**
 * Deterministic GUID per logical asset path, so re-packaging the same version
 * does not churn the GUIDs Unity stores in user projects.
 */
const guidFor = (key) =>
  createHash('sha1').update(`com.wizardlenz.xrtestlab:${key}`).digest('hex').slice(0, 32);

/**
 * PluginImporter metadata.
 *
 * This is load-bearing for the Editor assembly: without a .meta pinning it to
 * the Editor platform, Unity would happily include editor code in a player
 * build and the build would fail on missing UnityEditor types.
 */
function pluginMeta(key, editorOnly) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
PluginImporter:
  externalObjects: {}
  serializedVersion: 2
  iconMap: {}
  executionOrder: {}
  defineConstraints: []
  isPreloaded: 0
  isOverridable: 0
  isExplicitlyReferenced: 0
  validateReferences: 1
  platformData:
  - first:
      '': Any
    second:
      enabled: ${editorOnly ? 0 : 1}
      settings:
        Exclude Editor: 0
        Exclude Linux64: ${editorOnly ? 1 : 0}
        Exclude OSXUniversal: ${editorOnly ? 1 : 0}
        Exclude Win: ${editorOnly ? 1 : 0}
        Exclude Win64: ${editorOnly ? 1 : 0}
        Exclude Android: ${editorOnly ? 1 : 0}
        Exclude iOS: ${editorOnly ? 1 : 0}
  - first:
      Any:
    second:
      enabled: ${editorOnly ? 0 : 1}
      settings: {}
  - first:
      Editor: Editor
    second:
      enabled: 1
      settings:
        DefaultValueInitialized: true
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

function folderMeta(key) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
folderAsset: yes
DefaultImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

function textMeta(key) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
TextScriptImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/* ----------------------------------------------------------------- build -- */

function fail(message) {
  console.error(`\n[package] FAILED: ${message}\n`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Packs the assembled folder into a UPM tarball.
 *
 * Unity's "Install package from tarball" expects an npm-layout archive: every
 * entry prefixed with "package/". Written here as USTAR + gzip in pure Node
 * rather than shelling out to tar — the two tars on a Windows box (GNU via Git
 * Bash, bsdtar via System32) disagree about drive-letter paths, and this keeps
 * the build dependency-free and byte-reproducible.
 */
function buildTarball() {
  const distDir = resolve(root, 'dist');
  const pkg = JSON.parse(readFileSync(resolve(outDir, 'package.json'), 'utf8'));
  const tgz = resolve(distDir, `${pkg.name}-${pkg.version}.tgz`);
  rmSync(tgz, { force: true });

  const chunks = [];
  for (const abs of walk(outDir).sort()) {
    const rel = 'package/' + relative(outDir, abs).replace(/\\/g, '/');
    const body = readFileSync(abs);
    chunks.push(ustarHeader(rel, body.length), body, pad(body.length));
  }
  // Two 512-byte zero blocks terminate a tar stream.
  chunks.push(Buffer.alloc(1024));

  writeFileSync(tgz, gzipSync(Buffer.concat(chunks), { level: 9 }));
  return tgz;
}

/** 512-byte USTAR header for one regular file. */
function ustarHeader(name, size) {
  const h = Buffer.alloc(512);
  const put = (str, off, len) => h.write(String(str).slice(0, len - 1), off, len - 1, 'utf8');
  // Long paths split across prefix(155) + name(100); ours stay well inside 100.
  if (Buffer.byteLength(name) > 99) throw new Error('path too long for USTAR: ' + name);

  put(name, 0, 100);
  put('0000644', 100, 8);            // mode
  put('0000000', 108, 8);            // uid
  put('0000000', 116, 8);            // gid
  put(size.toString(8).padStart(11, '0'), 124, 12);
  // Fixed mtime keeps the archive reproducible across rebuilds.
  put((0).toString(8).padStart(11, '0'), 136, 12);
  h.write('        ', 148, 8, 'utf8'); // checksum placeholder: eight spaces
  h.write('0', 156, 1, 'utf8');        // type flag: regular file
  h.write('ustar\0', 257, 6, 'binary');
  h.write('00', 263, 2, 'utf8');

  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return h;
}

/** Tar pads every file body up to a 512-byte boundary. */
function pad(size) {
  const rem = size % 512;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rem);
}

function main() {
  const asmDir = assembliesDir();
  if (!asmDir) {
    fail(
      'no assemblies directory given.\n'
      + '  Pass --assemblies "<UnityProject>/Library/ScriptAssemblies"\n'
      + '  or set XRLAB_UNITY_ASSEMBLIES.\n'
      + '  See the header of this script for how to produce the DLLs.',
    );
  }
  if (!existsSync(asmDir)) fail(`assemblies directory not found: ${asmDir}`);
  if (!existsSync(srcDir)) fail(`package source not found: ${srcDir}`);

  const missing = ASSEMBLIES.filter((a) => !existsSync(resolve(asmDir, a.dll))).map((a) => a.dll);
  if (missing.length) {
    fail(
      `these compiled assemblies are missing from ${asmDir}:\n    ${missing.join('\n    ')}\n`
      + '  Open the package sources in a Unity project and let it compile first.',
    );
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // ---- documentation -------------------------------------------------------
  for (const file of DOC_FILES) {
    const from = resolve(srcDir, file);
    if (!existsSync(from)) fail(`missing ${file} in ${srcDir}`);
    copyFileSync(from, resolve(outDir, file));
    if (file.endsWith('.md')) writeFileSync(`${resolve(outDir, file)}.meta`, textMeta(file));
  }

  // ---- assemblies ----------------------------------------------------------
  for (const a of ASSEMBLIES) {
    const dir = resolve(outDir, a.target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}.meta`, folderMeta(a.target));

    const dest = resolve(dir, a.dll);
    copyFileSync(resolve(asmDir, a.dll), dest);
    writeFileSync(`${dest}.meta`, pluginMeta(`${a.target}/${a.dll}`, a.editorOnly));
  }

  // ---- verification: nothing that leaks source may have landed -------------
  const emitted = walk(outDir).map((f) => relative(outDir, f).replace(/\\/g, '/'));
  const leaks = emitted.filter((f) => {
    const base = f.split('/').pop();
    if (FORBIDDEN_EXT.includes(extname(base).toLowerCase())) return true;
    return FORBIDDEN_NAME.some((re) => re.test(base));
  });
  if (leaks.length) {
    rmSync(outDir, { recursive: true, force: true });
    fail(`refusing to ship — these files would have leaked source or development data:\n    ${leaks.join('\n    ')}`);
  }

  const dllCount = emitted.filter((f) => f.endsWith('.dll')).length;
  if (dllCount !== ASSEMBLIES.length) {
    fail(`expected ${ASSEMBLIES.length} assemblies in the package, found ${dllCount}`);
  }

  console.log('\n[package] ImmersiTest UPM package built\n');
  for (const f of emitted.sort()) console.log(`    ${f}`);
  const tgz = buildTarball();
  console.log(`\n[package] output : ${outDir}`);
  console.log(`[package] tarball: ${tgz}`);
  console.log('[package] source files shipped: 0 (verified)');
  console.log('\nInstall in Unity with: Window > Package Manager > + > Install package from disk…');
  console.log(`and select: ${resolve(outDir, 'package.json')}\n`);
}

main();
